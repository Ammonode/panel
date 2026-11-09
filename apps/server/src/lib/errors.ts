export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message)
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`, 'not_found')
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new HttpError(403, message, 'forbidden')
export const unauthorized = () => new HttpError(401, 'Unauthenticated', 'unauthenticated')
export const badRequest = (message: string, details?: unknown) =>
  new HttpError(422, message, 'invalid', details)
