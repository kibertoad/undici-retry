import { ErrorDetails } from './commonTypes'

export type RequestErrorParams = {
  message: string
  error: Error
  requestLabel?: string
}

export class InternalRequestError extends Error {
  public readonly details?: ErrorDetails
  public readonly error: Error
  public readonly isInternalRequestError = true

  constructor(params: RequestErrorParams) {
    super(params.message)
    this.name = 'InternalRequestError'
    this.details = {
      requestLabel: params.requestLabel,
    }
    this.error = params.error
  }
}
