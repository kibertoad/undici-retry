import { RequestInternalError, RequestResult } from './undiciRetry'

export function isInternalRequestError(entity: unknown): entity is RequestInternalError {
  return 'error' in (entity as RequestInternalError)
}

export function isRequestResult(entity: unknown): entity is RequestResult<unknown> {
  return 'statusCode' in (entity as RequestResult<unknown>)
}
