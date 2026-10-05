import { RealtimeSportsError } from './errors';
import type { APIResponse, ResponseMeta } from './types';

export const DEFAULT_BASE_URL = 'https://www.realtimesportsapi.com/api/v1';
export const VERSION = '0.1.0';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** Your API key. Defaults to `process.env.REALTIME_SPORTS_API_KEY` when available. */
  apiKey?: string;
  /** Defaults to `https://www.realtimesportsapi.com/api/v1`. */
  baseUrl?: string;
  /**
   * URL for `POST /websocket/auth`. Defaults to the base URL with the trailing `/v1` replaced by
   * `/websocket/auth` (i.e. `https://www.realtimesportsapi.com/api/websocket/auth`).
   */
  websocketAuthUrl?: string;
  /** Retries after the first attempt for retryable failures. Default 2. */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /**
   * Longest `Retry-After` (seconds) the client will wait out on a 429. A 429 asking for a longer
   * wait is thrown immediately: monthly quota exhaustion does not clear in seconds. Default 60.
   */
  maxRetryAfterSeconds?: number;
  /** Send the key as `X-API-Key` instead of `Authorization: Bearer`. Default false. */
  useApiKeyHeader?: boolean;
  /** Custom fetch implementation. Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}

export interface RequestOptions {
  /** Abort the request. */
  signal?: AbortSignal;
  /** Override the client's per-attempt timeout. */
  timeoutMs?: number;
  /** Override the client's retry count. */
  maxRetries?: number;
  /** Extra headers for this request. */
  headers?: Record<string, string>;
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;

export interface RequestSpec {
  method: HttpMethod;
  /** Path relative to the base URL (e.g. `/sports`), or an absolute URL. */
  path: string;
  query?: Record<string, QueryValue> | object;
  body?: unknown;
  options?: RequestOptions;
}

/**
 * Promise for an API call. Awaiting it resolves to the response `data`; call `.withMeta()` to get
 * `{ data, meta, status, headers }` instead (e.g. to read `meta.rateLimit.remaining`).
 */
export class APIPromise<T> implements PromiseLike<T> {
  constructor(private readonly responsePromise: Promise<APIResponse<T>>) {}

  /** Resolve to the full response: `{ data, meta, status, headers }`. */
  withMeta(): Promise<APIResponse<T>> {
    return this.responsePromise;
  }

  then<R1 = T, R2 = never>(
    onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return this.responsePromise.then((r) => r.data).then(onfulfilled, onrejected);
  }

  catch<R = never>(onrejected?: ((reason: any) => R | PromiseLike<R>) | null): Promise<T | R> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.responsePromise.then((r) => r.data).finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'APIPromise';
  }
}

const IDEMPOTENT: ReadonlySet<HttpMethod> = new Set(['GET', 'PUT', 'DELETE']);

export function serializeQuery(query: RequestSpec['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, QueryValue>)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into seconds. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, n);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

/** Exponential backoff with jitter: random in [ceiling/2, ceiling], ceiling = min(cap, base * 2^attempt). */
export function backoffDelayMs(attempt: number, baseMs = 500, capMs = 8000, random: () => number = Math.random): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(ceiling * (0.5 + random() * 0.5));
}

export function encodePath(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  let out = strings[0] ?? '';
  values.forEach((v, i) => {
    if (v === undefined || v === null || v === '') {
      throw new TypeError(`Missing path parameter #${i + 1} for ${strings.join('{}')}`);
    }
    out += encodeURIComponent(String(v)) + (strings[i + 1] ?? '');
  });
  return out;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(signal: AbortSignal): RealtimeSportsError {
  return new RealtimeSportsError({ message: 'Request aborted', code: 'ABORTED', cause: signal.reason });
}

function readEnvKey(): string | undefined {
  try {
    const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    return p?.env?.REALTIME_SPORTS_API_KEY;
  } catch {
    return undefined;
  }
}

export class HttpCore {
  readonly baseUrl: string;
  readonly websocketAuthUrl: string;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly maxRetryAfterSeconds: number;
  private readonly useApiKeyHeader: boolean;
  private readonly fetchImpl: FetchLike;
  private readonly defaultHeaders: Record<string, string>;
  /** Overridable for tests. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void> = sleep;
  random: () => number = Math.random;

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey ?? readEnvKey();
    if (!apiKey) {
      throw new RealtimeSportsError({
        message: 'Missing API key. Pass { apiKey } or set REALTIME_SPORTS_API_KEY.',
        code: 'MISSING_API_KEY'
      });
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.websocketAuthUrl =
      options.websocketAuthUrl ?? `${this.baseUrl.replace(/\/v1$/, '')}/websocket/auth`;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 60;
    this.useApiKeyHeader = options.useApiKeyHeader ?? false;
    if (!options.fetch && typeof globalThis.fetch !== 'function') {
      throw new RealtimeSportsError({
        message: 'No fetch implementation found. Use Node 18+ or pass { fetch }.',
        code: 'NO_FETCH'
      });
    }
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.defaultHeaders = options.headers ?? {};
  }

  request<T>(spec: RequestSpec): APIPromise<T> {
    return new APIPromise<T>(this.execute<T>(spec));
  }

  private buildUrl(spec: RequestSpec): string {
    const base = /^https?:\/\//i.test(spec.path) ? spec.path : `${this.baseUrl}${spec.path}`;
    return base + serializeQuery(spec.query);
  }

  private async execute<T>(spec: RequestSpec): Promise<APIResponse<T>> {
    const opts = spec.options ?? {};
    const maxRetries = Math.max(0, opts.maxRetries ?? this.maxRetries);
    const url = this.buildUrl(spec);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.defaultHeaders,
      ...(this.useApiKeyHeader ? { 'X-API-Key': this.apiKey } : { Authorization: `Bearer ${this.apiKey}` }),
      ...(opts.headers ?? {})
    };
    let body: string | undefined;
    if (spec.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(spec.body);
    }
    const idempotent = IDEMPOTENT.has(spec.method);

    for (let attempt = 0; ; attempt++) {
      let error: RealtimeSportsError;
      let retryable: boolean;
      let delayMs: number;
      try {
        const res = await this.fetchOnce(url, { method: spec.method, headers, body }, opts);
        const parsed = await readBody(res);
        if (res.ok && !(isObject(parsed) && parsed.success === false)) {
          const envelope = isObject(parsed) ? parsed : {};
          return {
            data: ('data' in envelope ? envelope.data : parsed) as T,
            meta: envelope.meta as ResponseMeta | undefined,
            status: res.status,
            headers: res.headers
          };
        }
        error = toApiError(res, parsed);
        if (res.status === 429) {
          // Only wait out short Retry-After windows; long ones mean the monthly quota is gone.
          retryable = error.retryAfter !== undefined && error.retryAfter <= this.maxRetryAfterSeconds;
          delayMs = (error.retryAfter ?? 0) * 1000;
        } else {
          retryable = res.status >= 500 && idempotent;
          delayMs = backoffDelayMs(attempt, 500, 8000, this.random);
        }
      } catch (e) {
        if (e instanceof RealtimeSportsError && e.code === 'ABORTED') throw e;
        error =
          e instanceof RealtimeSportsError
            ? e
            : new RealtimeSportsError({
                message: `Network error: ${e instanceof Error ? e.message : String(e)}`,
                code: 'NETWORK_ERROR',
                cause: e
              });
        retryable = idempotent;
        delayMs = backoffDelayMs(attempt, 500, 8000, this.random);
      }
      if (!retryable || attempt >= maxRetries) throw error;
      await this.sleep(delayMs, opts.signal);
    }
  }

  private async fetchOnce(url: string, init: RequestInit, opts: RequestOptions): Promise<Response> {
    if (opts.signal?.aborted) throw abortError(opts.signal);
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : undefined;
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (e) {
      if (opts.signal?.aborted) throw abortError(opts.signal);
      if (timedOut) {
        throw new RealtimeSportsError({ message: `Request timed out after ${timeoutMs} ms`, code: 'TIMEOUT', cause: e });
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toApiError(res: Response, body: unknown): RealtimeSportsError {
  const err = isObject(body) && isObject(body.error) ? body.error : undefined;
  const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
  const fallbackCode = res.status === 429 ? 'rate_limit_exceeded' : `HTTP_${res.status}`;
  const message =
    (typeof err?.message === 'string' && err.message) ||
    (typeof body === 'string' && body.length < 500 && body) ||
    `HTTP ${res.status} ${res.statusText || ''}`.trim();
  return new RealtimeSportsError({
    message,
    code: typeof err?.code === 'string' ? err.code : fallbackCode,
    status: res.status,
    hint: typeof err?.hint === 'string' ? err.hint : undefined,
    retryAfter,
    body
  });
}
