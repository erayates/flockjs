import type { FlockError } from './types';

export function createFlockError(
  code: FlockError['code'],
  message: string,
  recoverable: boolean,
  cause?: unknown,
): FlockError {
  const error = new Error(message) as FlockError;
  error.name = 'FlockError';
  error.code = code;
  error.recoverable = recoverable;

  if (cause !== undefined) {
    error.cause = cause;
  }

  return error;
}
