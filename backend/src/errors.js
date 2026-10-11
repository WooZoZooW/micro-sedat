export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (code, message) => new AppError(401, code, message);
export const forbidden = (code, message) => new AppError(403, code, message);
export const notFound = (code, message) => new AppError(404, code, message);
export const conflict = (code, message) => new AppError(409, code, message);
export const payloadTooLarge = (code, message) => new AppError(413, code, message);
export const tooManyRequests = (code, message) => new AppError(429, code, message);
export const badGateway = (code, message, details) => new AppError(502, code, message, details);
export const serviceUnavailable = (code, message) => new AppError(503, code, message);
