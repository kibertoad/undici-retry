import type { Either } from './either'

const DIGITS_ONLY_REGEX = /^\d+$/

export function resolveDelayTime(
  headers: { 'retry-after'?: string },
  maxDelay = 60000,
): Either<'header_not_set' | 'unknown_format' | 'max_delay_exceeded', number> {
  const retryAfter = headers['retry-after']

  if (!retryAfter) {
    return {
      error: 'header_not_set',
    }
  }

  let resolvedDelay: number | undefined

  // parse as number
  if (retryAfter.match(DIGITS_ONLY_REGEX)) {
    resolvedDelay = Number.parseInt(retryAfter) * 1000
  }
  // parse as date
  else {
    const date = new Date(retryAfter)
    if (!isNaN(date.getTime())) {
      resolvedDelay = date.getTime() - Date.now()
    }
  }

  if (resolvedDelay) {
    return resolvedDelay <= maxDelay
      ? {
          result: resolvedDelay,
        }
      : {
          error: 'max_delay_exceeded',
        }
  }

  return {
    error: 'unknown_format',
  }
}
