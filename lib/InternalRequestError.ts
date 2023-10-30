export type RequestErrorParams = {
  message: string
  error: Error
  requestLabel?: string
}

export class InternalRequestError extends Error {
  public readonly error: Error
  public readonly requestLabel?: string
  public readonly isInternalRequestError = true

  constructor(params: RequestErrorParams) {
    super(params.message)
    this.name = 'InternalRequestError'
    this.error = params.error
    this.requestLabel = params.requestLabel
  }
}
