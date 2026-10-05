/**
 * Error thrown for every failed request: API errors (non-2xx or `success: false`),
 * network failures and timeouts.
 */
export class RealtimeSportsError extends Error {
  /** HTTP status code, or `undefined` for network errors and timeouts. */
  readonly status: number | undefined;
  /** API error code (e.g. `MISSING_TOKEN`, `rate_limit_exceeded`), or `NETWORK_ERROR` / `TIMEOUT` / `ABORTED`. */
  readonly code: string;
  /** Optional hint from the API on how to fix the request. */
  readonly hint: string | undefined;
  /** Seconds from the `Retry-After` header (429 responses), when present. */
  readonly retryAfter: number | undefined;
  /** Parsed response body, when there was one. */
  readonly body: unknown;

  constructor(init: {
    message: string;
    code: string;
    status?: number;
    hint?: string;
    retryAfter?: number;
    body?: unknown;
    cause?: unknown;
  }) {
    super(init.message);
    this.name = 'RealtimeSportsError';
    this.status = init.status;
    this.code = init.code;
    this.hint = init.hint;
    this.retryAfter = init.retryAfter;
    this.body = init.body;
    if (init.cause !== undefined) (this as { cause?: unknown }).cause = init.cause;
  }

  /** True for 429 (monthly quota exhausted). */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** True for 401/403 (missing, invalid or expired key; plan does not include the feature). */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}
