import { RequestInternalError, RequestResult } from './undiciRetry'
import { ResponseError } from './ResponseError'
import { InternalRequestError } from './InternalRequestError'

export function isRequestInternalError(entity: unknown): entity is RequestInternalError {
  return 'error' in (entity as RequestInternalError)
}

export function isInternalRequestError(entity: unknown): entity is InternalRequestError {
  return 'isInternalRequestError' in (entity as InternalRequestError)
}

export function isRequestResult(entity: unknown): entity is RequestResult<unknown> {
  return 'statusCode' in (entity as RequestResult<unknown>)
}

export function isResponseError(entity: unknown): entity is ResponseError {
  return 'isResponseError' in (entity as ResponseError)
}
