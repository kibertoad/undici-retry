import type { Dispatcher } from 'undici'
import type { Either } from './either'

const DIGITS_ONLY_REGEX = /^\d+$/

/**
 * Parses a Retry-After header value into a delay in milliseconds.
 * Supports both delta-seconds format ("120") and HTTP-date format.
 *
 * @param retryAfter - The Retry-After header value
 * @returns Either an error message or the delay in milliseconds
 *
 * @example
 * ```typescript
 * const result = parseRetryAfterHeader('120')
 * if (result.result !== undefined) {
 *   await setTimeout(result.result)
 * }
 * ```
 */
export function parseRetryAfterHeader(retryAfter: string): Either<string, number> {
  // Defensive check: callers ensure retryAfter is truthy
  /* v8 ignore next 3 */
  if (!retryAfter) {
    return { error: 'No Retry-After header provided' }
  }

  // Check for delta-seconds format ("120")
  if (retryAfter.match(DIGITS_ONLY_REGEX)) {
    const seconds = Number.parseInt(retryAfter, 10)
    // Defensive check: DIGITS_ONLY_REGEX ensures valid numeric string
    /* v8 ignore next 3 */
    if (isNaN(seconds) || seconds < 0) {
      return { error: 'Invalid Retry-After seconds value' }
    }
    return { result: seconds * 1000 }
  }

  // Check for HTTP-date format ("Tue, 07 Nov 1994 08:49:37 GMT")
  const date = new Date(retryAfter)
  if (!isNaN(date.getTime())) {
    const delay = date.getTime() - Date.now()
    if (delay < 0) {
      return { error: 'Retry-After date is in the past' }
    }
    return { result: delay }
  }

  return { error: 'Unknown Retry-After format' }
}

/**
 * Represents a decision about whether to retry a failed HTTP request.
 */
export type RetryDecision = {
  /** Whether the request should be retried */
  shouldRetry: boolean
  /** Delay in milliseconds before retrying (only present if shouldRetry is true) */
  delay?: number
  /** Human-readable explanation of the decision */
  reason?: string
}

const DEFAULT_BASE_DELAY = 100
const DEFAULT_MAX_DELAY = 60000
const DEFAULT_MAX_JITTER = 100

/**
 * Configuration options for DefaultRetryResolver.
 */
export interface DefaultRetryResolverOptions {
  /** Base delay in milliseconds between retries (default: 100) */
  baseDelay?: number
  /** Maximum delay in milliseconds for any retry (default: 60000) */
  maxDelay?: number
  /** Maximum random jitter to add to delays in milliseconds (default: 100) */
  maxJitter?: number
  /** Whether to use exponential backoff (true) or linear backoff (false) (default: true) */
  exponentialBackoff?: boolean
  /** Whether to respect Retry-After headers for 429 and 503 responses (default: true) */
  respectRetryAfter?: boolean
}

/**
 * A configurable retry resolver that implements sophisticated retry logic including:
 * - Exponential or linear backoff strategies
 * - Retry-After header support for 429 and 503 responses
 * - Configurable retryable status codes
 * - Jitter to prevent thundering herd
 * - Maximum delay caps
 *
 * This class provides full-featured retry decision making with attempt tracking.
 * For DelayResolver interface compatibility, use createDefaultRetryResolver() instead.
 *
 * @example
 * ```typescript
 * const resolver = new DefaultRetryResolver({
 *   baseDelay: 100,
 *   exponentialBackoff: true,
 *   respectRetryAfter: true
 * })
 *
 * const decision = resolver.resolveRetryDecision(response, attemptNumber)
 * if (decision.shouldRetry) {
 *   await setTimeout(decision.delay)
 *   // retry request
 * }
 * ```
 */
export class DefaultRetryResolver {
  public readonly baseDelay: number
  public readonly maxDelay: number
  public readonly maxJitter: number
  public readonly exponentialBackoff: boolean
  public readonly respectRetryAfter: boolean

  /**
   * Creates a new DefaultRetryResolver instance.
   *
   * @param options - Configuration options for retry behavior
   */
  constructor(options: DefaultRetryResolverOptions = {}) {
    this.baseDelay = options.baseDelay ?? DEFAULT_BASE_DELAY
    this.maxDelay = options.maxDelay ?? DEFAULT_MAX_DELAY
    this.maxJitter = options.maxJitter ?? DEFAULT_MAX_JITTER
    this.exponentialBackoff = options.exponentialBackoff ?? true
    this.respectRetryAfter = options.respectRetryAfter ?? true
  }

  /**
   * Determines whether a request should be retried based on the response and attempt number.
   *
   * @param response - The HTTP response from undici
   * @param attemptNumber - The current attempt number (1-indexed, so first attempt is 1)
   * @returns A RetryDecision indicating whether to retry, the delay, and the reason
   *
   * @example
   * ```typescript
   * const decision = resolver.resolveRetryDecision(response, 2)
   * if (decision.shouldRetry) {
   *   console.log(`Retrying after ${decision.delay}ms: ${decision.reason}`)
   * }
   * ```
   */
  resolveRetryDecision(
    response: Dispatcher.ResponseData,
    attemptNumber: number,
    retryableResponseCodes: readonly number[],
  ): RetryDecision {
    const { statusCode, headers } = response

    if (!this.isRetryableStatusCode(statusCode, retryableResponseCodes)) {
      return {
        shouldRetry: false,
        reason: `Status code ${statusCode} is not retryable`,
      }
    }

    const delay = this.calculateDelay(headers, attemptNumber, statusCode)

    if (delay.error) {
      return {
        shouldRetry: false,
        reason: delay.error,
      }
    }

    return {
      shouldRetry: true,
      delay: delay.result,
      reason: `Retrying after ${delay.result}ms due to status ${statusCode}`,
    }
  }

  public isRetryableStatusCode(
    statusCode: number,
    retryableStatusCodes: readonly number[],
  ): boolean {
    return retryableStatusCodes.indexOf(statusCode) !== -1
  }

  private calculateDelay(
    headers: { 'retry-after'?: string },
    attemptNumber: number,
    statusCode: number,
  ): Either<string, number> {
    if (statusCode === 429 && this.respectRetryAfter && headers['retry-after']) {
      const retryAfterDelay = parseRetryAfterHeader(headers['retry-after'])
      if (retryAfterDelay.result !== undefined) {
        if (retryAfterDelay.result > this.maxDelay) {
          return {
            error: `Retry-After delay ${retryAfterDelay.result}ms exceeds maximum ${this.maxDelay}ms`,
          }
        }
        return { result: retryAfterDelay.result }
      }
    }

    if (statusCode === 503 && this.respectRetryAfter && headers['retry-after']) {
      const retryAfterDelay = parseRetryAfterHeader(headers['retry-after'])
      if (retryAfterDelay.result !== undefined) {
        if (retryAfterDelay.result > this.maxDelay) {
          return {
            error: `Retry-After delay ${retryAfterDelay.result}ms exceeds maximum ${this.maxDelay}ms`,
          }
        }
        return { result: retryAfterDelay.result }
      }
    }

    const calculatedDelay = this.calculateBackoffDelay(attemptNumber)
    return { result: Math.min(calculatedDelay, this.maxDelay) }
  }

  private calculateBackoffDelay(attemptNumber: number): number {
    let delay: number

    if (this.exponentialBackoff) {
      delay = this.baseDelay * Math.pow(2, attemptNumber - 1)
    } else {
      delay = this.baseDelay * attemptNumber
    }

    if (this.maxJitter > 0) {
      const jitter = Math.random() * this.maxJitter
      delay += jitter
    }

    return Math.min(delay, this.maxDelay)
  }
}

/**
 * Creates a DelayResolver function that determines retry delays for HTTP requests.
 *
 * This factory function returns a DelayResolver compatible with the undici-retry library's
 * DelayResolver interface, with full support for exponential or linear backoff strategies.
 *
 * @param options - Configuration options for retry behavior
 * @param options.baseDelay - Base delay in milliseconds (default: 100)
 * @param options.maxDelay - Maximum delay in milliseconds (default: 60000)
 * @param options.maxJitter - Maximum random jitter to add in milliseconds (default: 100)
 * @param options.exponentialBackoff - Use exponential backoff (true) or linear (false) (default: true)
 * @param options.respectRetryAfter - Whether to respect Retry-After headers for 429/503 (default: true)
 *
 * @returns A DelayResolver function that returns:
 *   - `number`: delay in milliseconds before retrying
 *   - `undefined`: use the default delay configured in RetryConfig
 *   - `-1`: abort retry (non-retryable status or delay exceeds maxDelay)
 *
 * @example
 * ```typescript
 * import { createDefaultRetryResolver } from 'undici-retry'
 *
 * // Exponential backoff: 100ms, 200ms, 400ms, 800ms, ...
 * const delayResolver = createDefaultRetryResolver({
 *   baseDelay: 100,
 *   maxDelay: 30000,
 *   exponentialBackoff: true,
 *   respectRetryAfter: true
 * })
 *
 * const response = await sendWithRetry(client, request, {
 *   maxAttempts: 5,
 *   statusCodesToRetry: [429, 503],
 *   delayResolver
 * })
 * ```
 */
export function createDefaultRetryResolver(
  options?: DefaultRetryResolverOptions,
): (
  response: Dispatcher.ResponseData,
  attemptNumber: number,
  retryableResponseCodes: readonly number[],
) => number | undefined {
  const resolver = new DefaultRetryResolver(options)

  return (
    response: Dispatcher.ResponseData,
    attemptNumber: number,
    retryableResponseCodes: readonly number[],
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is expected
  ): number | undefined => {
    // Check if status code is retryable
    if (!resolver.isRetryableStatusCode(response.statusCode, retryableResponseCodes)) {
      return -1
    }

    // For 429 and 503 (per HTTP spec these are the ones that can have this header), respect Retry-After if enabled
    const shouldRespectRetryAfter =
      resolver.respectRetryAfter &&
      (response.statusCode === 429 || response.statusCode === 503) &&
      response.headers['retry-after']

    if (shouldRespectRetryAfter) {
      const retryAfterDelay = parseRetryAfterHeader(response.headers['retry-after'] as string)

      if (retryAfterDelay.result !== undefined) {
        if (retryAfterDelay.result > resolver.maxDelay) {
          // Delay exceeds max, abort retry
          return -1
        }
        return retryAfterDelay.result
      }
      // If Retry-After parsing failed, fall through to backoff delay
    }

    // Calculate delay based on backoff strategy
    let delay: number

    if (resolver.exponentialBackoff) {
      delay = resolver.baseDelay * Math.pow(2, attemptNumber - 1)
    } else {
      delay = resolver.baseDelay * attemptNumber
    }

    if (resolver.maxJitter > 0) {
      const jitter = Math.random() * resolver.maxJitter
      delay += jitter
    }

    return Math.min(delay, resolver.maxDelay)
  }
}
