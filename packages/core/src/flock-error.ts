export type FlockErrorCode =
  | 'ROOM_FULL'
  | 'AUTH_FAILED'
  | 'NETWORK_ERROR'
  | 'ENCRYPTION_ERROR'
  | 'INVALID_STATE';

export class FlockError extends Error {
  public readonly code: FlockErrorCode;

  public readonly recoverable: boolean;

  public readonly cause: unknown;

  public constructor(code: FlockErrorCode, message: string, recoverable: boolean, cause?: unknown) {
    super(message);
    this.name = 'FlockError';
    this.code = code;
    this.recoverable = recoverable;
    this.cause = cause;
  }
}

export function createFlockError(
  code: FlockErrorCode,
  message: string,
  recoverable: boolean,
  cause?: unknown,
): FlockError {
  return new FlockError(code, message, recoverable, cause);
}
