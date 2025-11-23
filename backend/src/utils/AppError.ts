/**
 * Custom error class for operational errors
 * Provides structured error information for API responses
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly status: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Helper function to create a 404 Not Found error
 */
export const notFound = (message: string = 'Resource not found') => {
  return new AppError(message, 404);
};

/**
 * Helper function to create a 400 Bad Request error
 */
export const badRequest = (message: string = 'Bad request') => {
  return new AppError(message, 400);
};

/**
 * Helper function to create a 500 Internal Server Error
 */
export const internalError = (message: string = 'Internal server error') => {
  return new AppError(message, 500);
};
