const DIGITS_ONLY_REGEX = /^\d+$/

export function resolveDelayTime(headers: { 'Retry-After'?: string }) {
  const retryAfter = headers['Retry-After']

  if (!retryAfter) {
    return undefined
  }

  if (retryAfter.match(DIGITS_ONLY_REGEX)) {
    return parseInt(retryAfter) * 1000
  }

  const date = new Date(retryAfter)
  if (!isNaN(date.getTime())) {
    return date.getTime() - Date.now()
  }
  return undefined
}
