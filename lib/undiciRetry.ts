import type { Client, Dispatcher } from 'undici'
import type { IncomingHttpHeaders } from 'undici/types/header'
import type { Either } from './either'
import { ResponseError } from './ResponseError'
import { setTimeout } from 'node:timers/promises'
import { errors } from 'undici'

const TIMEOUT_ERRORS = [errors.BodyTimeoutError.name, errors.HeadersTimeoutError.name]

export type RequestResult<T> = {
  body: T
  headers: IncomingHttpHeaders
  statusCode: number
}

export type DelayResolver = (response: Dispatcher.ResponseData) => number | undefined

export type RetryConfig = {
  maxAttempts: number
  delayBetweenAttemptsInMsecs?: number
  delayResolver?: DelayResolver
  statusCodesToRetry: readonly number[]
  retryOnTimeout: boolean
  safeParseJson?: boolean
  blobBody?: boolean
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 1,
  delayBetweenAttemptsInMsecs: 0,
  statusCodesToRetry: [],
  retryOnTimeout: false,
  safeParseJson: false,
  blobBody: false,
}

export async function sendWithRetry<T, const ConfigType extends RetryConfig = RetryConfig>(
  client: Client,
  request: Dispatcher.RequestOptions,
  retryConfig: ConfigType = DEFAULT_RETRY_CONFIG as ConfigType,
): Promise<Either<RequestResult<unknown>, RequestResult<ConfigType['blobBody'] extends true ? Blob : T>>> {
  let attemptsSoFar = 0

  while (true) {
    attemptsSoFar++
    try {
      const response = await client.request(request)

      // success
      if (response.statusCode < 400) {
        const resolvedBody = await resolveBody(response, retryConfig.blobBody, retryConfig.safeParseJson)
        return {
          result: {
            body: resolvedBody,
            headers: response.headers,
            statusCode: response.statusCode,
          },
        }
      }

      // Do not retry, return last error response
      if (
        retryConfig.statusCodesToRetry.indexOf(response.statusCode) === -1 ||
        attemptsSoFar >= retryConfig.maxAttempts
      ) {
        const resolvedBody = await resolveBody(response)
        return {
          error: {
            body: resolvedBody,
            headers: response.headers,
            statusCode: response.statusCode,
          },
        }
      }

      if (retryConfig.delayBetweenAttemptsInMsecs || retryConfig.delayResolver) {
        const delay = retryConfig.delayResolver
          ? retryConfig.delayResolver(response) ?? retryConfig.delayBetweenAttemptsInMsecs ?? 0
          : retryConfig.delayBetweenAttemptsInMsecs

        // Do not retry
        if (delay === -1) {
          const resolvedBody = await resolveBody(response)
          return {
            error: {
              body: resolvedBody,
              headers: response.headers,
              statusCode: response.statusCode,
            },
          }
        } else {
          // retry
          // undici response body always has to be processed or discarded
          await response.body.dump()
        }

        await setTimeout(delay)
      } else {
        await response.body.dump()
      }
    } catch (err: any) {
      // on internal client error we can't do much; if there are still retries left, we retry, if not, we rethrow an error

      if (
        attemptsSoFar >= retryConfig.maxAttempts ||
        (retryConfig.retryOnTimeout === false && TIMEOUT_ERRORS.indexOf(err.name) !== -1)
      ) {
        throw err
      }
    }
  }
}

async function resolveBody(response: Dispatcher.ResponseData, blobBody = false, safeParseJson = false) {
  if (blobBody) {
    return await response.body.blob()
  }

  // There can never be multiple content-type headers, see https://www.rfc-editor.org/rfc/rfc7230#section-3.2.2
  const contentType = response.headers['content-type'] as string | undefined
  if (contentType?.startsWith('application/json')) {
    if (!safeParseJson) {
      return await response.body.json()
    }
    const rawBody = await response.body.text()
    try {
      return JSON.parse(rawBody)
    } catch (err) {
      throw new ResponseError({
        message: 'Error while parsing HTTP JSON response',
        errorCode: 'INVALID_HTTP_RESPONSE_JSON',
        details: {
          rawBody,
        },
      })
    }
  }
  return await response.body.text()
}
