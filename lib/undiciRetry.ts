import { setTimeout } from 'node:timers/promises'
import type { Dispatcher } from 'undici'
import { errors } from 'undici'
import type { IncomingHttpHeaders } from 'undici/types/header'
import { type InternalRequestError, UndiciRetryRequestError } from './UndiciRetryRequestError'
import { UnprocessableResponseError } from './UnprocessableResponseError'
import type { Either } from './either'
import { resolveDelayTime } from './retryAfterResolver'
import { isUnprocessableResponseError } from './typeGuards'

const TIMEOUT_ERRORS = [errors.BodyTimeoutError.name, errors.HeadersTimeoutError.name]

export type RequestResult<T> = {
  body: T
  headers: IncomingHttpHeaders
  statusCode: number
  requestLabel?: string
}

export type DelayResolver = (response: Dispatcher.ResponseData) => number | undefined

export type RetryConfig = {
  maxAttempts: number
  delayBetweenAttemptsInMsecs?: number
  delayResolver?: DelayResolver
  statusCodesToRetry: readonly number[]
  retryOnTimeout: boolean
  respectRetryAfter?: boolean
  maxRetryAfterInMsecs?: number
}

export type RequestParams = {
  blobBody?: boolean
  safeParseJson?: boolean
  requestLabel?: string
  throwOnInternalError?: boolean
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayBetweenAttemptsInMsecs: 100,
  statusCodesToRetry: [429, 500, 502, 503, 504],
  retryOnTimeout: false,
  respectRetryAfter: true,
  maxRetryAfterInMsecs: 60000,
}

export const NO_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 1,
  delayBetweenAttemptsInMsecs: 0,
  statusCodesToRetry: [],
  respectRetryAfter: false,
  retryOnTimeout: false,
}

export const DEFAULT_REQUEST_PARAMS: RequestParams = {
  blobBody: false,
  safeParseJson: false,
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
export async function sendWithRetry<T, const ConfigType extends RequestParams = RequestParams>(
  client: Dispatcher,
  request: Dispatcher.RequestOptions,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
  requestParams: ConfigType = DEFAULT_REQUEST_PARAMS as ConfigType,
): Promise<
  Either<
    ConfigType['throwOnInternalError'] extends true
      ? RequestResult<unknown>
      : RequestResult<unknown> | InternalRequestError,
    RequestResult<ConfigType['blobBody'] extends true ? Blob : T>
  >
> {
  let attemptsSoFar = 0

  while (true) {
    attemptsSoFar++
    try {
      const response = await client.request(request)

      // success
      if (response.statusCode < 400) {
        const resolvedBody = await resolveBody(
          response,
          requestParams.requestLabel,
          requestParams.blobBody,
          requestParams.safeParseJson,
        )
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
        const resolvedBody = await resolveBody(response, requestParams.requestLabel)
        return {
          error: {
            body: resolvedBody,
            headers: response.headers,
            statusCode: response.statusCode,
            requestLabel: requestParams.requestLabel,
          },
        }
      }

      if (
        retryConfig.delayBetweenAttemptsInMsecs ||
        retryConfig.delayResolver ||
        response.statusCode === 429
      ) {
        let delay: number | undefined

        // TOO_MANY_REQUESTS
        if (
          retryConfig.respectRetryAfter !== false &&
          response.statusCode === 429 &&
          'retry-after' in response.headers
        ) {
          const delayResolutionResult = resolveDelayTime(
            response.headers,
            retryConfig.maxRetryAfterInMsecs,
          )
          if (delayResolutionResult.result) {
            delay = delayResolutionResult.result
          }
          if (delayResolutionResult.error === 'max_delay_exceeded') {
            delay = -1
          }
        }

        if (delay === undefined) {
          delay = retryConfig.delayResolver
            ? (retryConfig.delayResolver(response) ?? retryConfig.delayBetweenAttemptsInMsecs ?? 0)
            : retryConfig.delayBetweenAttemptsInMsecs
        }

        // Do not retry
        if (delay === -1) {
          const resolvedBody = await resolveBody(response, requestParams.requestLabel)
          return {
            error: {
              body: resolvedBody,
              headers: response.headers,
              statusCode: response.statusCode,
              requestLabel: requestParams.requestLabel,
            },
          }
        }

        // retry
        // undici response body always has to be processed or discarded
        await response.body.dump()

        await setTimeout(delay)
      } else {
        await response.body.dump()
      }
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    } catch (err: any) {
      // on internal client error we can't do much; if there are still retries left, we retry, if not, we rethrow an error
      if (
        attemptsSoFar >= retryConfig.maxAttempts ||
        (retryConfig.retryOnTimeout === false && TIMEOUT_ERRORS.indexOf(err.name) !== -1)
      ) {
        if (!requestParams.throwOnInternalError) {
          if (!isUnprocessableResponseError(err)) {
            err.requestLabel = requestParams.requestLabel
            err.isInternalRequestError = true
          }

          return {
            error: err,
          }
        }
        if (isUnprocessableResponseError(err)) {
          throw err
        }

        throw new UndiciRetryRequestError({
          error: err,
          message: err.message,
          requestLabel: requestParams.requestLabel,
        })
      }
    }
  }
}

async function resolveBody(
  response: Dispatcher.ResponseData,
  requestLabel = 'N/A',
  blobBody = false,
  safeParseJson = false,
) {
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
    } catch (_err) {
      throw new UnprocessableResponseError({
        message: 'Error while parsing HTTP JSON response',
        errorCode: 'INVALID_HTTP_RESPONSE_JSON',
        requestLabel,
        rawBody,
      })
    }
  }
  return await response.body.text()
}
