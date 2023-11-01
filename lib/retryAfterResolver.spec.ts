import { resolveDelayTime } from './retryAfterResolver'
import { afterEach, vitest } from 'vitest'

const SYSTEM_TIME_CONST = '2023-12-31T18:07:03.432Z'

describe('retryAfterResolver', () => {
  beforeEach(() => {
    vitest.useFakeTimers()
    vitest.setSystemTime(SYSTEM_TIME_CONST)
  })

  afterEach(() => {
    vitest.useRealTimers()
  })

  it('Resolves retry time from header in seconds', () => {
    const resolvedRetryDelay = resolveDelayTime({
      'Retry-After': '30',
    })

    expect(resolvedRetryDelay).toBe(30000)
  })

  it('Ignores decimal part', () => {
    const resolvedRetryDelay = resolveDelayTime({
      'Retry-After': '30.5',
    })

    expect(resolvedRetryDelay).toBe(30000)
  })

  it('Returns undefined if header is not set', () => {
    const resolvedRetryDelay = resolveDelayTime({})

    expect(resolvedRetryDelay).toBe(undefined)
  })

  it('Returns undefined if header is in unknown format', () => {
    const resolvedRetryDelay = resolveDelayTime({
      'Retry-After': 'dummy',
    })

    expect(resolvedRetryDelay).toBe(undefined)
  })

  it('Returns retry time if header is an HTTP date', () => {
    const resolvedRetryDelay = resolveDelayTime({
      'Retry-After': 'Fri, 31 Dec 2023 23:59:59 GMT',
    })

    expect(resolvedRetryDelay).toBe(21175568)
  })

  it('Returns retry time if header is a timestamp', () => {
    const resolvedRetryDelay = resolveDelayTime({
      'Retry-After': '2023-12-31T20:00:00.000Z',
    })

    expect(resolvedRetryDelay).toBe(6776568)
  })
})
