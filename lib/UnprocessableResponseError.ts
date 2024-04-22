import type { ErrorDetails } from './commonTypes'

export type RequestErrorParams = {
  message: string
  errorCode: string
  details?: ErrorDetails
  requestLabel?: string
  rawBody: string
}

export class UnprocessableResponseError extends Error {
  public readonly details?: ErrorDetails
  public readonly errorCode: string
  public readonly isUnprocessableResponseError = true

  constructor(params: RequestErrorParams) {
    super(params.message)
    this.name = 'UnprocessableResponseError'
    this.details = {
      rawBody: params.rawBody,
      requestLabel: params.requestLabel,
    }
    this.errorCode = params.errorCode
  }
}
