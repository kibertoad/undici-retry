import type { Dispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vitest } from 'vitest'
import { createDelayToNextMinuteResolver } from '../lib/delayResolvers'

const SYSTEM_TIME_CONST = '2023-10-04T18:07:03.432Z'

describe('delayResolver', () => {
  beforeEach(() => {
    vitest.useFakeTimers()
    vitest.setSystemTime(SYSTEM_TIME_CONST)
  })

  afterEach(() => {
    vitest.useRealTimers()
  })

  describe('createDelayToNextMinuteResolver', () => {
    it('resolves time with default configuration', () => {
      const delayResolver = createDelayToNextMinuteResolver()

      const resolvedTime = delayResolver({
        statusCode: 429,
      } as Dispatcher.ResponseData)

      expect(resolvedTime).toBe(56668)
    })

    it('resolves time with configuration override', () => {
      const delayResolver = createDelayToNextMinuteResolver({
        offsetInMsecs: 200,
      })

      const resolvedTime = delayResolver({
        statusCode: 429,
      } as Dispatcher.ResponseData)

      expect(resolvedTime).toBe(56768)
    })

    it('does not process status codes other than 429', () => {
      const delayResolver = createDelayToNextMinuteResolver({
        offsetInMsecs: 200,
      })

      const resolvedTime = delayResolver({
        statusCode: 502,
      } as Dispatcher.ResponseData)

      expect(resolvedTime).toBeUndefined()
    })
  })
})
