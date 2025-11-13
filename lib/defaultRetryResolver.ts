import type { Dispatcher } from 'undici'
import type { Either } from './either'

const DIGITS_ONLY_REGEX = /^\d+$/

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

/**
 * HTTP status codes that are commonly retryable.
 * These represent temporary failures that may succeed on retry.
 */
export type RetryableStatusCode = 408 | 425 | 429 | 500 | 502 | 503 | 504

const DEFAULT_RETRYABLE_STATUS_CODES: readonly RetryableStatusCode[] = [
  408, // Request Timeout
  425, // Too Early
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
] as const

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
  /** HTTP status codes that should trigger retry (default: [408, 425, 429, 500, 502, 503, 504]) */
  retryableStatusCodes?: readonly number[]
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
  private readonly baseDelay: number
  private readonly maxDelay: number
  private readonly maxJitter: number
  private readonly exponentialBackoff: boolean
  private readonly respectRetryAfter: boolean
  private readonly retryableStatusCodes: readonly number[]

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
    this.retryableStatusCodes = options.retryableStatusCodes ?? DEFAULT_RETRYABLE_STATUS_CODES
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
  resolveRetryDecision(response: Dispatcher.ResponseData, attemptNumber: number): RetryDecision {
    const { statusCode, headers } = response

    if (!this.isRetryableStatusCode(statusCode)) {
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

  private isRetryableStatusCode(statusCode: number): boolean {
    return this.retryableStatusCodes.indexOf(statusCode) !== -1
  }

  private calculateDelay(
    headers: { 'retry-after'?: string },
    attemptNumber: number,
    statusCode: number,
  ): Either<string, number> {
    if (statusCode === 429 && this.respectRetryAfter && headers['retry-after']) {
      const retryAfterDelay = this.parseRetryAfterHeader(headers['retry-after'])
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
      const retryAfterDelay = this.parseRetryAfterHeader(headers['retry-after'])
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

  private parseRetryAfterHeader(retryAfter: string): Either<string, number> {
    if (!retryAfter) {
      return { error: 'No Retry-After header provided' }
    }

    if (retryAfter.match(DIGITS_ONLY_REGEX)) {
      const seconds = Number.parseInt(retryAfter, 10)
      if (isNaN(seconds) || seconds < 0) {
        return { error: 'Invalid Retry-After seconds value' }
      }
      return { result: seconds * 1000 }
    }

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
 * DelayResolver interface. Since DelayResolver doesn't receive attempt numbers, this
 * implementation uses a fixed baseDelay rather than exponential backoff.
 *
 * For exponential backoff support, use the DefaultRetryResolver class directly.
 *
 * @param options - Configuration options for retry behavior
 * @param options.baseDelay - Base delay in milliseconds (default: 100)
 * @param options.maxDelay - Maximum delay in milliseconds (default: 60000)
 * @param options.maxJitter - Maximum random jitter to add in milliseconds (default: 100)
 * @param options.respectRetryAfter - Whether to respect Retry-After headers for 429/503 (default: true)
 * @param options.retryableStatusCodes - HTTP status codes that should trigger retry (default: [408, 425, 429, 500, 502, 503, 504])
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
 * const delayResolver = createDefaultRetryResolver({
 *   baseDelay: 200,
 *   maxDelay: 30000,
 *   respectRetryAfter: true
 * })
 *
 * const response = await sendWithRetry(client, request, {
 *   maxAttempts: 3,
 *   statusCodesToRetry: [429, 503],
 *   delayResolver
 * })
 * ```
 */
export function createDefaultRetryResolver(
  options?: DefaultRetryResolverOptions,
): (response: Dispatcher.ResponseData) => number | undefined {
  const resolver = new DefaultRetryResolver(options)

  return (response: Dispatcher.ResponseData): number | undefined => {
    // Check if status code is retryable
    if (!resolver['isRetryableStatusCode'](response.statusCode)) {
      return -1
    }

    // For 429 and 503, respect Retry-After if enabled
    const shouldRespectRetryAfter =
      resolver['respectRetryAfter'] &&
      (response.statusCode === 429 || response.statusCode === 503) &&
      response.headers['retry-after']

    if (shouldRespectRetryAfter) {
      const retryAfterDelay = resolver['parseRetryAfterHeader'](
        response.headers['retry-after'] as string
      )

      if (retryAfterDelay.result !== undefined) {
        if (retryAfterDelay.result > resolver['maxDelay']) {
          // Delay exceeds max, abort retry
          return -1
        }
        return retryAfterDelay.result
      }
      // If Retry-After parsing failed, fall through to use baseDelay
    }

    // Use baseDelay with jitter
    let delay = resolver['baseDelay']

    if (resolver['maxJitter'] > 0) {
      const jitter = Math.random() * resolver['maxJitter']
      delay += jitter
    }

    return Math.min(delay, resolver['maxDelay'])
  }
}
