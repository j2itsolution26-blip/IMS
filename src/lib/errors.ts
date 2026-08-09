/**
 * Domain errors. Services throw these; the server-action wrapper in
 * `src/lib/action.ts` turns them into typed failures the UI can render.
 */

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'You need to sign in to continue.') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that.') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class NotFoundError extends AppError {
  constructor(entity = 'Record') {
    super(`${entity} not found.`, 'NOT_FOUND', 404);
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message, 'VALIDATION_ERROR', 422);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
  }
}

/** Raised when a movement would take stock below zero. */
export class InsufficientStockError extends AppError {
  constructor(productName: string, available: number, requested: number) {
    super(
      `Not enough stock for ${productName}. Available: ${available}, requested: ${requested}.`,
      'INSUFFICIENT_STOCK',
      409,
    );
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(`Too many requests. Try again in ${retryAfterSeconds}s.`, 'RATE_LIMITED', 429);
  }
}
