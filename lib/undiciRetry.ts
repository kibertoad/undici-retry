import { setTimeout } from 'node:timers/promises'
import type { Dispatcher } from 'undici'
import { errors } from 'undici'
import type { IncomingHttpHeaders } from 'undici/types/header'
import { createDefaultRetryResolver } from './defaultRetryResolver'
import type { Either } from './either'
import { isUnprocessableResponseError } from './typeGuards'
import { type InternalRequestError, UndiciRetryRequestError } from './UndiciRetryRequestError'
import { UnprocessableResponseError } from './UnprocessableResponseError'

export const DEFAULT_RETRYABLE_STATUS_CODES = [
  408, // Request Timeout
  425, // Too Early
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
] as const

const TIMEOUT_ERRORS = [errors.BodyTimeoutError.name, errors.HeadersTimeoutError.name]

export type RequestResult<T> = {
  body: T
  headers: IncomingHttpHeaders
  statusCode: number
  requestLabel?: string
}

export type DelayResolver = (
  response: Dispatcher.ResponseData,
  attemptNumber: number,
  statusCodesToRetry: readonly number[],
) => number | undefined

export type RetryConfig = {
  maxAttempts: number
  delayResolver?: DelayResolver
  statusCodesToRetry?: readonly number[]
  retryOnTimeout: boolean
}

export type RequestParams = {
  blobBody?: boolean
  safeParseJson?: boolean
  requestLabel?: string
  throwOnInternalError?: boolean
}

export type StreamedResponseRequestParams = Omit<RequestParams, 'blobBody' | 'safeParseJson'>

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  statusCodesToRetry: DEFAULT_RETRYABLE_STATUS_CODES,
  retryOnTimeout: false,
}

export const NO_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 1,
  statusCodesToRetry: [],
  retryOnTimeout: false,
}

export const DEFAULT_REQUEST_PARAMS: RequestParams = {
  blobBody: false,
  safeParseJson: false,
}

/**
 * Cached default delay resolver created once at module initialization.
 */
const DEFAULT_DELAY_RESOLVER = createDefaultRetryResolver()

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is expected
async function sendWithRetryInternal<TBody, const ConfigType extends RequestParams = RequestParams>(
  client: Dispatcher,
  request: Dispatcher.RequestOptions,
  retryConfig: RetryConfig,
  requestParams: ConfigType,
  handleSuccessBody: (response: Dispatcher.ResponseData) => Promise<TBody> | TBody,
): Promise<
  Either<
    ConfigType['throwOnInternalError'] extends true
      ? RequestResult<unknown>
      : RequestResult<unknown> | InternalRequestError,
    RequestResult<TBody>
  >
> {
  let attemptsSoFar = 0

  // Use the provided delayResolver or create a default one for backward compatibility
  const effectiveDelayResolver = retryConfig.delayResolver || DEFAULT_DELAY_RESOLVER
  const statusCodesToRetry = retryConfig.statusCodesToRetry || DEFAULT_RETRYABLE_STATUS_CODES

  while (true) {
    attemptsSoFar++
    try {
      const response = await client.request(request)

      // success
      if (response.statusCode < 400) {
        const resolvedBody = await handleSuccessBody(response)
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
        statusCodesToRetry.indexOf(response.statusCode) === -1 ||
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

      // Determine retry delay using the delayResolver
      const delay = effectiveDelayResolver(response, attemptsSoFar, statusCodesToRetry) ?? 0

      // Do not retry if delayResolver returns -1
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

      // Retry: undici response body always has to be processed or discarded
      await response.body.dump()

      // Wait for the determined delay before retrying
      if (delay > 0) {
        await setTimeout(delay)
      }
      // biome-ignore lint/suspicious/noExplicitAny: this is expected
    } catch (err: any) {
      // on internal client error we can't do much; if there are still retries left, we retry, if not, we rethrow an error
      if (
        attemptsSoFar >= retryConfig.maxAttempts ||
        (retryConfig.retryOnTimeout === false && TIMEOUT_ERRORS.indexOf(err.name) !== -1)
      ) {
        if (!requestParams.throwOnInternalError) {
          // Defensive check: UnprocessableResponseError should not occur in catch block
          // but if it does, preserve it as-is
          /* v8 ignore next 4 */
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

export function sendWithRetry<T, const ConfigType extends RequestParams = RequestParams>(
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
  return sendWithRetryInternal(client, request, retryConfig, requestParams, (response) =>
    resolveBody(
      response,
      requestParams.requestLabel,
      requestParams.blobBody,
      requestParams.safeParseJson,
    ),
  )
}

export function sendWithRetryReturnStream<
  const ConfigType extends StreamedResponseRequestParams = StreamedResponseRequestParams,
>(
  client: Dispatcher,
  request: Dispatcher.RequestOptions,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
  requestParams: ConfigType = {} as ConfigType,
): Promise<
  Either<
    ConfigType['throwOnInternalError'] extends true
      ? RequestResult<unknown>
      : RequestResult<unknown> | InternalRequestError,
    RequestResult<Dispatcher.ResponseData['body']>
  >
> {
  return sendWithRetryInternal(
    client,
    request,
    retryConfig,
    requestParams,
    (response) => response.body,
  )
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
