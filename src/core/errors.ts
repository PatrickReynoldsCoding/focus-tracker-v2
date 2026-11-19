export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = status === 404 ? 'not_found' : status === 401 ? 'unauthorized' : status === 409 ? 'conflict' : 'bad_request',
    /** Extra fields for the JSON answer (a conflict sends the current row). */
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what: string, id: string) => new ApiError(404, `No ${what} with id ${id}`);
export const bad = (message: string) => new ApiError(400, message);
