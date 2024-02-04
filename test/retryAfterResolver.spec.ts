import { afterEach, vitest } from 'vitest'
import { resolveDelayTime } from '../lib/retryAfterResolver'

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
      'retry-after': '30',
    })

    expect(resolvedRetryDelay.result).toBe(30000)
  })

  it('Resolves retry time from header in seconds, capped by maximum', () => {
    const resolvedRetryDelay = resolveDelayTime({
      'retry-after': '900',
    })

    expect(resolvedRetryDelay.error).toBe('max_delay_exceeded')
  })

  it('Returns undefined if there is a decimal part', () => {
    const resolvedRetryDelay = resolveDelayTime({
      'retry-after': '30.5',
    })

    expect(resolvedRetryDelay.error).toBe('unknown_format')
  })

  it('Returns undefined if header is not set', () => {
    const resolvedRetryDelay = resolveDelayTime({})

    expect(resolvedRetryDelay.error).toBe('header_not_set')
  })

  it('Returns undefined if header is in unknown format', () => {
    const resolvedRetryDelay = resolveDelayTime({
      'retry-after': 'dummy',
    })

    expect(resolvedRetryDelay.error).toBe('unknown_format')
  })

  it('Returns retry time if header is an HTTP date', () => {
    const resolvedRetryDelay = resolveDelayTime(
      {
        'retry-after': 'Fri, 31 Dec 2023 23:59:59 GMT',
      },
      25000000,
    )

    expect(resolvedRetryDelay.result).toBe(21175568)
  })

  it('Returns retry time if header is a timestamp', () => {
    const resolvedRetryDelay = resolveDelayTime(
      {
        'retry-after': '2023-12-31T20:00:00.000Z',
      },
      7000000,
    )

    expect(resolvedRetryDelay.result).toBe(6776568)
  })

  it('Returns maximum exceeded error for a timestamp', () => {
    const resolvedRetryDelay = resolveDelayTime({
      'retry-after': '2023-12-31T20:00:00.000Z',
    })

    expect(resolvedRetryDelay.error).toBe('max_delay_exceeded')
  })
})
