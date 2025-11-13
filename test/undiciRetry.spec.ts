import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getLocal } from 'mockttp'
import type { Dispatcher } from 'undici'
import { Client, Pool } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isInternalRequestError,
  isRequestResult,
  isUnprocessableResponseError,
} from '../lib/typeGuards'
import {
  DEFAULT_RETRY_CONFIG,
  NO_RETRY_CONFIG,
  sendWithRetry,
  sendWithRetryReturnStream,
} from '../lib/undiciRetry'
import { consumeStream } from './streamHelpers'

const baseUrl = 'http://localhost:4000/'
const JSON_HEADERS = {
  'content-type': 'application/json',
}

const TEXT_HEADERS = {
  'content-type': 'text/plain',
}

const request: Dispatcher.RequestOptions = {
  method: 'GET',
  path: '/',
}

const mockServer = getLocal()

describe('undiciRetry', () => {
  let client: Client
  let pool: Pool
  beforeEach(async () => {
    await mockServer.start(4000)
    client = new Client(baseUrl)
    pool = new Pool(baseUrl, { connections: 2 })
  })
  afterEach(async () => {
    await mockServer.stop()
  })

  describe('requests', () => {
    it('retry on specified status codes', async () => {
      await mockServer.forGet('/').thenReply(500, 'A mocked response1')
      await mockServer.forGet('/').thenReply(502, 'A mocked response2')
      await mockServer.forGet('/').thenReply(200, 'A mocked response3')
      await mockServer.forGet('/').thenReply(200, 'A mocked response4')

      const response = await sendWithRetry(client, request, {
        maxAttempts: 3,
        delayBetweenAttemptsInMsecs: 0,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)
      expect(response.result?.body).toEqual('A mocked response3')
    })

    it('default does not retry', async () => {
      await mockServer.forGet('/').thenReply(500, 'A mocked response1')
      await mockServer.forGet('/').thenReply(200, 'A mocked response3')

      const response = await sendWithRetry(client, request, NO_RETRY_CONFIG, {
        requestLabel: 'red label',
      })

      expect(response.error).toBeDefined()
      expect(response.error!.statusCode).toEqual(500)
      expect(response.error!.body).toEqual('A mocked response1')
      expect(response.error!.requestLabel).toEqual('red label')
    })

    it('do not retry on success', async () => {
      await mockServer.forGet('/').thenReply(200, 'A mocked response1')
      await mockServer.forGet('/').thenReply(200, 'A mocked response2')
      await mockServer.forGet('/').thenReply(200, 'A mocked response3')

      const response = await sendWithRetry(client, request, {
        maxAttempts: 3,
        delayBetweenAttemptsInMsecs: 0,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)
      expect(response.result?.body).toEqual('A mocked response1')
    })

    it('propagates error in case of invalid response content-type if no retries left', async () => {
      await mockServer.forGet('/').thenReply(200, 'err', 'Not actually a JSON', JSON_HEADERS)
      expect.assertions(2)

      try {
        await sendWithRetry(
          client,
          request,
          {
            maxAttempts: 3,
            delayBetweenAttemptsInMsecs: 0,
            statusCodesToRetry: [500, 502, 503],
            retryOnTimeout: false,
          },
          {
            safeParseJson: true,
            throwOnInternalError: true,
            requestLabel: 'label',
          },
        )
      } catch (err: any) {
        if (!isUnprocessableResponseError(err)) {
          throw new Error('invalid response type')
        }

        expect(err.message).toBe('Error while parsing HTTP JSON response')
        expect(err.details!.requestLabel).toBe('label')
      }
    })

    it('retries in case of invalid response content-type correctly if retries left', async () => {
      await mockServer.forGet('/').thenReply(502, 'err', 'Not actually a JSON', JSON_HEADERS)
      await mockServer.forGet('/').thenReply(200, 'A mocked response2')

      const response = await sendWithRetry(
        client,
        request,
        {
          maxAttempts: 3,
          delayBetweenAttemptsInMsecs: 50,
          statusCodesToRetry: [500, 502, 503],
          retryOnTimeout: false,
        },
        {
          safeParseJson: true,
        },
      )

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)
      expect(response.result?.body).toEqual('A mocked response2')
    })

    it('handles non-json content', async () => {
      await mockServer.forGet('/').thenReply(200, 'err', 'Not actually a JSON', TEXT_HEADERS)

      const response = await sendWithRetry(
        client,
        request,
        {
          maxAttempts: 3,
          delayBetweenAttemptsInMsecs: 0,
          statusCodesToRetry: [500, 502, 503],
          retryOnTimeout: false,
        },
        {
          safeParseJson: true,
        },
      )

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)
      expect(response.result?.body).toEqual('Not actually a JSON')
    })

    it('handles json content', async () => {
      await mockServer.forGet('/').thenReply(
        200,
        'err',
        JSON.stringify({
          id: 1,
        }),
        JSON_HEADERS,
      )

      const response = await sendWithRetry(
        client,
        request,
        {
          maxAttempts: 3,
          delayBetweenAttemptsInMsecs: 0,
          statusCodesToRetry: [500, 502, 503],
          retryOnTimeout: false,
        },
        {
          safeParseJson: false,
        },
      )

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)
      expect(response.result?.body).toEqual({
        id: 1,
      })
    })

    it('retry on connection closed', async () => {
      await mockServer.forGet('/').thenCloseConnection()
      await mockServer.forGet('/').thenReply(200, 'A mocked response2')

      const response = await sendWithRetry(client, request, {
        maxAttempts: 3,
        delayBetweenAttemptsInMsecs: 0,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)
      expect(response.result?.body).toEqual('A mocked response2')
    })

    it('retry on connection reset', async () => {
      await mockServer.forGet('/').thenResetConnection()
      await mockServer.forGet('/').thenReply(200, 'A mocked response2')

      const response = await sendWithRetry(client, request, {
        maxAttempts: 3,
        delayBetweenAttemptsInMsecs: 0,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)
      expect(response.result?.body).toEqual('A mocked response2')
    })

    it('retry on timeout if enabled', async () => {
      await mockServer.forGet('/').thenTimeout()
      await mockServer.forGet('/').thenReply(200, 'A mocked response2')

      const response = await sendWithRetry(
        client,
        {
          ...request,
          bodyTimeout: 500,
          headersTimeout: 500,
        },
        {
          maxAttempts: 3,
          delayBetweenAttemptsInMsecs: 0,
          statusCodesToRetry: [500, 502, 503],
          retryOnTimeout: true,
        },
      )

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)
      expect(response.result?.body).toEqual('A mocked response2')
    })

    it('do not retry on timeout if disabled', async () => {
      await mockServer.forGet('/').thenTimeout()
      await mockServer.forGet('/').thenReply(200, 'A mocked response2')

      expect.assertions(1)

      try {
        await sendWithRetry(
          client,
          {
            ...request,
            bodyTimeout: 500,
            headersTimeout: 500,
          },
          {
            maxAttempts: 3,
            delayBetweenAttemptsInMsecs: 0,
            statusCodesToRetry: [500, 502, 503],
            retryOnTimeout: false,
          },
          {
            throwOnInternalError: true,
          },
        )
      } catch (err: any) {
        expect(err.message).toBe('Headers Timeout Error')
      }
    })

    it('throw internal error if cannot connect', async () => {
      expect.assertions(2)

      try {
        await sendWithRetry(
          new Client('http://127.0.0.1:999'),
          request,
          {
            maxAttempts: 2,
            delayBetweenAttemptsInMsecs: 10,
            statusCodesToRetry: [500, 502, 503],
            retryOnTimeout: false,
          },
          {
            throwOnInternalError: true,
            requestLabel: 'label',
          },
        )
      } catch (err) {
        if (!isInternalRequestError(err)) {
          throw new Error('Invalid error type')
        }
        expect(err.message).toBe('connect ECONNREFUSED 127.0.0.1:999')
        expect(err.requestLabel).toBe('label')
      }
    })

    it('throw internal error if max retries exceeded', async () => {
      await mockServer.forGet('/').thenCloseConnection()
      await mockServer.forGet('/').thenCloseConnection()
      await mockServer.forGet('/').thenReply(200, 'A mocked response2')

      expect.assertions(1)

      try {
        await sendWithRetry(
          client,
          request,
          {
            maxAttempts: 2,
            delayBetweenAttemptsInMsecs: 10,
            statusCodesToRetry: [500, 502, 503],
            retryOnTimeout: false,
          },
          {
            throwOnInternalError: true,
          },
        )
      } catch (err: any) {
        expect(err.message).toBe('other side closed')
      }
    })

    it('return error response if error is not retriable', async () => {
      await mockServer.forGet('/').thenReply(400, 'status message', 'Invalid request', {})
      await mockServer.forGet('/').thenReply(200, 'A mocked response2')

      const result = await sendWithRetry(client, request, {
        maxAttempts: 2,
        delayBetweenAttemptsInMsecs: 10,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(result!.error!.statusCode).toBe(400)
      expect(result!.error!.body).toBe('Invalid request')
    })

    it('return internal errors if throwOnInternalError = false', async () => {
      const result = await sendWithRetry(
        new Client('http://127.0.0.1:999'),
        request,
        {
          maxAttempts: 2,
          delayBetweenAttemptsInMsecs: 10,
          statusCodesToRetry: [500, 502, 503],
          retryOnTimeout: false,
        },
        {
          requestLabel: 'label',
          throwOnInternalError: false,
        },
      )

      if (!isInternalRequestError(result.error)) {
        throw new Error('Invalid error type')
      }

      expect(result.error.message).toBe('connect ECONNREFUSED 127.0.0.1:999')
      expect(result.error.requestLabel).toBe('label')
    })

    it('throw internal errors if throwOnInternalError = true', async () => {
      expect.assertions(2)
      try {
        await sendWithRetry(
          new Client('http://127.0.0.1:999'),
          request,
          {
            maxAttempts: 2,
            delayBetweenAttemptsInMsecs: 10,
            statusCodesToRetry: [500, 502, 503],
            retryOnTimeout: false,
          },
          {
            requestLabel: 'label',
            throwOnInternalError: true,
          },
        )
      } catch (err: any) {
        if (!isInternalRequestError(err)) {
          throw new Error('wrong error type')
        }

        expect(err.message).toBe('connect ECONNREFUSED 127.0.0.1:999')
        expect(err.requestLabel).toBe('label')
      }
    })

    it('returns body as blob', async () => {
      const mockedResponse = {
        hello: 'world',
      }
      await mockServer.forGet('/').thenReply(200, 'ok', JSON.stringify(mockedResponse))

      const response = await sendWithRetry(
        client,
        request,
        {
          maxAttempts: 3,
          delayBetweenAttemptsInMsecs: 0,
          statusCodesToRetry: [500, 502, 503],
          retryOnTimeout: false,
        },
        {
          safeParseJson: true,
          blobBody: true,
        },
      )

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)
      expect(response.result?.body).toBeInstanceOf(Blob)
      expect(response.result?.body).toEqual(new Blob([JSON.stringify(mockedResponse)]))
    })

    it('retry on specified status codes with pool', async () => {
      await mockServer.forGet('/').thenReply(500, 'A mocked response1')
      await mockServer.forGet('/').thenReply(502, 'A mocked response2')
      await mockServer.forGet('/').thenReply(200, 'A mocked response3')
      await mockServer.forGet('/').thenReply(200, 'A mocked response4')

      const response = await sendWithRetry(pool, request, {
        maxAttempts: 3,
        delayBetweenAttemptsInMsecs: 0,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)
      expect(response.result?.body).toEqual('A mocked response3')
    })
  })

  describe('DelayResolver', () => {
    it('does not retry on -1', async () => {
      await mockServer.forGet('/').thenReply(500, 'A mocked response1')
      await mockServer.forGet('/').thenReply(502, 'A mocked response2')
      await mockServer.forGet('/').thenReply(200, 'A mocked response3')
      await mockServer.forGet('/').thenReply(200, 'A mocked response4')

      const response = await sendWithRetry(client, request, {
        maxAttempts: 3,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
        delayResolver: (response) => {
          if (response.statusCode === 500) {
            return 100
          }
          return -1
        },
      })

      if (!isRequestResult(response.error)) {
        throw new Error('invalid result type')
      }

      expect(response.error).toBeDefined()
      expect(response.error!.statusCode).toEqual(502)
      expect(response.error!.body).toEqual('A mocked response2')
    })

    it('does not invoke delay resolved on unspecified codes', async () => {
      await mockServer.forGet('/').thenReply(500, 'A mocked response1')
      await mockServer.forGet('/').thenReply(502, 'A mocked response2')
      await mockServer.forGet('/').thenReply(200, 'A mocked response3')
      await mockServer.forGet('/').thenReply(200, 'A mocked response4')

      const response = await sendWithRetry(client, request, {
        maxAttempts: 3,
        statusCodesToRetry: [502, 503],
        retryOnTimeout: false,
        delayResolver: (response) => {
          if (response.statusCode === 500) {
            return 100
          }
          return -1
        },
      })

      expect(response.error).toBeDefined()
      expect(response.error!.statusCode).toEqual(500)
      expect(response.error!.body).toEqual('A mocked response1')
    })

    it('fallbacks to set retry time if resolver returns undefined', async () => {
      await mockServer.forGet('/').thenReply(500, 'A mocked response1')
      await mockServer.forGet('/').thenReply(502, 'A mocked response2')
      await mockServer.forGet('/').thenReply(200, 'A mocked response3')
      await mockServer.forGet('/').thenReply(200, 'A mocked response4')

      const response = await sendWithRetry(client, request, {
        maxAttempts: 3,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
        delayBetweenAttemptsInMsecs: 30,
        delayResolver: () => {
          return undefined
        },
      })

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)
    })

    it('fallbacks to immediate retry if everything returns undefined', async () => {
      await mockServer.forGet('/').thenReply(500, 'A mocked response1')
      await mockServer.forGet('/').thenReply(502, 'A mocked response2')
      await mockServer.forGet('/').thenReply(200, 'A mocked response3')
      await mockServer.forGet('/').thenReply(200, 'A mocked response4')

      const response = await sendWithRetry(client, request, {
        maxAttempts: 3,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
        delayResolver: () => {
          return undefined
        },
      })

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)
    })
  })

  describe('Retry-After', () => {
    it('returns an error response if retry-after is too long', async () => {
      await mockServer.forGet('/').thenReply(429, 'A mocked response2', {
        // @ts-expect-error
        'Retry-After': 90,
      })
      await mockServer.forGet('/').thenReply(200, 'A mocked response3')

      const response = await sendWithRetry(client, request, DEFAULT_RETRY_CONFIG, {
        requestLabel: 'black label',
      })

      if (!response.error) {
        throw new Error('Expected to receive an error')
      }
      expect(response.error.statusCode).toBe(429)
      expect(response.error.requestLabel).toBe('black label')
    })

    it('ignores RetryAfter if flag is sent to false', async () => {
      await mockServer.forGet('/').thenReply(429, 'A mocked response2', {
        // @ts-expect-error
        'Retry-After': 90,
      })
      await mockServer.forGet('/').thenReply(200, 'A mocked response3')

      const response = await sendWithRetry(client, request, {
        ...DEFAULT_RETRY_CONFIG,
        respectRetryAfter: false,
      })

      if (!response.result) {
        throw new Error('Expected to receive result')
      }
      expect(response.result.statusCode).toBe(200)
    })

    it('retries if retry-after is short enought', async () => {
      await mockServer.forGet('/').thenReply(429, 'A mocked response2', {
        // @ts-expect-error
        'Retry-After': 1,
      })
      await mockServer.forGet('/').thenReply(200, 'A mocked response3')

      const response = await sendWithRetry(client, request, DEFAULT_RETRY_CONFIG)

      if (!response.result) {
        throw new Error('Expected to receive result')
      }
      expect(response.result.statusCode).toBe(200)
    })
  })

  describe('sendWithRetryReturnStream', () => {
    it('returns stream on successful response', async () => {
      const mockedResponse = 'Stream response data'
      await mockServer.forGet('/').thenReply(200, 'ok', mockedResponse)

      const response = await sendWithRetryReturnStream(client, request, {
        maxAttempts: 3,
        delayBetweenAttemptsInMsecs: 0,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)
      expect(response.result?.body).toBeDefined()

      // Verify the body is a readable stream by reading from it manually
      const bodyText = await consumeStream(response.result!.body)
      expect(bodyText).toEqual(mockedResponse)
    })

    it('retries on specified status codes and returns stream on success', async () => {
      await mockServer.forGet('/').thenReply(500, 'A mocked response1')
      await mockServer.forGet('/').thenReply(502, 'A mocked response2')
      await mockServer.forGet('/').thenReply(200, 'Success response')

      const response = await sendWithRetryReturnStream(client, request, {
        maxAttempts: 3,
        delayBetweenAttemptsInMsecs: 0,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)

      const bodyText = await consumeStream(response.result!.body)
      expect(bodyText).toEqual('Success response')
    })

    it('returns error with consumed body on non-retryable error', async () => {
      await mockServer.forGet('/').thenReply(400, 'status message', 'Bad request error', {})
      await mockServer.forGet('/').thenReply(200, 'Success response')

      const result = await sendWithRetryReturnStream(client, request, {
        maxAttempts: 2,
        delayBetweenAttemptsInMsecs: 10,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(result.error).toBeDefined()
      expect(result!.error!.statusCode).toBe(400)
      expect(result!.error!.body).toBe('Bad request error')
    })

    it('returns error when max retries exceeded', async () => {
      await mockServer.forGet('/').thenReply(500, 'Error 1')
      await mockServer.forGet('/').thenReply(500, 'Error 2')
      await mockServer.forGet('/').thenReply(200, 'Success response')

      const result = await sendWithRetryReturnStream(client, request, {
        maxAttempts: 2,
        delayBetweenAttemptsInMsecs: 0,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(result.error).toBeDefined()
      expect(result!.error!.statusCode).toBe(500)
      expect(result!.error!.body).toBe('Error 2')
    })

    it('works with Pool', async () => {
      const mockedResponse = 'Pool stream response'
      await mockServer.forGet('/').thenReply(200, 'ok', mockedResponse)

      const response = await sendWithRetryReturnStream(pool, request, {
        maxAttempts: 3,
        delayBetweenAttemptsInMsecs: 0,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)

      const bodyText = await consumeStream(response.result!.body)
      expect(bodyText).toEqual(mockedResponse)
    })

    it('handles internal errors with throwOnInternalError=true', async () => {
      expect.assertions(2)

      try {
        await sendWithRetryReturnStream(
          new Client('http://127.0.0.1:999'),
          request,
          {
            maxAttempts: 2,
            delayBetweenAttemptsInMsecs: 10,
            statusCodesToRetry: [500, 502, 503],
            retryOnTimeout: false,
          },
          {
            throwOnInternalError: true,
            requestLabel: 'stream-label',
          },
        )
      } catch (err) {
        if (!isInternalRequestError(err)) {
          throw new Error('Invalid error type')
        }
        expect(err.message).toBe('connect ECONNREFUSED 127.0.0.1:999')
        expect(err.requestLabel).toBe('stream-label')
      }
    })

    it('returns internal errors with throwOnInternalError=false', async () => {
      const result = await sendWithRetryReturnStream(
        new Client('http://127.0.0.1:999'),
        request,
        {
          maxAttempts: 2,
          delayBetweenAttemptsInMsecs: 10,
          statusCodesToRetry: [500, 502, 503],
          retryOnTimeout: false,
        },
        {
          requestLabel: 'stream-label',
          throwOnInternalError: false,
        },
      )

      if (!isInternalRequestError(result.error)) {
        throw new Error('Invalid error type')
      }

      expect(result.error.message).toBe('connect ECONNREFUSED 127.0.0.1:999')
      expect(result.error.requestLabel).toBe('stream-label')
    })

    it('retries on connection closed', async () => {
      await mockServer.forGet('/').thenCloseConnection()
      await mockServer.forGet('/').thenReply(200, 'Success after reconnect')

      const response = await sendWithRetryReturnStream(client, request, {
        maxAttempts: 3,
        delayBetweenAttemptsInMsecs: 0,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)

      const bodyText = await consumeStream(response.result!.body)
      expect(bodyText).toEqual('Success after reconnect')
    })

    it('handles retry-after header correctly', async () => {
      await mockServer.forGet('/').thenReply(429, 'Rate limited', {
        // @ts-expect-error
        'Retry-After': 1,
      })
      await mockServer.forGet('/').thenReply(200, 'Success after rate limit')

      const response = await sendWithRetryReturnStream(client, request, DEFAULT_RETRY_CONFIG)

      if (!response.result) {
        throw new Error('Expected to receive result')
      }
      expect(response.result.statusCode).toBe(200)

      const bodyText = await consumeStream(response.result.body)
      expect(bodyText).toEqual('Success after rate limit')
    })

    it('returns error if retry-after is too long', async () => {
      await mockServer.forGet('/').thenReply(429, 'Rate limited for too long', {
        // @ts-expect-error
        'Retry-After': 90,
      })
      await mockServer.forGet('/').thenReply(200, 'Success')

      const response = await sendWithRetryReturnStream(client, request, DEFAULT_RETRY_CONFIG, {
        requestLabel: 'stream-retry-label',
      })

      if (!response.error) {
        throw new Error('Expected to receive an error')
      }
      expect(response.error.statusCode).toBe(429)
      expect(response.error.requestLabel).toBe('stream-retry-label')
      expect(response.error.body).toBe('Rate limited for too long')
    })

    it('handles JSON content as stream without consuming it', async () => {
      const jsonData = {
        id: 1,
        message: 'test',
      }
      await mockServer.forGet('/').thenReply(200, 'ok', JSON.stringify(jsonData), JSON_HEADERS)

      const response = await sendWithRetryReturnStream(client, request, {
        maxAttempts: 3,
        delayBetweenAttemptsInMsecs: 0,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)

      // The body should be a stream, not parsed JSON - consume it manually
      const bodyText = await consumeStream(response.result!.body)
      expect(bodyText).toEqual(JSON.stringify(jsonData))

      // Verify we can parse it manually if needed
      const parsed = JSON.parse(bodyText)
      expect(parsed).toEqual(jsonData)
    })

    it('handles large multi-chunk response as stream', async () => {
      // Read the large JSON fixture file
      const fixturePath = join(__dirname, 'fixtures', 'large-response.json')
      const largeJsonContent = readFileSync(fixturePath, 'utf8')

      // Serve it through the mock server
      await mockServer.forGet('/').thenReply(200, 'ok', largeJsonContent, JSON_HEADERS)

      const response = await sendWithRetryReturnStream(client, request, {
        maxAttempts: 3,
        delayBetweenAttemptsInMsecs: 0,
        statusCodesToRetry: [500, 502, 503],
        retryOnTimeout: false,
      })

      expect(response.result).toBeDefined()
      expect(response.result?.statusCode).toEqual(200)

      // Consume the stream manually - this will receive multiple chunks for large content
      const streamedContent = await consumeStream(response.result!.body)

      // Verify the streamed content matches the original file exactly
      expect(streamedContent).toEqual(largeJsonContent)

      // Verify we can parse the JSON
      const parsed = JSON.parse(streamedContent)
      expect(parsed).toHaveProperty('metadata')
      expect(parsed).toHaveProperty('users')
      expect(parsed).toHaveProperty('products')
      expect(parsed).toHaveProperty('orders')
      expect(parsed).toHaveProperty('statistics')
      expect(parsed.users).toHaveLength(10)
      expect(parsed.products).toHaveLength(5)
      expect(parsed.orders).toHaveLength(3)
    })
  })
})
