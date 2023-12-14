import { RequestResult } from './undiciRetry'
import { ResponseError } from './ResponseError'
import { InternalRequestError, UndiciRetryRequestError } from './UndiciRetryRequestError'

export function isInternalRequestError(entity: unknown): entity is InternalRequestError {
  return 'isInternalRequestError' in (entity as UndiciRetryRequestError)
}

export function isRequestResult(entity: unknown): entity is RequestResult<unknown> {
  return 'statusCode' in (entity as RequestResult<unknown>)
}

export function isResponseError(entity: unknown): entity is ResponseError {
  return 'isResponseError' in (entity as ResponseError)
}
