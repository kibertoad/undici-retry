export type ErrorDetails = Record<string, unknown>

export type RequestErrorParams = {
  message: string
  errorCode: string
  details?: ErrorDetails
  requestLabel?: string
}

export class ResponseError extends Error {
  public readonly details?: ErrorDetails
  public readonly errorCode: string
  public readonly requestLabel?: string
  public readonly isResponseError = true

  constructor(params: RequestErrorParams) {
    super(params.message)
    this.name = 'ResponseError'
    this.details = params.details
    this.errorCode = params.errorCode
    this.requestLabel = params.requestLabel
  }
}
