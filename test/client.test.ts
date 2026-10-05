import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RealtimeSportsClient, RealtimeSportsError } from '../src';
import { parseRetryAfter, serializeQuery } from '../src/core';
import { header, json, makeClient, mockFetch, ok } from './helpers';

const BASE = 'https://www.realtimesportsapi.com/api/v1';

describe('auth and request building', () => {
  it('sends the key as a bearer token and returns data', async () => {
    const { fetch, calls } = mockFetch(ok([{ slug: 'football' }]));
    const { client } = makeClient(fetch);
    const sports = await client.listSports();
    expect(sports).toEqual([{ slug: 'football' }]);
    expect(calls[0]!.url).toBe(`${BASE}/sports`);
    expect(header(calls[0]!, 'Authorization')).toBe('Bearer test_key');
    expect(header(calls[0]!, 'X-API-Key')).toBeUndefined();
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('can send X-API-Key instead', async () => {
    const { fetch, calls } = mockFetch(ok([]));
    const { client } = makeClient(fetch, { useApiKeyHeader: true });
    await client.listSports();
    expect(header(calls[0]!, 'X-API-Key')).toBe('test_key');
    expect(header(calls[0]!, 'Authorization')).toBeUndefined();
  });

  it('throws without an API key', () => {
    const prev = process.env.REALTIME_SPORTS_API_KEY;
    delete process.env.REALTIME_SPORTS_API_KEY;
    try {
      expect(() => new RealtimeSportsClient({ fetch: async () => ok([]) })).toThrow(/Missing API key/);
    } finally {
      if (prev !== undefined) process.env.REALTIME_SPORTS_API_KEY = prev;
    }
  });

  it('reads REALTIME_SPORTS_API_KEY from the environment', async () => {
    const prev = process.env.REALTIME_SPORTS_API_KEY;
    process.env.REALTIME_SPORTS_API_KEY = 'env_key';
    try {
      const { fetch, calls } = mockFetch(ok([]));
      const client = new RealtimeSportsClient({ fetch });
      await client.listSports();
      expect(header(calls[0]!, 'Authorization')).toBe('Bearer env_key');
    } finally {
      if (prev === undefined) delete process.env.REALTIME_SPORTS_API_KEY;
      else process.env.REALTIME_SPORTS_API_KEY = prev;
    }
  });

  it('serializes query params (booleans, numbers, skips undefined/null)', async () => {
    const { fetch, calls } = mockFetch(ok([]));
    const { client } = makeClient(fetch);
    await client.listLiveEvents('football', 'nfl', { includeOdds: true });
    expect(calls[0]!.url).toBe(`${BASE}/sports/football/leagues/nfl/events/live?includeOdds=true`);
    await client.getSeasonSchedule('football', 'nfl', 2026, { week: 5, seasonType: 2 });
    expect(calls[1]!.url).toBe(`${BASE}/sports/football/leagues/nfl/seasons/2026/schedule?week=5&seasonType=2`);
    await client.listPlays('football', 'nfl', '401', { limit: undefined, page: 2, enrich: false });
    expect(calls[2]!.url).toBe(`${BASE}/sports/football/leagues/nfl/events/401/plays?page=2&enrich=false`);
    expect(serializeQuery({ a: null, b: undefined, c: [1, 2] })).toBe('?c=1&c=2');
    expect(serializeQuery({})).toBe('');
  });

  it('puts required query params in positionally', async () => {
    const { fetch, calls } = mockFetch(ok([]));
    const { client } = makeClient(fetch);
    await client.searchAthletes('basketball', 'nba', 'le bron', { limit: 5 });
    expect(calls[0]!.url).toBe(`${BASE}/sports/basketball/leagues/nba/athletes/search?limit=5&query=le+bron`);
    await client.getAthleteGameLog('football', 'nfl', '3139477', 2025, { seasonType: 2 });
    expect(calls[1]!.url).toBe(`${BASE}/sports/football/leagues/nfl/athletes/3139477/gamelog?seasonType=2&season=2025`);
  });

  it('encodes path segments (soccer league slugs, odd ids)', async () => {
    const { fetch, calls } = mockFetch(ok([]));
    const { client } = makeClient(fetch);
    await client.listLiveEvents('soccer', 'eng.1');
    expect(calls[0]!.url).toBe(`${BASE}/sports/soccer/leagues/eng.1/events/live`);
    await client.getTeam('football', 'nfl', 'a/b c');
    expect(calls[1]!.url).toBe(`${BASE}/sports/football/leagues/nfl/teams/a%2Fb%20c`);
  });

  it('rejects empty path params', () => {
    const { fetch } = mockFetch(ok([]));
    const { client } = makeClient(fetch);
    expect(() => client.getEvent('football', 'nfl', '')).toThrow(TypeError);
  });

  it('respects a custom baseUrl and strips the trailing slash', async () => {
    const { fetch, calls } = mockFetch(ok([]));
    const { client } = makeClient(fetch, { baseUrl: 'http://localhost:3000/api/v1/' });
    await client.listSports();
    expect(calls[0]!.url).toBe('http://localhost:3000/api/v1/sports');
    expect(client.core.websocketAuthUrl).toBe('http://localhost:3000/api/websocket/auth');
  });

  it('sends JSON bodies for webhook writes', async () => {
    const { fetch, calls } = mockFetch(json({ success: true, data: { id: 'wh_1', secret: 's' } }, 201));
    const { client } = makeClient(fetch);
    const wh = await client.webhooks.create({ url: 'https://example.com/h', events: ['event.final'], leagues: ['nfl'] });
    expect(wh.id).toBe('wh_1');
    expect(calls[0]!.url).toBe(`${BASE}/webhooks`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(header(calls[0]!, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      url: 'https://example.com/h',
      events: ['event.final'],
      leagues: ['nfl']
    });
    await client.webhooks.update('wh_1', { active: false });
    expect(calls[1]!.init.method).toBe('PATCH');
    expect(calls[1]!.url).toBe(`${BASE}/webhooks/wh_1`);
    await client.webhooks.deliveries('wh_1', { limit: 10 });
    expect(calls[2]!.url).toBe(`${BASE}/webhooks/wh_1/deliveries?limit=10`);
    await client.webhooks.test('wh_1');
    expect(JSON.parse(String(calls[3]!.init.body))).toEqual({});
  });

  it('posts to the WebSocket auth endpoint outside /v1', async () => {
    const { fetch, calls } = mockFetch(ok({ url: 'wss://ws.example', token: 't', expiresIn: 3600 }));
    const { client } = makeClient(fetch);
    const t = await client.createWebSocketToken();
    expect(t.token).toBe('t');
    expect(calls[0]!.url).toBe('https://www.realtimesportsapi.com/api/websocket/auth');
    expect(calls[0]!.init.method).toBe('POST');
  });
});

describe('withMeta', () => {
  it('exposes meta, status and headers', async () => {
    const meta = { rateLimit: { limit: 10000, remaining: 9876, reset: 1767225600000 } };
    const { fetch } = mockFetch(ok([{ id: '1' }], meta));
    const { client } = makeClient(fetch);
    const res = await client.listLiveEvents('basketball', 'nba').withMeta();
    expect(res.data).toEqual([{ id: '1' }]);
    expect(res.meta?.rateLimit?.remaining).toBe(9876);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('supports .catch and .finally like a promise', async () => {
    const { fetch } = mockFetch(json({ success: false, error: { code: 'X', message: 'nope' } }, 400));
    const { client } = makeClient(fetch);
    let finished = false;
    const result = await client
      .listSports()
      .finally(() => {
        finished = true;
      })
      .catch((e: RealtimeSportsError) => e.code);
    expect(result).toBe('X');
    expect(finished).toBe(true);
  });
});

describe('error mapping', () => {
  it('maps the error envelope to RealtimeSportsError', async () => {
    const { fetch, calls } = mockFetch(
      json(
        { success: false, error: { code: 'MISSING_TOKEN', message: 'Authorization required', hint: 'Use Authorization: Bearer <key>' } },
        401
      )
    );
    const { client, sleeps } = makeClient(fetch);
    const err = (await client.listSports().then(() => null, (e: unknown) => e)) as RealtimeSportsError;
    expect(err).toBeInstanceOf(RealtimeSportsError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('MISSING_TOKEN');
    expect(err.message).toBe('Authorization required');
    expect(err.hint).toBe('Use Authorization: Bearer <key>');
    expect(err.isAuthError).toBe(true);
    expect(calls).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });

  it('treats success:false on a 200 as an error', async () => {
    const { fetch } = mockFetch(json({ success: false, error: { code: 'BAD', message: 'bad' } }, 200));
    const { client } = makeClient(fetch);
    await expect(client.listSports()).rejects.toMatchObject({ code: 'BAD', status: 200 });
  });

  it('handles non-JSON error bodies', async () => {
    const { fetch } = mockFetch(new Response('Not Found', { status: 404, statusText: 'Not Found' }));
    const { client } = makeClient(fetch);
    await expect(client.getEvent('football', 'nfl', '1')).rejects.toMatchObject({ status: 404, code: 'HTTP_404', message: 'Not Found' });
  });

  it('does not retry 4xx', async () => {
    const { fetch, calls } = mockFetch(json({ success: false, error: { code: 'NOT_FOUND', message: 'x' } }, 404));
    const { client } = makeClient(fetch);
    await expect(client.getTeam('football', 'nfl', '999')).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(1);
  });
});

describe('retries', () => {
  const err500 = () => json({ success: false, error: { code: 'INTERNAL', message: 'boom' } }, 500);

  it('retries 5xx with exponential backoff, then succeeds', async () => {
    const { fetch, calls } = mockFetch(err500(), json({}, 503), ok(['ok']));
    const { client, sleeps } = makeClient(fetch);
    await expect(client.listSports()).resolves.toEqual(['ok']);
    expect(calls).toHaveLength(3);
    // random() = 0.5 -> 75% of the ceiling: 500ms then 1000ms ceilings.
    expect(sleeps).toEqual([375, 750]);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const { fetch, calls } = mockFetch(err500());
    const { client, sleeps } = makeClient(fetch, { maxRetries: 3 });
    await expect(client.listSports()).rejects.toMatchObject({ status: 500, code: 'INTERNAL' });
    expect(calls).toHaveLength(4);
    expect(sleeps).toHaveLength(3);
  });

  it('honours per-request maxRetries', async () => {
    const { fetch, calls } = mockFetch(err500());
    const { client } = makeClient(fetch);
    await expect(client.listSports({ maxRetries: 0 })).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(1);
  });

  it('does not retry non-idempotent POST/PATCH on 5xx', async () => {
    const { fetch, calls } = mockFetch(err500());
    const { client } = makeClient(fetch);
    await expect(client.webhooks.create({ url: 'https://x.test', events: ['event.final'] })).rejects.toMatchObject({ status: 500 });
    await expect(client.webhooks.update('w', { active: true })).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(2);
  });

  it('retries network errors for GET', async () => {
    const { fetch, calls } = mockFetch(new TypeError('fetch failed'), ok([1]));
    const { client } = makeClient(fetch);
    await expect(client.listSports()).resolves.toEqual([1]);
    expect(calls).toHaveLength(2);
  });

  it('wraps exhausted network errors as NETWORK_ERROR', async () => {
    const { fetch } = mockFetch(new TypeError('fetch failed'));
    const { client } = makeClient(fetch, { maxRetries: 1 });
    await expect(client.listSports()).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: undefined });
  });

  it('waits out a short Retry-After on 429 and retries', async () => {
    const { fetch, calls } = mockFetch(
      json({ success: false, error: { code: 'rate_limit_exceeded', message: 'quota' } }, 429, { 'Retry-After': '2' }),
      ok(['after'])
    );
    const { client, sleeps } = makeClient(fetch);
    await expect(client.listSports()).resolves.toEqual(['after']);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it('throws immediately when Retry-After exceeds the cap (monthly quota exhausted)', async () => {
    const { fetch, calls } = mockFetch(
      json({ success: false, error: { code: 'rate_limit_exceeded', message: 'Monthly quota exhausted' } }, 429, {
        'Retry-After': '86400'
      })
    );
    const { client, sleeps } = makeClient(fetch);
    const err = (await client.listSports().then(() => null, (e: unknown) => e)) as RealtimeSportsError;
    expect(err).toBeInstanceOf(RealtimeSportsError);
    expect(err.status).toBe(429);
    expect(err.isRateLimited).toBe(true);
    expect(err.retryAfter).toBe(86400);
    expect(err.code).toBe('rate_limit_exceeded');
    expect(calls).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });

  it('respects a custom maxRetryAfterSeconds', async () => {
    const r429 = () => json({ success: false, error: { code: 'rate_limit_exceeded', message: 'q' } }, 429, { 'Retry-After': '90' });
    const a = mockFetch(r429(), ok([]));
    const c1 = makeClient(a.fetch, { maxRetryAfterSeconds: 120 });
    await expect(c1.client.listSports()).resolves.toEqual([]);
    expect(c1.sleeps).toEqual([90000]);
    const b = mockFetch(r429());
    const c2 = makeClient(b.fetch);
    await expect(c2.client.listSports()).rejects.toMatchObject({ retryAfter: 90 });
    expect(b.calls).toHaveLength(1);
  });

  it('does not retry a 429 without Retry-After', async () => {
    const { fetch, calls } = mockFetch(json({ success: false, error: { code: 'rate_limit_exceeded', message: 'q' } }, 429));
    const { client } = makeClient(fetch);
    await expect(client.listSports()).rejects.toMatchObject({ status: 429, retryAfter: undefined });
    expect(calls).toHaveLength(1);
  });

  it('retries a short 429 even for POST (the request was not processed)', async () => {
    const { fetch, calls } = mockFetch(
      json({ success: false, error: { code: 'rate_limit_exceeded', message: 'q' } }, 429, { 'Retry-After': '1' }),
      ok({ id: 'w' })
    );
    const { client } = makeClient(fetch);
    await expect(client.webhooks.rotateSecret('w')).resolves.toEqual({ id: 'w' });
    expect(calls).toHaveLength(2);
  });

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('garbage')).toBeUndefined();
    const now = Date.parse('2026-10-03T12:00:00Z');
    expect(parseRetryAfter('Sat, 03 Oct 2026 12:01:00 GMT', now)).toBe(60);
  });
});

describe('timeouts and aborts', () => {
  it('times out a hung request with code TIMEOUT', async () => {
    const hang = (_url: string, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const { client } = makeClient(hang, { timeoutMs: 10, maxRetries: 0 });
    await expect(client.listSports()).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('stops when the caller aborts', async () => {
    const hang = (_url: string, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const { client } = makeClient(hang);
    const ac = new AbortController();
    const p = client.listSports({ signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'ABORTED' });
  });
});

describe('coverage of the OpenAPI spec', () => {
  it('has a method for every operationId in schema.d.ts', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const schema = readFileSync(path.join(here, '..', 'src', 'schema.d.ts'), 'utf8');
    const block = schema.slice(schema.indexOf('export interface operations {'));
    const ops = [...block.matchAll(/^ {4}([A-Za-z]+): \{$/gm)].map((m) => m[1]!);
    expect(ops.length).toBeGreaterThanOrEqual(50);

    const webhookMap: Record<string, string> = {
      listWebhooks: 'list',
      createWebhook: 'create',
      getWebhook: 'get',
      updateWebhook: 'update',
      deleteWebhook: 'delete',
      getWebhookSecret: 'getSecret',
      rotateWebhookSecret: 'rotateSecret',
      testWebhook: 'test',
      listWebhookDeliveries: 'deliveries'
    };
    const client = new RealtimeSportsClient({ apiKey: 'k', fetch: async () => ok([]) });
    const missing = ops.filter((op) =>
      webhookMap[op]
        ? typeof (client.webhooks as unknown as Record<string, unknown>)[webhookMap[op]!] !== 'function'
        : typeof (client as unknown as Record<string, unknown>)[op] !== 'function'
    );
    expect(missing).toEqual([]);
  });
});
