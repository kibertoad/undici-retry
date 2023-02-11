export type ErrorDetails = Record<string, unknown>

export type RequestErrorParams = {
  message: string
  errorCode: string
  details?: ErrorDetails
}

export class RequestError extends Error {
  public readonly details?: ErrorDetails
  public readonly errorCode: string
  public isRequestError = true

  constructor(params: RequestErrorParams) {
    super(params.message)
    this.name = 'RequestError'
    this.details = params.details
    this.errorCode = params.errorCode
  }
}
