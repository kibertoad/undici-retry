import { DelayResolver } from './undiciRetry'

export type CreateDelayToNextMinuteResolverConfig = {
  offsetInMsecs: number
}

export function createDelayToNextMinuteResolver(
  config: CreateDelayToNextMinuteResolverConfig = {
    offsetInMsecs: 100,
  },
): DelayResolver {
  const offset = config.offsetInMsecs

  return (response) => {
    const now = Date.now()
    if (response.statusCode === 429) {
      return 60000 - (now % 60000) + offset
    }
    return undefined
  }
}
