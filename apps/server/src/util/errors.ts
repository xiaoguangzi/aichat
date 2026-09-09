export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError('not_found', `${what} not found`, 404);
export const badRequest = (msg: string) => new AppError('bad_request', msg, 400);

export function errorToPayload(err: unknown): { code: string; message: string; status: number } {
  if (err instanceof AppError) return { code: err.code, message: err.message, status: err.status };
  if (err && typeof err === 'object' && 'name' in err && (err as Error).name === 'AbortError')
    return { code: 'aborted', message: 'Request aborted', status: 499 };
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'internal', message, status: 500 };
}
