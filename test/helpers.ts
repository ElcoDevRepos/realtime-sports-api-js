import { RealtimeSportsClient, type ClientOptions } from '../src';

export interface Call {
  url: string;
  init: RequestInit;
}

export type Reply = Response | Error | (() => Response | Promise<Response>);

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

export function ok<T>(data: T, meta?: unknown): Response {
  return json({ success: true, data, ...(meta ? { meta } : {}) });
}

/** A fetch mock that replies with the queued responses in order (the last one repeats). */
export function mockFetch(...replies: Reply[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = replies.length > 1 ? replies.shift()! : replies[0]!;
    if (r instanceof Error) throw r;
    const res = typeof r === 'function' ? await r() : r;
    return res.clone();
  };
  return { fetch, calls };
}

export function makeClient(fetch: ClientOptions['fetch'], opts: ClientOptions = {}) {
  const client = new RealtimeSportsClient({ apiKey: 'test_key', fetch, ...opts });
  const sleeps: number[] = [];
  client.core.sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  client.core.random = () => 0.5;
  return { client, sleeps };
}

export function header(call: Call, name: string): string | undefined {
  const h = call.init.headers as Record<string, string>;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}
