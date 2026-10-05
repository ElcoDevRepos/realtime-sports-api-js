import { RealtimeSportsError } from './errors';
import { backoffDelayMs } from './core';
import type { RealtimeSportsClient } from './client';

/** Event types you can subscribe to over the WebSocket. */
export type StreamEventType =
  | 'event_score_change'
  | 'event_live'
  | 'event_status_change'
  | 'event_play'
  | 'event_final'
  | 'event_odds_change';

export type StreamFrequency = 'asap' | '30s' | '1m' | '5m' | '10m' | '30m';

export interface StreamFilters {
  /** Sport slug: football (American), basketball, baseball, hockey, soccer. */
  sport?: string;
  /** League slug, e.g. nfl, college-football, nba, mens-college-basketball, mlb, nhl, eng.1, usa.1. */
  league?: string;
  /** Restrict to one event (game). */
  eventId?: string;
}

export interface StreamSubscription {
  event: StreamEventType;
  filters?: StreamFilters;
  /** Server-side delivery throttle. Default `asap`. */
  frequency?: StreamFrequency;
}

/** Any JSON message sent by the server. */
export interface StreamServerMessage {
  type: StreamEventType | 'subscribed' | 'unsubscribed' | 'pong' | 'error' | 'quota_exceeded' | (string & {});
  timestamp: string;
  data?: unknown;
  error?: { code?: string; message?: string };
}

/** A data event (score change, play, final...). `data` shape depends on `type`. */
export interface StreamEventMessage<D = StreamEventData> {
  type: StreamEventType;
  timestamp: string;
  data: D;
}

/** Common fields of event payloads. Score changes also carry `previousScore`, plays carry `play`, etc. */
export interface StreamEventData {
  eventId?: string;
  sport?: string;
  league?: string;
  name?: string;
  homeTeam?: { id?: string; name?: string; abbreviation?: string; score?: number; [k: string]: unknown };
  awayTeam?: { id?: string; name?: string; abbreviation?: string; score?: number; [k: string]: unknown };
  previousScore?: { home?: number; away?: number };
  status?: { state?: 'pre' | 'in' | 'post'; period?: number; clock?: string; detail?: string; [k: string]: unknown };
  play?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Minimal WebSocket shape (browser/Deno/Bun/Node 22 global `WebSocket`, or the `ws` package). */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type WebSocketConstructorLike = new (url: string) => WebSocketLike;

export interface ReconnectOptions {
  /** Give up after this many consecutive failed attempts. Default Infinity. */
  maxAttempts?: number;
  /** Default 1000. */
  initialDelayMs?: number;
  /** Default 30000. */
  maxDelayMs?: number;
}

export interface StreamOptions {
  subscriptions?: StreamSubscription[];
  /** Called for every data event (`event_*`). */
  onMessage?: (message: StreamEventMessage) => void;
  /** Connection failures, server `error` messages, `quota_exceeded`, and fatal auth errors. */
  onError?: (error: RealtimeSportsError) => void;
  onOpen?: () => void;
  onClose?: (info: { code?: number; reason?: string; willReconnect: boolean }) => void;
  /** Server acknowledgement of a subscription. Check `data.warnings` while integrating. */
  onSubscribed?: (data: { event?: string; filters?: StreamFilters; frequency?: string; warnings?: string[] }) => void;
  onReconnecting?: (info: { attempt: number; delayMs: number }) => void;
  /** Every parsed server message, including control messages. */
  onRawMessage?: (message: StreamServerMessage) => void;
  /** WebSocket constructor. Defaults to `globalThis.WebSocket`; on Node < 22 pass `WebSocket` from `ws`. */
  WebSocket?: WebSocketConstructorLike;
  /** Application-level ping interval. Default 30000; 0 disables. Pongs do not count toward quota. */
  pingIntervalMs?: number;
  /** Reconnect if no pong arrives within this window. Default 10000. */
  pongTimeoutMs?: number;
  /** `false` disables reconnecting. Default: enabled with backoff. */
  reconnect?: boolean | ReconnectOptions;
}

export interface StreamHandle {
  /** Add a subscription (sent now if connected, and on every reconnect). */
  subscribe(subscription: StreamSubscription): void;
  /** Remove a subscription. */
  unsubscribe(subscription: StreamSubscription): void;
  /** Close the stream for good. */
  close(): void;
  readonly connected: boolean;
  readonly subscriptions: readonly StreamSubscription[];
}

const OPEN = 1;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

function subKey(s: StreamSubscription): string {
  const f = s.filters ?? {};
  return JSON.stringify([s.event, f.sport ?? null, f.league ?? null, f.eventId ?? null]);
}

function decode(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data as ArrayBufferView);
  return String(data);
}

export function createStream(client: RealtimeSportsClient, options: StreamOptions): StreamHandle {
  const WS =
    options.WebSocket ?? (globalThis as unknown as { WebSocket?: WebSocketConstructorLike }).WebSocket;
  if (!WS) {
    throw new RealtimeSportsError({
      message:
        'No global WebSocket found. On Node < 22 install `ws` and pass it: client.stream({ WebSocket, ... }).',
      code: 'NO_WEBSOCKET'
    });
  }
  const reconnectOpts: ReconnectOptions | null =
    options.reconnect === false ? null : options.reconnect === true || !options.reconnect ? {} : options.reconnect;
  const maxAttempts = reconnectOpts?.maxAttempts ?? Infinity;
  const initialDelayMs = reconnectOpts?.initialDelayMs ?? 1000;
  const maxDelayMs = reconnectOpts?.maxDelayMs ?? 30_000;
  const pingIntervalMs = options.pingIntervalMs ?? 30_000;
  const pongTimeoutMs = options.pongTimeoutMs ?? 10_000;

  const subs = new Map<string, StreamSubscription>();
  for (const s of options.subscriptions ?? []) subs.set(subKey(s), s);

  let ws: WebSocketLike | null = null;
  let closedByUser = false;
  let attempts = 0;
  let token: { url: string; token: string; expiresAt: number } | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;

  const emitError = (e: RealtimeSportsError) => {
    try {
      options.onError?.(e);
    } catch {
      /* user callback errors must not break the stream */
    }
  };

  const send = (msg: object) => {
    if (ws && ws.readyState === OPEN) ws.send(JSON.stringify(msg));
  };

  const subMessage = (type: 'subscribe' | 'unsubscribe', s: StreamSubscription) => ({
    type,
    event: s.event,
    ...(s.filters ? { filters: s.filters } : {}),
    ...(type === 'subscribe' && s.frequency ? { frequency: s.frequency } : {})
  });

  const stopTimers = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (pongTimer) clearTimeout(pongTimer);
    pingTimer = pongTimer = undefined;
  };

  const scheduleReconnect = () => {
    if (closedByUser || !reconnectOpts) return;
    if (attempts >= maxAttempts) {
      emitError(new RealtimeSportsError({ message: `Gave up reconnecting after ${attempts} attempts`, code: 'RECONNECT_FAILED' }));
      return;
    }
    const delayMs = backoffDelayMs(attempts, initialDelayMs, maxDelayMs);
    attempts++;
    options.onReconnecting?.({ attempt: attempts, delayMs });
    reconnectTimer = setTimeout(() => void connect(), delayMs);
  };

  const handleClosed = (code: number | undefined, reason: string | undefined) => {
    stopTimers();
    ws = null;
    // 1008 = policy violation: bad/expired token or plan without WebSocket access.
    let fatal = false;
    if (code === 1008) {
      token = null;
      if (reason && /tier|subscription|not found/i.test(reason)) {
        fatal = true;
        emitError(new RealtimeSportsError({ message: `WebSocket rejected: ${reason}`, code: 'WEBSOCKET_FORBIDDEN', status: 403 }));
      }
    }
    const willReconnect = !closedByUser && !fatal && !!reconnectOpts && attempts < maxAttempts;
    options.onClose?.({ code, reason, willReconnect });
    if (!fatal) scheduleReconnect();
  };

  const getToken = async () => {
    if (token && token.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return token;
    const data = (await client.createWebSocketToken()) as { url?: string; token?: string; expiresIn?: number };
    if (!data?.url || !data?.token) {
      throw new RealtimeSportsError({ message: 'WebSocket auth response missing url/token', code: 'BAD_RESPONSE' });
    }
    token = { url: data.url, token: data.token, expiresAt: Date.now() + (data.expiresIn ?? 3600) * 1000 };
    return token;
  };

  const connect = async (): Promise<void> => {
    reconnectTimer = undefined;
    if (closedByUser) return;
    let t: { url: string; token: string };
    try {
      t = await getToken();
    } catch (e) {
      const err =
        e instanceof RealtimeSportsError
          ? e
          : new RealtimeSportsError({ message: String(e), code: 'NETWORK_ERROR', cause: e });
      emitError(err);
      // Bad key, plan without WebSocket access, or exhausted quota: retrying will not help.
      if (err.status === 401 || err.status === 403 || err.status === 429) return;
      scheduleReconnect();
      return;
    }
    if (closedByUser) return;
    const url = `${t.url}${t.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(t.token)}`;
    let socket: WebSocketLike;
    try {
      socket = new WS(url);
    } catch (e) {
      emitError(new RealtimeSportsError({ message: `WebSocket connect failed: ${String(e)}`, code: 'NETWORK_ERROR', cause: e }));
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      for (const s of subs.values()) send(subMessage('subscribe', s));
      if (pingIntervalMs > 0) {
        pingTimer = setInterval(() => {
          send({ type: 'ping' });
          if (!pongTimer && pongTimeoutMs > 0) {
            pongTimer = setTimeout(() => {
              // Connection looks dead: drop it without waiting for a close handshake.
              if (ws !== socket) return;
              detach(socket);
              try {
                socket.close(4000, 'pong timeout');
              } catch {
                /* ignore */
              }
              handleClosed(4000, 'pong timeout');
            }, pongTimeoutMs);
          }
        }, pingIntervalMs);
      }
      options.onOpen?.();
    };

    socket.onmessage = (ev) => {
      if (ws !== socket) return;
      let msg: StreamServerMessage;
      try {
        msg = JSON.parse(decode(ev.data));
      } catch {
        return;
      }
      // The server only talks to authenticated clients, so a message means the connection is healthy.
      // (Resetting on `open` instead would hot-loop when the server accepts then closes with 1008.)
      attempts = 0;
      options.onRawMessage?.(msg);
      switch (msg.type) {
        case 'pong':
          if (pongTimer) clearTimeout(pongTimer);
          pongTimer = undefined;
          return;
        case 'subscribed':
          options.onSubscribed?.((msg.data ?? {}) as Parameters<NonNullable<StreamOptions['onSubscribed']>>[0]);
          return;
        case 'unsubscribed':
          return;
        case 'error': {
          const body = (msg.error ?? (msg.data as { error?: { code?: string; message?: string } })?.error ?? msg.data) as
            | { code?: string; message?: string }
            | undefined;
          emitError(new RealtimeSportsError({ message: body?.message ?? 'WebSocket error', code: body?.code ?? 'WEBSOCKET_ERROR', body: msg }));
          return;
        }
        case 'quota_exceeded': {
          const d = (msg.data ?? {}) as { message?: string };
          emitError(new RealtimeSportsError({ message: d.message ?? 'Monthly quota exhausted', code: 'quota_exceeded', status: 429, body: msg }));
          return;
        }
        default:
          if (typeof msg.type === 'string' && msg.type.startsWith('event_')) {
            options.onMessage?.(msg as StreamEventMessage);
          }
      }
    };

    socket.onerror = () => {
      // A close event always follows; reconnect is handled there.
      if (ws === socket) emitError(new RealtimeSportsError({ message: 'WebSocket error', code: 'NETWORK_ERROR' }));
    };

    socket.onclose = (ev) => {
      if (ws !== socket) return;
      handleClosed(ev?.code, ev?.reason);
    };
  };

  const detach = (s: WebSocketLike) => {
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
  };

  void connect();

  return {
    subscribe(s) {
      subs.set(subKey(s), s);
      send(subMessage('subscribe', s));
    },
    unsubscribe(s) {
      subs.delete(subKey(s));
      send(subMessage('unsubscribe', s));
    },
    close() {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopTimers();
      const s = ws;
      ws = null;
      if (s) {
        detach(s);
        try {
          s.close(1000, 'client closed');
        } catch {
          /* ignore */
        }
        options.onClose?.({ code: 1000, reason: 'client closed', willReconnect: false });
      }
    },
    get connected() {
      return !!ws && ws.readyState === OPEN;
    },
    get subscriptions() {
      return [...subs.values()];
    }
  };
}
