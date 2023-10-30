export type ErrorDetails = Record<string, unknown>

export type RequestErrorParams = {
  message: string
  errorCode: string
  details?: ErrorDetails
}

export class ResponseError extends Error {
  public readonly details?: ErrorDetails
  public readonly errorCode: string
  public readonly isResponseError = true

  constructor(params: RequestErrorParams) {
    super(params.message)
    this.name = 'ResponseError'
    this.details = params.details
    this.errorCode = params.errorCode
  }
}
