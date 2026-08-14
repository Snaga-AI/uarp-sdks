/** Error hierarchy. Everything the SDK throws derives from `UarpError`. */

/** RFC 9457 problem document returned by the API on failure. */
export interface ProblemDocument {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  correlationId?: string;
  errors?: Array<{ field?: string; message?: string }>;
  [key: string]: unknown;
}

export class UarpError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The request never produced an HTTP response (DNS, TLS, socket, CORS). */
export class APIConnectionError extends UarpError {
  constructor(message = 'Connection error', options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** The request exceeded the configured timeout or was aborted by the caller. */
export class APITimeoutError extends APIConnectionError {
  constructor(message = 'Request timed out') {
    super(message);
  }
}

/** Base class for every non-2xx response. */
export class APIError extends UarpError {
  readonly status: number;
  readonly problem: ProblemDocument;
  readonly headers: Headers;
  /** `correlationId` from the problem document, or the `X-Correlation-Id` header. */
  readonly correlationId?: string;
  readonly requestId?: string;

  constructor(status: number, problem: ProblemDocument, headers: Headers, message?: string) {
    super(message ?? formatMessage(status, problem));
    this.status = status;
    this.problem = problem;
    this.headers = headers;
    this.correlationId = problem.correlationId ?? headers.get('x-correlation-id') ?? undefined;
    this.requestId = headers.get('x-request-id') ?? undefined;
  }

  /** Field-level validation failures, present on 422 responses. */
  get validationErrors(): Array<{ field?: string; message?: string }> {
    return this.problem.errors ?? [];
  }
}

export class BadRequestError extends APIError {}
export class AuthenticationError extends APIError {}
export class PermissionDeniedError extends APIError {}
export class NotFoundError extends APIError {}
export class ConflictError extends APIError {}
export class GoneError extends APIError {}
export class PayloadTooLargeError extends APIError {}
export class UnprocessableEntityError extends APIError {}
export class InternalServerError extends APIError {}
export class ServiceUnavailableError extends InternalServerError {}

export class RateLimitError extends APIError {
  /** Seconds the server asked the client to wait, when it said so. */
  readonly retryAfterSeconds?: number;

  constructor(status: number, problem: ProblemDocument, headers: Headers) {
    super(status, problem, headers);
    const raw = headers.get('retry-after');
    const parsed = raw === null ? Number.NaN : Number.parseFloat(raw);
    this.retryAfterSeconds = Number.isFinite(parsed) ? parsed : undefined;
  }

  /** Requests allowed in the current window, from `X-RateLimit-Limit`. */
  get limit(): number | undefined {
    return numericHeader(this.headers, 'x-ratelimit-limit');
  }

  get remaining(): number | undefined {
    return numericHeader(this.headers, 'x-ratelimit-remaining');
  }

  /** Unix seconds at which the window resets, from `X-RateLimit-Reset`. */
  get reset(): number | undefined {
    return numericHeader(this.headers, 'x-ratelimit-reset');
  }
}

function numericHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

function formatMessage(status: number, problem: ProblemDocument): string {
  const title = problem.title ?? `HTTP ${status}`;
  const detail = problem.detail ? ` — ${problem.detail}` : '';
  const correlation = problem.correlationId ? ` (correlationId: ${problem.correlationId})` : '';
  return `${status} ${title}${detail}${correlation}`;
}

export function errorForStatus(status: number, problem: ProblemDocument, headers: Headers): APIError {
  switch (status) {
    case 400:
      return new BadRequestError(status, problem, headers);
    case 401:
      return new AuthenticationError(status, problem, headers);
    case 403:
      return new PermissionDeniedError(status, problem, headers);
    case 404:
      return new NotFoundError(status, problem, headers);
    case 409:
      return new ConflictError(status, problem, headers);
    case 410:
      return new GoneError(status, problem, headers);
    case 413:
      return new PayloadTooLargeError(status, problem, headers);
    case 422:
      return new UnprocessableEntityError(status, problem, headers);
    case 429:
      return new RateLimitError(status, problem, headers);
    case 503:
      return new ServiceUnavailableError(status, problem, headers);
    default:
      if (status >= 500) return new InternalServerError(status, problem, headers);
      return new APIError(status, problem, headers);
  }
}
