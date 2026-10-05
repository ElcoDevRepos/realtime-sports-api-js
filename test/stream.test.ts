import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeSportsError, StreamEventMessage, WebSocketLike } from '../src';
import { json, makeClient, mockFetch, ok } from './helpers';

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverClose(code: number, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

const tokenReply = (n = 1) => ok({ url: 'wss://ws.example', token: `tok${n}`, expiresIn: 3600 });
const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
// Let the token fetch (mocked fetch + body parsing) settle.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve)).then(() => new Promise<void>((r) => setImmediate(r)));

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('client.stream', () => {
  it('authenticates, connects with the token and subscribes on open', async () => {
    const { fetch, calls } = mockFetch(tokenReply());
    const { client } = makeClient(fetch);
    const onOpen = vi.fn();
    const stream = client.stream({
      WebSocket: FakeWebSocket,
      subscriptions: [{ event: 'event_score_change', filters: { sport: 'football', league: 'nfl' }, frequency: 'asap' }],
      onOpen
    });
    await flush();
    expect(calls[0]!.url).toBe('https://www.realtimesportsapi.com/api/websocket/auth');
    expect(last().url).toBe('wss://ws.example?token=tok1');
    last().open();
    expect(onOpen).toHaveBeenCalled();
    expect(last().sent).toEqual([
      { type: 'subscribe', event: 'event_score_change', filters: { sport: 'football', league: 'nfl' }, frequency: 'asap' }
    ]);
    expect(stream.connected).toBe(true);
    stream.close();
  });

  it('routes event, subscribed, error and quota messages to the right callbacks', async () => {
    const { fetch } = mockFetch(tokenReply());
    const { client } = makeClient(fetch);
    const onMessage = vi.fn<(m: StreamEventMessage) => void>();
    const onSubscribed = vi.fn();
    const onError = vi.fn<(e: RealtimeSportsError) => void>();
    const onRawMessage = vi.fn();
    const stream = client.stream({ WebSocket: FakeWebSocket, onMessage, onSubscribed, onError, onRawMessage });
    await flush();
    last().open();
    last().receive({ type: 'pong', timestamp: 't', data: { message: 'Connected' } });
    last().receive({ type: 'subscribed', timestamp: 't', data: { event: 'event_final', warnings: ['x'] } });
    last().receive({
      type: 'event_score_change',
      timestamp: 't',
      data: { eventId: '401', homeTeam: { score: 14 }, awayTeam: { score: 7 } }
    });
    last().receive({ type: 'error', timestamp: 't', error: { code: 'UNKNOWN_MESSAGE_TYPE', message: 'bad' } });
    last().receive({ type: 'quota_exceeded', timestamp: 't', data: { message: 'limit' } });
    last().onmessage?.({ data: 'not json' });

    expect(onSubscribed).toHaveBeenCalledWith({ event: 'event_final', warnings: ['x'] });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0]![0].data.eventId).toBe('401');
    expect(onError.mock.calls.map((c) => c[0].code)).toEqual(['UNKNOWN_MESSAGE_TYPE', 'quota_exceeded']);
    expect(onError.mock.calls[1]![0].status).toBe(429);
    expect(onRawMessage).toHaveBeenCalledTimes(5);
    stream.close();
  });

  it('decodes binary frames', async () => {
    const { fetch } = mockFetch(tokenReply());
    const { client } = makeClient(fetch);
    const onMessage = vi.fn();
    const stream = client.stream({ WebSocket: FakeWebSocket, onMessage });
    await flush();
    last().open();
    last().onmessage?.({ data: new TextEncoder().encode(JSON.stringify({ type: 'event_final', timestamp: 't', data: {} })) });
    expect(onMessage).toHaveBeenCalledTimes(1);
    stream.close();
  });

  it('reconnects with backoff, reuses a valid token, and resubscribes everything', async () => {
    const { fetch, calls } = mockFetch(tokenReply(1), tokenReply(2));
    const { client } = makeClient(fetch);
    const onReconnecting = vi.fn();
    const onClose = vi.fn();
    const stream = client.stream({
      WebSocket: FakeWebSocket,
      subscriptions: [{ event: 'event_score_change', filters: { sport: 'hockey', league: 'nhl' } }],
      onReconnecting,
      onClose
    });
    await flush();
    const first = last();
    first.open();
    stream.subscribe({ event: 'event_final', filters: { sport: 'hockey', league: 'nhl' } });
    expect(first.sent.map((m) => m.event)).toEqual(['event_score_change', 'event_final']);

    first.serverClose(1006, 'abnormal');
    expect(onClose).toHaveBeenCalledWith({ code: 1006, reason: 'abnormal', willReconnect: true });
    expect(onReconnecting).toHaveBeenCalledWith({ attempt: 1, delayMs: expect.any(Number) });
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    const second = last();
    expect(second).not.toBe(first);
    expect(calls).toHaveLength(1); // token still valid, no re-auth
    expect(second.url).toBe('wss://ws.example?token=tok1');
    second.open();
    expect(second.sent.map((m) => [m.type, m.event])).toEqual([
      ['subscribe', 'event_score_change'],
      ['subscribe', 'event_final']
    ]);
    stream.close();
  });

  it('re-authenticates after a 1008 (expired/invalid token) close', async () => {
    const { fetch, calls } = mockFetch(tokenReply(1), tokenReply(2));
    const { client } = makeClient(fetch);
    const stream = client.stream({ WebSocket: FakeWebSocket });
    await flush();
    last().open();
    last().serverClose(1008, 'Invalid authentication token');
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(calls).toHaveLength(2);
    expect(last().url).toBe('wss://ws.example?token=tok2');
    stream.close();
  });

  it('re-authenticates when the cached token is about to expire', async () => {
    const { fetch, calls } = mockFetch(tokenReply(1), tokenReply(2));
    const { client } = makeClient(fetch);
    const stream = client.stream({ WebSocket: FakeWebSocket, pingIntervalMs: 0 });
    await flush();
    last().open();
    await vi.advanceTimersByTimeAsync(3600_000 - 30_000);
    last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(calls).toHaveLength(2);
    expect(last().url).toBe('wss://ws.example?token=tok2');
    stream.close();
  });

  it('stops for good when the plan has no WebSocket access', async () => {
    const { fetch } = mockFetch(tokenReply());
    const { client } = makeClient(fetch);
    const onError = vi.fn();
    const onClose = vi.fn();
    client.stream({ WebSocket: FakeWebSocket, onError, onClose });
    await flush();
    last().open();
    last().serverClose(1008, 'WebSocket access requires Starter, Pro, or Enterprise tier');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(onError.mock.calls[0]![0].code).toBe('WEBSOCKET_FORBIDDEN');
    expect(onClose.mock.calls[0]![0].willReconnect).toBe(false);
  });

  it('does not retry when auth fails with 401/403', async () => {
    const { fetch, calls } = mockFetch(json({ success: false, error: { code: 'SUBSCRIPTION_INACTIVE', message: 'no' } }, 403));
    const { client } = makeClient(fetch);
    const onError = vi.fn();
    client.stream({ WebSocket: FakeWebSocket, onError });
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(onError.mock.calls[0]![0].code).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('retries auth on a server error', async () => {
    const { fetch, calls } = mockFetch(json({ success: false, error: { code: 'X', message: 'x' } }, 500), tokenReply());
    const { client } = makeClient(fetch, { maxRetries: 0 });
    const stream = client.stream({ WebSocket: FakeWebSocket });
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(calls).toHaveLength(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
    stream.close();
  });

  it('sends pings and reconnects when pongs stop', async () => {
    const { fetch } = mockFetch(tokenReply());
    const { client } = makeClient(fetch);
    const stream = client.stream({ WebSocket: FakeWebSocket, pingIntervalMs: 30_000, pongTimeoutMs: 10_000 });
    await flush();
    const ws = last();
    ws.open();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ws.sent).toContainEqual({ type: 'ping' });
    ws.receive({ type: 'pong', timestamp: 't' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ws.closed).toBeNull();
    await vi.advanceTimersByTimeAsync(15_000 + 10_000); // next ping, no pong
    expect(ws.closed?.code).toBe(4000);
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(2);
    stream.close();
  });

  it('unsubscribe sends unsubscribe and drops it from future reconnects', async () => {
    const { fetch } = mockFetch(tokenReply());
    const { client } = makeClient(fetch);
    const sub = { event: 'event_play' as const, filters: { sport: 'football', league: 'nfl', eventId: '401' } };
    const stream = client.stream({ WebSocket: FakeWebSocket, subscriptions: [sub] });
    await flush();
    last().open();
    stream.unsubscribe(sub);
    expect(last().sent[1]).toEqual({ type: 'unsubscribe', event: 'event_play', filters: sub.filters });
    expect(stream.subscriptions).toEqual([]);
    stream.close();
  });

  it('close() stops reconnecting', async () => {
    const { fetch } = mockFetch(tokenReply());
    const { client } = makeClient(fetch);
    const onClose = vi.fn();
    const stream = client.stream({ WebSocket: FakeWebSocket, onClose });
    await flush();
    const ws = last();
    ws.open();
    stream.close();
    expect(ws.closed?.code).toBe(1000);
    expect(onClose).toHaveBeenCalledWith({ code: 1000, reason: 'client closed', willReconnect: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(stream.connected).toBe(false);
  });

  it('throws a helpful error when no WebSocket implementation exists', () => {
    const { fetch } = mockFetch(tokenReply());
    const { client } = makeClient(fetch);
    const g = globalThis as { WebSocket?: unknown };
    const saved = g.WebSocket;
    delete g.WebSocket;
    try {
      expect(() => client.stream({})).toThrow(/ws/);
    } finally {
      if (saved) g.WebSocket = saved;
    }
  });
});
