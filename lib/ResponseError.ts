import { ErrorDetails } from './commonTypes'

export type RequestErrorParams = {
  message: string
  errorCode: string
  details?: ErrorDetails
  requestLabel?: string
}

export class ResponseError extends Error {
  public readonly details?: ErrorDetails
  public readonly errorCode: string
  public readonly isResponseError = true

  constructor(params: RequestErrorParams) {
    super(params.message)
    this.name = 'ResponseError'
    this.details = {
      ...params.details,
      requestLabel: params.requestLabel,
    }
    this.errorCode = params.errorCode
  }
}
