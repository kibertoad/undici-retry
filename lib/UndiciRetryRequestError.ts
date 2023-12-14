export type RequestErrorParams = {
  message: string
  error: Error
  requestLabel?: string
}

export type InternalRequestError = Error & {
  requestLabel?: string
  isInternalRequestError?: boolean
}

export class UndiciRetryRequestError extends Error implements InternalRequestError {
  public readonly requestLabel?: string
  public readonly error: Error
  public readonly isInternalRequestError = true

  constructor(params: RequestErrorParams) {
    super(params.message)
    this.name = 'InternalRequestError'
    this.requestLabel = params.requestLabel
    this.error = params.error
  }
}
