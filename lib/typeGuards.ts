import { RequestInternalError, RequestResult } from './undiciRetry'
import { ResponseError } from './ResponseError'

export function isInternalRequestError(entity: unknown): entity is RequestInternalError {
  return 'error' in (entity as RequestInternalError)
}

export function isRequestResult(entity: unknown): entity is RequestResult<unknown> {
  return 'statusCode' in (entity as RequestResult<unknown>)
}

export function isResponseError(entity: unknown): entity is ResponseError {
  return 'isResponseError' in (entity as ResponseError)
}
