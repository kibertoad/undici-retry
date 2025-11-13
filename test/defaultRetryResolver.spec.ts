import type { Dispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vitest } from 'vitest'
import {
  createDefaultRetryResolver,
  DefaultRetryResolver,
  type DefaultRetryResolverOptions,
  type RetryDecision,
} from '../lib/defaultRetryResolver'

const SYSTEM_TIME_CONST = '2023-12-31T18:07:03.432Z'

describe('DefaultRetryResolver', () => {
  beforeEach(() => {
    vitest.useFakeTimers()
    vitest.setSystemTime(SYSTEM_TIME_CONST)
  })

  afterEach(() => {
    vitest.useRealTimers()
  })

  const createMockResponse = (
    statusCode: number,
    headers: Record<string, string> = {},
  ): Dispatcher.ResponseData => ({
    statusCode,
    headers,
    trailers: {},
    opaque: {},
    context: {},
    body: {
      dump: vitest.fn(),
      text: vitest.fn(),
      json: vitest.fn(),
      blob: vitest.fn(),
    } as any,
  })

  describe('constructor', () => {
    it('uses default options when none provided', () => {
      const resolver = new DefaultRetryResolver()
      const response = createMockResponse(429)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBeGreaterThanOrEqual(100)
      expect(decision.delay).toBeLessThanOrEqual(200)
    })

    it('accepts custom options', () => {
      const options: DefaultRetryResolverOptions = {
        baseDelay: 200,
        maxDelay: 10000,
        maxJitter: 50,
        exponentialBackoff: false,
        respectRetryAfter: false,
        retryableStatusCodes: [500, 502],
      }
      const resolver = new DefaultRetryResolver(options)
      const response = createMockResponse(500)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBeGreaterThanOrEqual(200)
      expect(decision.delay).toBeLessThanOrEqual(250)
    })
  })

  describe('retryable status codes', () => {
    it('retries on 408 Request Timeout', () => {
      const resolver = new DefaultRetryResolver()
      const response = createMockResponse(408)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBeDefined()
    })

    it('retries on 425 Too Early', () => {
      const resolver = new DefaultRetryResolver()
      const response = createMockResponse(425)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBeDefined()
    })

    it('retries on 429 Too Many Requests', () => {
      const resolver = new DefaultRetryResolver()
      const response = createMockResponse(429)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBeDefined()
    })

    it('retries on 500 Internal Server Error', () => {
      const resolver = new DefaultRetryResolver()
      const response = createMockResponse(500)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBeDefined()
    })

    it('retries on 502 Bad Gateway', () => {
      const resolver = new DefaultRetryResolver()
      const response = createMockResponse(502)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBeDefined()
    })

    it('retries on 503 Service Unavailable', () => {
      const resolver = new DefaultRetryResolver()
      const response = createMockResponse(503)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBeDefined()
    })

    it('retries on 504 Gateway Timeout', () => {
      const resolver = new DefaultRetryResolver()
      const response = createMockResponse(504)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBeDefined()
    })

    it('does not retry on non-retryable status codes', () => {
      const resolver = new DefaultRetryResolver()
      const testCases = [200, 201, 400, 401, 403, 404, 409, 410, 422]

      for (const statusCode of testCases) {
        const response = createMockResponse(statusCode)
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(false)
        expect(decision.reason).toContain(`Status code ${statusCode} is not retryable`)
      }
    })

    it('uses custom retryable status codes', () => {
      const resolver = new DefaultRetryResolver({
        retryableStatusCodes: [418, 420],
      })

      const response418 = createMockResponse(418)
      const decision418 = resolver.resolveRetryDecision(response418, 1)
      expect(decision418.shouldRetry).toBe(true)

      const response420 = createMockResponse(420)
      const decision420 = resolver.resolveRetryDecision(response420, 1)
      expect(decision420.shouldRetry).toBe(true)

      const response429 = createMockResponse(429)
      const decision429 = resolver.resolveRetryDecision(response429, 1)
      expect(decision429.shouldRetry).toBe(false)
    })
  })

  describe('Retry-After header handling', () => {
    describe('for 429 status code', () => {
      it('respects Retry-After header with seconds', () => {
        const resolver = new DefaultRetryResolver()
        const response = createMockResponse(429, { 'retry-after': '30' })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(true)
        expect(decision.delay).toBe(30000)
      })

      it('respects Retry-After header with HTTP date', () => {
        const resolver = new DefaultRetryResolver()
        // Use a fixed future date relative to our fake time
        // Note: toUTCString() loses millisecond precision, so the delay won't be exactly 5000ms
        const futureDate = new Date('2023-12-31T18:07:08.432Z').toUTCString()
        const response = createMockResponse(429, {
          'retry-after': futureDate,
        })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(true)
        // HTTP date format loses milliseconds, so 18:07:08.432 becomes 18:07:08.000
        // Current time is 18:07:03.432, so delay is 4568ms, not 5000ms
        expect(decision.delay).toBe(4568)
      })

      it('respects Retry-After header with ISO timestamp', () => {
        const resolver = new DefaultRetryResolver()
        // Use a fixed future date relative to our fake time
        const futureDate = '2023-12-31T18:07:06.432Z'
        const response = createMockResponse(429, {
          'retry-after': futureDate,
        })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(true)
        expect(decision.delay).toBe(3000)
      })

      it('rejects Retry-After delay exceeding max delay', () => {
        const resolver = new DefaultRetryResolver({ maxDelay: 5000 })
        const response = createMockResponse(429, { 'retry-after': '10' })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(false)
        expect(decision.reason).toContain('exceeds maximum')
      })

      it('ignores Retry-After when respectRetryAfter is false', () => {
        const resolver = new DefaultRetryResolver({ respectRetryAfter: false })
        const response = createMockResponse(429, { 'retry-after': '30' })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(true)
        expect(decision.delay).not.toBe(30000)
        expect(decision.delay).toBeGreaterThanOrEqual(100)
        expect(decision.delay).toBeLessThanOrEqual(200)
      })

      it('handles invalid Retry-After seconds', () => {
        const resolver = new DefaultRetryResolver()
        const response = createMockResponse(429, { 'retry-after': '-5' })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(true)
        expect(decision.delay).toBeGreaterThanOrEqual(100)
        expect(decision.delay).toBeLessThanOrEqual(200)
      })

      it('handles Retry-After date in the past', () => {
        const resolver = new DefaultRetryResolver()
        const response = createMockResponse(429, {
          'retry-after': '2023-12-30T00:00:00.000Z',
        })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(true)
        expect(decision.delay).toBeGreaterThanOrEqual(100)
        expect(decision.delay).toBeLessThanOrEqual(200)
      })

      it('handles invalid Retry-After format', () => {
        const resolver = new DefaultRetryResolver()
        const response = createMockResponse(429, { 'retry-after': 'invalid' })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(true)
        expect(decision.delay).toBeGreaterThanOrEqual(100)
        expect(decision.delay).toBeLessThanOrEqual(200)
      })

      it('handles decimal seconds in Retry-After', () => {
        const resolver = new DefaultRetryResolver()
        const response = createMockResponse(429, { 'retry-after': '30.5' })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(true)
        expect(decision.delay).toBeGreaterThanOrEqual(100)
        expect(decision.delay).toBeLessThanOrEqual(200)
      })
    })

    describe('for 503 status code', () => {
      it('respects Retry-After header with seconds', () => {
        const resolver = new DefaultRetryResolver()
        const response = createMockResponse(503, { 'retry-after': '15' })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(true)
        expect(decision.delay).toBe(15000)
      })

      it('respects Retry-After header with HTTP date', () => {
        const resolver = new DefaultRetryResolver()
        // Date.now() is mocked to return 2023-12-31T18:07:03.432Z
        // Adding 10000ms gives us 2023-12-31T18:07:13.432Z
        // toUTCString() loses milliseconds, becoming 2023-12-31T18:07:13.000Z
        const futureDate = new Date(Date.now() + 10000).toUTCString()
        const response = createMockResponse(503, {
          'retry-after': futureDate,
        })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(true)
        // Actual delay is 13.000 - 03.432 = 9.568 seconds = 9568ms
        expect(decision.delay).toBe(9568)
      })

      it('rejects Retry-After delay exceeding max delay', () => {
        const resolver = new DefaultRetryResolver({ maxDelay: 3000 })
        const response = createMockResponse(503, { 'retry-after': '5' })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(false)
        expect(decision.reason).toContain('exceeds maximum')
      })

      it('ignores Retry-After when respectRetryAfter is false', () => {
        const resolver = new DefaultRetryResolver({ respectRetryAfter: false })
        const response = createMockResponse(503, { 'retry-after': '20' })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(true)
        expect(decision.delay).not.toBe(20000)
      })
    })

    describe('for other status codes', () => {
      it('ignores Retry-After header for 500', () => {
        const resolver = new DefaultRetryResolver()
        const response = createMockResponse(500, { 'retry-after': '30' })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(true)
        expect(decision.delay).not.toBe(30000)
        expect(decision.delay).toBeGreaterThanOrEqual(100)
        expect(decision.delay).toBeLessThanOrEqual(200)
      })

      it('ignores Retry-After header for 502', () => {
        const resolver = new DefaultRetryResolver()
        const response = createMockResponse(502, { 'retry-after': '30' })
        const decision = resolver.resolveRetryDecision(response, 1)

        expect(decision.shouldRetry).toBe(true)
        expect(decision.delay).not.toBe(30000)
      })
    })
  })

  describe('backoff strategies', () => {
    describe('exponential backoff', () => {
      it('calculates exponential delays correctly', () => {
        const resolver = new DefaultRetryResolver({
          baseDelay: 100,
          maxJitter: 0,
          exponentialBackoff: true,
        })

        const response = createMockResponse(500)

        const decision1 = resolver.resolveRetryDecision(response, 1)
        expect(decision1.delay).toBe(100)

        const decision2 = resolver.resolveRetryDecision(response, 2)
        expect(decision2.delay).toBe(200)

        const decision3 = resolver.resolveRetryDecision(response, 3)
        expect(decision3.delay).toBe(400)

        const decision4 = resolver.resolveRetryDecision(response, 4)
        expect(decision4.delay).toBe(800)

        const decision5 = resolver.resolveRetryDecision(response, 5)
        expect(decision5.delay).toBe(1600)
      })

      it('caps exponential delay at maxDelay', () => {
        const resolver = new DefaultRetryResolver({
          baseDelay: 1000,
          maxDelay: 3000,
          maxJitter: 0,
          exponentialBackoff: true,
        })

        const response = createMockResponse(500)

        const decision1 = resolver.resolveRetryDecision(response, 1)
        expect(decision1.delay).toBe(1000)

        const decision2 = resolver.resolveRetryDecision(response, 2)
        expect(decision2.delay).toBe(2000)

        const decision3 = resolver.resolveRetryDecision(response, 3)
        expect(decision3.delay).toBe(3000)

        const decision4 = resolver.resolveRetryDecision(response, 4)
        expect(decision4.delay).toBe(3000)
      })

      it('caps calculated delay at maxDelay without jitter', () => {
        const resolver = new DefaultRetryResolver({
          baseDelay: 1000,
          maxDelay: 1500,
          maxJitter: 0,
          exponentialBackoff: true,
        })

        const response = createMockResponse(500)

        const decision1 = resolver.resolveRetryDecision(response, 1)
        expect(decision1.shouldRetry).toBe(true)
        expect(decision1.delay).toBe(1000)

        const decision2 = resolver.resolveRetryDecision(response, 2)
        expect(decision2.shouldRetry).toBe(true)
        expect(decision2.delay).toBe(1500) // Capped at maxDelay
      })
    })

    describe('linear backoff', () => {
      it('calculates linear delays correctly', () => {
        const resolver = new DefaultRetryResolver({
          baseDelay: 100,
          maxJitter: 0,
          exponentialBackoff: false,
        })

        const response = createMockResponse(500)

        const decision1 = resolver.resolveRetryDecision(response, 1)
        expect(decision1.delay).toBe(100)

        const decision2 = resolver.resolveRetryDecision(response, 2)
        expect(decision2.delay).toBe(200)

        const decision3 = resolver.resolveRetryDecision(response, 3)
        expect(decision3.delay).toBe(300)

        const decision4 = resolver.resolveRetryDecision(response, 4)
        expect(decision4.delay).toBe(400)
      })

      it('caps linear delay at maxDelay', () => {
        const resolver = new DefaultRetryResolver({
          baseDelay: 1000,
          maxDelay: 2500,
          maxJitter: 0,
          exponentialBackoff: false,
        })

        const response = createMockResponse(500)

        const decision1 = resolver.resolveRetryDecision(response, 1)
        expect(decision1.delay).toBe(1000)

        const decision2 = resolver.resolveRetryDecision(response, 2)
        expect(decision2.delay).toBe(2000)

        const decision3 = resolver.resolveRetryDecision(response, 3)
        expect(decision3.delay).toBe(2500)
      })
    })

    describe('jitter', () => {
      it('adds random jitter to delay', () => {
        const resolver = new DefaultRetryResolver({
          baseDelay: 100,
          maxJitter: 50,
          exponentialBackoff: false,
        })

        const response = createMockResponse(500)
        const decisions = new Set<number>()

        for (let i = 0; i < 20; i++) {
          const decision = resolver.resolveRetryDecision(response, 1)
          expect(decision.delay).toBeGreaterThanOrEqual(100)
          expect(decision.delay).toBeLessThanOrEqual(150)
          decisions.add(decision.delay!)
        }

        expect(decisions.size).toBeGreaterThan(1)
      })

      it('respects maxDelay even with jitter', () => {
        const resolver = new DefaultRetryResolver({
          baseDelay: 59950,
          maxDelay: 60000,
          maxJitter: 100,
        })

        const response = createMockResponse(500)

        for (let i = 0; i < 10; i++) {
          const decision = resolver.resolveRetryDecision(response, 1)
          expect(decision.delay).toBeLessThanOrEqual(60000)
        }
      })

      it('does not add jitter when maxJitter is 0', () => {
        const resolver = new DefaultRetryResolver({
          baseDelay: 100,
          maxJitter: 0,
        })

        const response = createMockResponse(500)

        for (let i = 0; i < 10; i++) {
          const decision = resolver.resolveRetryDecision(response, 1)
          expect(decision.delay).toBe(100)
        }
      })
    })
  })

  describe('reason messages', () => {
    it('provides reason for successful retry', () => {
      const resolver = new DefaultRetryResolver()
      const response = createMockResponse(429)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.reason).toContain('Retrying after')
      expect(decision.reason).toContain('due to status 429')
    })

    it('provides reason for non-retryable status', () => {
      const resolver = new DefaultRetryResolver()
      const response = createMockResponse(404)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.reason).toBe('Status code 404 is not retryable')
    })

    it('provides reason for exceeded delay', () => {
      const resolver = new DefaultRetryResolver({ maxDelay: 3000 })
      const response = createMockResponse(429, { 'retry-after': '5' })
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.reason).toContain('exceeds maximum')
    })
  })

  describe('createDefaultRetryResolver factory (DelayResolver)', () => {
    it('creates a DelayResolver with default options', () => {
      const delayResolver = createDefaultRetryResolver()
      const response = createMockResponse(429)
      const delay = delayResolver(response)

      expect(delay).toBeDefined()
      expect(typeof delay).toBe('number')
      expect(delay).toBeGreaterThanOrEqual(100)
      expect(delay).toBeLessThanOrEqual(200)
    })

    it('creates a DelayResolver with custom options', () => {
      const delayResolver = createDefaultRetryResolver({
        baseDelay: 200,
        maxJitter: 0,
        retryableStatusCodes: [418],
      })

      const response418 = createMockResponse(418)
      const delay418 = delayResolver(response418)
      expect(delay418).toBe(200)

      const response429 = createMockResponse(429)
      const delay429 = delayResolver(response429)
      expect(delay429).toBe(-1) // Not in retryableStatusCodes
    })

    it('uses fixed baseDelay (no exponential backoff)', () => {
      const delayResolver = createDefaultRetryResolver({
        baseDelay: 100,
        maxJitter: 0,
        exponentialBackoff: true, // This is ignored in DelayResolver mode
      })

      const response = createMockResponse(500)

      // DelayResolver doesn't receive attemptNumber, so it always uses baseDelay
      const delay1 = delayResolver(response)
      expect(delay1).toBe(100)

      const delay2 = delayResolver(response)
      expect(delay2).toBe(100)

      const delay3 = delayResolver(response)
      expect(delay3).toBe(100)
    })

    it('returns -1 for non-retryable status codes', () => {
      const delayResolver = createDefaultRetryResolver()
      const testCases = [200, 201, 400, 401, 403, 404]

      for (const statusCode of testCases) {
        const response = createMockResponse(statusCode)
        const delay = delayResolver(response)
        expect(delay).toBe(-1)
      }
    })

    it('respects Retry-After header for 429', () => {
      const delayResolver = createDefaultRetryResolver()
      const response = createMockResponse(429, { 'retry-after': '5' })
      const delay = delayResolver(response)

      expect(delay).toBe(5000)
    })

    it('respects Retry-After header for 503', () => {
      const delayResolver = createDefaultRetryResolver()
      const response = createMockResponse(503, { 'retry-after': '3' })
      const delay = delayResolver(response)

      expect(delay).toBe(3000)
    })

    it('returns -1 when Retry-After exceeds maxDelay', () => {
      const delayResolver = createDefaultRetryResolver({ maxDelay: 2000 })
      const response = createMockResponse(429, { 'retry-after': '5' })
      const delay = delayResolver(response)

      expect(delay).toBe(-1)
    })

    it('falls back to baseDelay when Retry-After is invalid', () => {
      const delayResolver = createDefaultRetryResolver({
        baseDelay: 100,
        maxJitter: 0,
      })
      const response = createMockResponse(429, { 'retry-after': 'invalid' })
      const delay = delayResolver(response)

      expect(delay).toBe(100)
    })

    it('ignores Retry-After when respectRetryAfter is false', () => {
      const delayResolver = createDefaultRetryResolver({
        baseDelay: 100,
        maxJitter: 0,
        respectRetryAfter: false,
      })
      const response = createMockResponse(429, { 'retry-after': '30' })
      const delay = delayResolver(response)

      expect(delay).toBe(100)
    })

    it('adds jitter to delay', () => {
      const delayResolver = createDefaultRetryResolver({
        baseDelay: 100,
        maxJitter: 50,
      })

      const response = createMockResponse(500)
      const delays = new Set<number>()

      for (let i = 0; i < 20; i++) {
        const delay = delayResolver(response)
        expect(delay).toBeGreaterThanOrEqual(100)
        expect(delay).toBeLessThanOrEqual(150)
        delays.add(delay!)
      }

      expect(delays.size).toBeGreaterThan(1)
    })

    it('respects maxDelay cap', () => {
      const delayResolver = createDefaultRetryResolver({
        baseDelay: 100,
        maxDelay: 120,
        maxJitter: 50,
      })

      const response = createMockResponse(500)

      for (let i = 0; i < 10; i++) {
        const delay = delayResolver(response)
        expect(delay).toBeLessThanOrEqual(120)
      }
    })

    it('handles Retry-After with ISO date format', () => {
      const delayResolver = createDefaultRetryResolver()
      const futureDate = '2023-12-31T18:07:06.432Z'
      const response = createMockResponse(429, { 'retry-after': futureDate })
      const delay = delayResolver(response)

      expect(delay).toBe(3000)
    })

    it('handles truly empty Retry-After header (empty object property)', () => {
      const delayResolver = createDefaultRetryResolver({
        baseDelay: 150,
        maxJitter: 0,
      })
      // Create response with retry-after property present but with empty/falsy value
      const response = createMockResponse(429, {})
      // Manually set to empty string to trigger the parseRetryAfterHeader path
      Object.defineProperty(response.headers, 'retry-after', {
        value: '',
        enumerable: true,
        configurable: true,
      })

      const delay = delayResolver(response)

      // Should fall back to baseDelay since empty string can't be parsed
      expect(delay).toBe(150)
    })
  })

  describe('edge cases', () => {
    it('handles empty headers object', () => {
      const resolver = new DefaultRetryResolver()
      const response = createMockResponse(429)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBeGreaterThanOrEqual(100)
    })

    it('handles truly empty Retry-After header via resolveRetryDecision', () => {
      const resolver = new DefaultRetryResolver({ baseDelay: 200, maxJitter: 0 })
      const response = createMockResponse(429, {})
      // Set retry-after to empty string
      Object.defineProperty(response.headers, 'retry-after', {
        value: '',
        enumerable: true,
        configurable: true,
      })

      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      // Should fall back to baseDelay
      expect(decision.delay).toBe(200)
    })

    it('handles attempt number 0', () => {
      const resolver = new DefaultRetryResolver({
        baseDelay: 100,
        maxJitter: 0,
        exponentialBackoff: true,
      })
      const response = createMockResponse(500)
      const decision = resolver.resolveRetryDecision(response, 0)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBe(50)
    })

    it('handles very large attempt numbers', () => {
      const resolver = new DefaultRetryResolver({
        baseDelay: 100,
        maxDelay: 5000,
        maxJitter: 0,
        exponentialBackoff: true,
      })
      const response = createMockResponse(500)
      const decision = resolver.resolveRetryDecision(response, 20)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBe(5000) // Capped at maxDelay
    })

    it('handles NaN in Retry-After header', () => {
      const resolver = new DefaultRetryResolver()
      const response = createMockResponse(429, { 'retry-after': 'NaN' })
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBeGreaterThanOrEqual(100)
      expect(decision.delay).toBeLessThanOrEqual(200)
    })

    it('handles empty Retry-After header', () => {
      const resolver = new DefaultRetryResolver()
      const response = createMockResponse(429, { 'retry-after': '' })
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBeGreaterThanOrEqual(100)
      expect(decision.delay).toBeLessThanOrEqual(200)
    })

    it('handles zero baseDelay', () => {
      const resolver = new DefaultRetryResolver({
        baseDelay: 0,
        maxJitter: 0,
      })
      const response = createMockResponse(500)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBe(0)
    })

    it('handles zero maxDelay', () => {
      const resolver = new DefaultRetryResolver({
        baseDelay: 100,
        maxDelay: 0,
        maxJitter: 0,
      })
      const response = createMockResponse(500)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(true)
      expect(decision.delay).toBe(0) // Capped at maxDelay of 0
    })

    it('handles empty retryableStatusCodes array', () => {
      const resolver = new DefaultRetryResolver({
        retryableStatusCodes: [],
      })
      const response = createMockResponse(429)
      const decision = resolver.resolveRetryDecision(response, 1)

      expect(decision.shouldRetry).toBe(false)
      expect(decision.reason).toContain('not retryable')
    })
  })
})
