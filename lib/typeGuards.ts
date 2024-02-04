import { InternalRequestError, UndiciRetryRequestError } from './UndiciRetryRequestError'
import { UnprocessableResponseError } from './UnprocessableResponseError'
import { RequestResult } from './undiciRetry'

export function isInternalRequestError(entity: unknown): entity is InternalRequestError {
  return 'isInternalRequestError' in (entity as UndiciRetryRequestError)
}

export function isRequestResult(entity: unknown): entity is RequestResult<unknown> {
  return 'statusCode' in (entity as RequestResult<unknown>)
}

export function isUnprocessableResponseError(
  entity: unknown,
): entity is UnprocessableResponseError {
  return 'isUnprocessableResponseError' in (entity as UnprocessableResponseError)
}
