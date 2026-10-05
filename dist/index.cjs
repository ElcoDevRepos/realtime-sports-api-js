'use strict';

// src/errors.ts
var RealtimeSportsError = class extends Error {
  constructor(init) {
    super(init.message);
    this.name = "RealtimeSportsError";
    this.status = init.status;
    this.code = init.code;
    this.hint = init.hint;
    this.retryAfter = init.retryAfter;
    this.body = init.body;
    if (init.cause !== void 0) this.cause = init.cause;
  }
  /** True for 429 (monthly quota exhausted). */
  get isRateLimited() {
    return this.status === 429;
  }
  /** True for 401/403 (missing, invalid or expired key; plan does not include the feature). */
  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }
};

// src/core.ts
var DEFAULT_BASE_URL = "https://www.realtimesportsapi.com/api/v1";
var VERSION = "0.1.0";
var APIPromise = class {
  constructor(responsePromise) {
    this.responsePromise = responsePromise;
  }
  /** Resolve to the full response: `{ data, meta, status, headers }`. */
  withMeta() {
    return this.responsePromise;
  }
  then(onfulfilled, onrejected) {
    return this.responsePromise.then((r) => r.data).then(onfulfilled, onrejected);
  }
  catch(onrejected) {
    return this.then(void 0, onrejected);
  }
  finally(onfinally) {
    return this.responsePromise.then((r) => r.data).finally(onfinally);
  }
  get [Symbol.toStringTag]() {
    return "APIPromise";
  }
};
var IDEMPOTENT = /* @__PURE__ */ new Set(["GET", "PUT", "DELETE"]);
function serializeQuery(query) {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === void 0 || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}
function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value.trim() === "") return void 0;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, n);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return void 0;
  return Math.max(0, Math.ceil((date - now) / 1e3));
}
function backoffDelayMs(attempt, baseMs = 500, capMs = 8e3, random = Math.random) {
  const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(ceiling * (0.5 + random() * 0.5));
}
function encodePath(strings, ...values) {
  let out = strings[0] ?? "";
  values.forEach((v, i) => {
    if (v === void 0 || v === null || v === "") {
      throw new TypeError(`Missing path parameter #${i + 1} for ${strings.join("{}")}`);
    }
    out += encodeURIComponent(String(v)) + (strings[i + 1] ?? "");
  });
  return out;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function abortError(signal) {
  return new RealtimeSportsError({ message: "Request aborted", code: "ABORTED", cause: signal.reason });
}
function readEnvKey() {
  try {
    const p = globalThis.process;
    return p?.env?.REALTIME_SPORTS_API_KEY;
  } catch {
    return void 0;
  }
}
var HttpCore = class {
  constructor(options = {}) {
    /** Overridable for tests. */
    this.sleep = sleep;
    this.random = Math.random;
    const apiKey = options.apiKey ?? readEnvKey();
    if (!apiKey) {
      throw new RealtimeSportsError({
        message: "Missing API key. Pass { apiKey } or set REALTIME_SPORTS_API_KEY.",
        code: "MISSING_API_KEY"
      });
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.websocketAuthUrl = options.websocketAuthUrl ?? `${this.baseUrl.replace(/\/v1$/, "")}/websocket/auth`;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.timeoutMs = options.timeoutMs ?? 3e4;
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 60;
    this.useApiKeyHeader = options.useApiKeyHeader ?? false;
    if (!options.fetch && typeof globalThis.fetch !== "function") {
      throw new RealtimeSportsError({
        message: "No fetch implementation found. Use Node 18+ or pass { fetch }.",
        code: "NO_FETCH"
      });
    }
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.defaultHeaders = options.headers ?? {};
  }
  request(spec) {
    return new APIPromise(this.execute(spec));
  }
  buildUrl(spec) {
    const base = /^https?:\/\//i.test(spec.path) ? spec.path : `${this.baseUrl}${spec.path}`;
    return base + serializeQuery(spec.query);
  }
  async execute(spec) {
    const opts = spec.options ?? {};
    const maxRetries = Math.max(0, opts.maxRetries ?? this.maxRetries);
    const url = this.buildUrl(spec);
    const headers = {
      Accept: "application/json",
      ...this.defaultHeaders,
      ...this.useApiKeyHeader ? { "X-API-Key": this.apiKey } : { Authorization: `Bearer ${this.apiKey}` },
      ...opts.headers ?? {}
    };
    let body;
    if (spec.body !== void 0) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(spec.body);
    }
    const idempotent = IDEMPOTENT.has(spec.method);
    for (let attempt = 0; ; attempt++) {
      let error;
      let retryable;
      let delayMs;
      try {
        const res = await this.fetchOnce(url, { method: spec.method, headers, body }, opts);
        const parsed = await readBody(res);
        if (res.ok && !(isObject(parsed) && parsed.success === false)) {
          const envelope = isObject(parsed) ? parsed : {};
          return {
            data: "data" in envelope ? envelope.data : parsed,
            meta: envelope.meta,
            status: res.status,
            headers: res.headers
          };
        }
        error = toApiError(res, parsed);
        if (res.status === 429) {
          retryable = error.retryAfter !== void 0 && error.retryAfter <= this.maxRetryAfterSeconds;
          delayMs = (error.retryAfter ?? 0) * 1e3;
        } else {
          retryable = res.status >= 500 && idempotent;
          delayMs = backoffDelayMs(attempt, 500, 8e3, this.random);
        }
      } catch (e) {
        if (e instanceof RealtimeSportsError && e.code === "ABORTED") throw e;
        error = e instanceof RealtimeSportsError ? e : new RealtimeSportsError({
          message: `Network error: ${e instanceof Error ? e.message : String(e)}`,
          code: "NETWORK_ERROR",
          cause: e
        });
        retryable = idempotent;
        delayMs = backoffDelayMs(attempt, 500, 8e3, this.random);
      }
      if (!retryable || attempt >= maxRetries) throw error;
      await this.sleep(delayMs, opts.signal);
    }
  }
  async fetchOnce(url, init, opts) {
    if (opts.signal?.aborted) throw abortError(opts.signal);
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs) : void 0;
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (e) {
      if (opts.signal?.aborted) throw abortError(opts.signal);
      if (timedOut) {
        throw new RealtimeSportsError({ message: `Request timed out after ${timeoutMs} ms`, code: "TIMEOUT", cause: e });
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
};
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
async function readBody(res) {
  const text = await res.text();
  if (!text) return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
function toApiError(res, body) {
  const err = isObject(body) && isObject(body.error) ? body.error : void 0;
  const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
  const fallbackCode = res.status === 429 ? "rate_limit_exceeded" : `HTTP_${res.status}`;
  const message = typeof err?.message === "string" && err.message || typeof body === "string" && body.length < 500 && body || `HTTP ${res.status} ${res.statusText || ""}`.trim();
  return new RealtimeSportsError({
    message,
    code: typeof err?.code === "string" ? err.code : fallbackCode,
    status: res.status,
    hint: typeof err?.hint === "string" ? err.hint : void 0,
    retryAfter,
    body
  });
}

// src/stream.ts
var OPEN = 1;
var TOKEN_REFRESH_MARGIN_MS = 6e4;
function subKey(s) {
  const f = s.filters ?? {};
  return JSON.stringify([s.event, f.sport ?? null, f.league ?? null, f.eventId ?? null]);
}
function decode(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data);
}
function createStream(client, options) {
  const WS = options.WebSocket ?? globalThis.WebSocket;
  if (!WS) {
    throw new RealtimeSportsError({
      message: "No global WebSocket found. On Node < 22 install `ws` and pass it: client.stream({ WebSocket, ... }).",
      code: "NO_WEBSOCKET"
    });
  }
  const reconnectOpts = options.reconnect === false ? null : options.reconnect === true || !options.reconnect ? {} : options.reconnect;
  const maxAttempts = reconnectOpts?.maxAttempts ?? Infinity;
  const initialDelayMs = reconnectOpts?.initialDelayMs ?? 1e3;
  const maxDelayMs = reconnectOpts?.maxDelayMs ?? 3e4;
  const pingIntervalMs = options.pingIntervalMs ?? 3e4;
  const pongTimeoutMs = options.pongTimeoutMs ?? 1e4;
  const subs = /* @__PURE__ */ new Map();
  for (const s of options.subscriptions ?? []) subs.set(subKey(s), s);
  let ws = null;
  let closedByUser = false;
  let attempts = 0;
  let token = null;
  let reconnectTimer;
  let pingTimer;
  let pongTimer;
  const emitError = (e) => {
    try {
      options.onError?.(e);
    } catch {
    }
  };
  const send = (msg) => {
    if (ws && ws.readyState === OPEN) ws.send(JSON.stringify(msg));
  };
  const subMessage = (type, s) => ({
    type,
    event: s.event,
    ...s.filters ? { filters: s.filters } : {},
    ...type === "subscribe" && s.frequency ? { frequency: s.frequency } : {}
  });
  const stopTimers = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (pongTimer) clearTimeout(pongTimer);
    pingTimer = pongTimer = void 0;
  };
  const scheduleReconnect = () => {
    if (closedByUser || !reconnectOpts) return;
    if (attempts >= maxAttempts) {
      emitError(new RealtimeSportsError({ message: `Gave up reconnecting after ${attempts} attempts`, code: "RECONNECT_FAILED" }));
      return;
    }
    const delayMs = backoffDelayMs(attempts, initialDelayMs, maxDelayMs);
    attempts++;
    options.onReconnecting?.({ attempt: attempts, delayMs });
    reconnectTimer = setTimeout(() => void connect(), delayMs);
  };
  const handleClosed = (code, reason) => {
    stopTimers();
    ws = null;
    let fatal = false;
    if (code === 1008) {
      token = null;
      if (reason && /tier|subscription|not found/i.test(reason)) {
        fatal = true;
        emitError(new RealtimeSportsError({ message: `WebSocket rejected: ${reason}`, code: "WEBSOCKET_FORBIDDEN", status: 403 }));
      }
    }
    const willReconnect = !closedByUser && !fatal && !!reconnectOpts && attempts < maxAttempts;
    options.onClose?.({ code, reason, willReconnect });
    if (!fatal) scheduleReconnect();
  };
  const getToken = async () => {
    if (token && token.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return token;
    const data = await client.createWebSocketToken();
    if (!data?.url || !data?.token) {
      throw new RealtimeSportsError({ message: "WebSocket auth response missing url/token", code: "BAD_RESPONSE" });
    }
    token = { url: data.url, token: data.token, expiresAt: Date.now() + (data.expiresIn ?? 3600) * 1e3 };
    return token;
  };
  const connect = async () => {
    reconnectTimer = void 0;
    if (closedByUser) return;
    let t;
    try {
      t = await getToken();
    } catch (e) {
      const err = e instanceof RealtimeSportsError ? e : new RealtimeSportsError({ message: String(e), code: "NETWORK_ERROR", cause: e });
      emitError(err);
      if (err.status === 401 || err.status === 403 || err.status === 429) return;
      scheduleReconnect();
      return;
    }
    if (closedByUser) return;
    const url = `${t.url}${t.url.includes("?") ? "&" : "?"}token=${encodeURIComponent(t.token)}`;
    let socket;
    try {
      socket = new WS(url);
    } catch (e) {
      emitError(new RealtimeSportsError({ message: `WebSocket connect failed: ${String(e)}`, code: "NETWORK_ERROR", cause: e }));
      scheduleReconnect();
      return;
    }
    ws = socket;
    socket.onopen = () => {
      if (ws !== socket) return;
      for (const s of subs.values()) send(subMessage("subscribe", s));
      if (pingIntervalMs > 0) {
        pingTimer = setInterval(() => {
          send({ type: "ping" });
          if (!pongTimer && pongTimeoutMs > 0) {
            pongTimer = setTimeout(() => {
              if (ws !== socket) return;
              detach(socket);
              try {
                socket.close(4e3, "pong timeout");
              } catch {
              }
              handleClosed(4e3, "pong timeout");
            }, pongTimeoutMs);
          }
        }, pingIntervalMs);
      }
      options.onOpen?.();
    };
    socket.onmessage = (ev) => {
      if (ws !== socket) return;
      let msg;
      try {
        msg = JSON.parse(decode(ev.data));
      } catch {
        return;
      }
      attempts = 0;
      options.onRawMessage?.(msg);
      switch (msg.type) {
        case "pong":
          if (pongTimer) clearTimeout(pongTimer);
          pongTimer = void 0;
          return;
        case "subscribed":
          options.onSubscribed?.(msg.data ?? {});
          return;
        case "unsubscribed":
          return;
        case "error": {
          const body = msg.error ?? msg.data?.error ?? msg.data;
          emitError(new RealtimeSportsError({ message: body?.message ?? "WebSocket error", code: body?.code ?? "WEBSOCKET_ERROR", body: msg }));
          return;
        }
        case "quota_exceeded": {
          const d = msg.data ?? {};
          emitError(new RealtimeSportsError({ message: d.message ?? "Monthly quota exhausted", code: "quota_exceeded", status: 429, body: msg }));
          return;
        }
        default:
          if (typeof msg.type === "string" && msg.type.startsWith("event_")) {
            options.onMessage?.(msg);
          }
      }
    };
    socket.onerror = () => {
      if (ws === socket) emitError(new RealtimeSportsError({ message: "WebSocket error", code: "NETWORK_ERROR" }));
    };
    socket.onclose = (ev) => {
      if (ws !== socket) return;
      handleClosed(ev?.code, ev?.reason);
    };
  };
  const detach = (s) => {
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
  };
  void connect();
  return {
    subscribe(s) {
      subs.set(subKey(s), s);
      send(subMessage("subscribe", s));
    },
    unsubscribe(s) {
      subs.delete(subKey(s));
      send(subMessage("unsubscribe", s));
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
          s.close(1e3, "client closed");
        } catch {
        }
        options.onClose?.({ code: 1e3, reason: "client closed", willReconnect: false });
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

// src/client.ts
var Webhooks = class {
  constructor(core) {
    this.core = core;
  }
  /** `listWebhooks` - GET /webhooks */
  list(options) {
    return this.core.request({ method: "GET", path: "/webhooks", options });
  }
  /** `createWebhook` - POST /webhooks. The response includes the signing `secret`; store it. */
  create(body, options) {
    return this.core.request({ method: "POST", path: "/webhooks", body, options });
  }
  /** `getWebhook` - GET /webhooks/{webhookId} */
  get(webhookId, options) {
    return this.core.request({ method: "GET", path: encodePath`/webhooks/${webhookId}`, options });
  }
  /** `updateWebhook` - PATCH /webhooks/{webhookId} */
  update(webhookId, body, options) {
    return this.core.request({ method: "PATCH", path: encodePath`/webhooks/${webhookId}`, body, options });
  }
  /** `deleteWebhook` - DELETE /webhooks/{webhookId} */
  delete(webhookId, options) {
    return this.core.request({ method: "DELETE", path: encodePath`/webhooks/${webhookId}`, options });
  }
  /** `getWebhookSecret` - GET /webhooks/{webhookId}/secret */
  getSecret(webhookId, options) {
    return this.core.request({ method: "GET", path: encodePath`/webhooks/${webhookId}/secret`, options });
  }
  /** `rotateWebhookSecret` - POST /webhooks/{webhookId}/secret */
  rotateSecret(webhookId, options) {
    return this.core.request({ method: "POST", path: encodePath`/webhooks/${webhookId}/secret`, options });
  }
  /** `testWebhook` - POST /webhooks/{webhookId}/test. Sends a sample (or replays `deliveryId`). */
  test(webhookId, body = {}, options) {
    return this.core.request({ method: "POST", path: encodePath`/webhooks/${webhookId}/test`, body, options });
  }
  /** `listWebhookDeliveries` - GET /webhooks/{webhookId}/deliveries */
  deliveries(webhookId, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/webhooks/${webhookId}/deliveries`, query, options });
  }
};
var RealtimeSportsClient = class {
  constructor(options = {}) {
    this.core = new HttpCore(options);
    this.webhooks = new Webhooks(this.core);
  }
  /** Escape hatch for endpoints not yet wrapped. `path` is relative to the base URL. */
  request(method, path, init = {}, options) {
    return this.core.request({ method, path, query: init.query, body: init.body, options });
  }
  // ------------------------------------------------------------------ sports & leagues
  /** `listSports` - GET /sports */
  listSports(options) {
    return this.core.request({ method: "GET", path: "/sports", options });
  }
  /** `listLeagues` - GET /sports/{sport}/leagues */
  listLeagues(sport, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues`, options });
  }
  /** `getLeague` - GET /sports/{sport}/leagues/{league} */
  getLeague(sport, league, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}`, options });
  }
  // ------------------------------------------------------------------ events
  /** `listEvents` - GET /sports/{sport}/leagues/{league}/events */
  listEvents(sport, league, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/events`, query, options });
  }
  /** `listLiveEvents` - GET /sports/{sport}/leagues/{league}/events/live. Empty array when nothing is live. */
  listLiveEvents(sport, league, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/events/live`, query, options });
  }
  /** `getEvent` - GET /sports/{sport}/leagues/{league}/events/{eventId} */
  getEvent(sport, league, eventId, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/events/${eventId}`, query, options });
  }
  /** `getEventBoxScore` - GET .../events/{eventId}/boxscore */
  getEventBoxScore(sport, league, eventId, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/events/${eventId}/boxscore`, options });
  }
  /** `getEventWinProbability` - GET .../events/{eventId}/winprobability */
  getEventWinProbability(sport, league, eventId, query, options) {
    return this.core.request({
      method: "GET",
      path: encodePath`/sports/${sport}/leagues/${league}/events/${eventId}/winprobability`,
      query,
      options
    });
  }
  /** `getEventRoster` - GET .../events/{eventId}/roster */
  getEventRoster(sport, league, eventId, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/events/${eventId}/roster`, query, options });
  }
  /** `listPlays` - GET .../events/{eventId}/plays (paginated; see `meta.pagination`) */
  listPlays(sport, league, eventId, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/events/${eventId}/plays`, query, options });
  }
  /** `listPenalties` - GET .../events/{eventId}/penalties */
  listPenalties(sport, league, eventId, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/events/${eventId}/penalties`, query, options });
  }
  /** `getEventOdds` - GET .../events/{eventId}/odds */
  getEventOdds(sport, league, eventId, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/events/${eventId}/odds`, options });
  }
  /** `getEventOddsHistory` - GET .../events/{eventId}/odds/history */
  getEventOddsHistory(sport, league, eventId, query, options) {
    return this.core.request({
      method: "GET",
      path: encodePath`/sports/${sport}/leagues/${league}/events/${eventId}/odds/history`,
      query,
      options
    });
  }
  // ------------------------------------------------------------------ teams
  /** `listTeams` - GET /sports/{sport}/leagues/{league}/teams */
  listTeams(sport, league, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/teams`, query, options });
  }
  /** `getTeam` - GET .../teams/{teamId} */
  getTeam(sport, league, teamId, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/teams/${teamId}`, options });
  }
  /** `getTeamRoster` - GET .../teams/{teamId}/roster */
  getTeamRoster(sport, league, teamId, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/teams/${teamId}/roster`, query, options });
  }
  /** `getTeamDepthChart` - GET .../teams/{teamId}/depthchart */
  getTeamDepthChart(sport, league, teamId, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/teams/${teamId}/depthchart`, query, options });
  }
  // ------------------------------------------------------------------ athletes
  /** `listAthletes` - GET /sports/{sport}/leagues/{league}/athletes */
  listAthletes(sport, league, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/athletes`, query, options });
  }
  /** `searchAthletes` - GET .../athletes/search?query=... */
  searchAthletes(sport, league, query, params, options) {
    return this.core.request({
      method: "GET",
      path: encodePath`/sports/${sport}/leagues/${league}/athletes/search`,
      query: { ...params, query },
      options
    });
  }
  /** `getAthlete` - GET .../athletes/{athleteId} */
  getAthlete(sport, league, athleteId, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/athletes/${athleteId}`, query, options });
  }
  /** `getAthleteGameLog` - GET .../athletes/{athleteId}/gamelog?season=... */
  getAthleteGameLog(sport, league, athleteId, season, params, options) {
    return this.core.request({
      method: "GET",
      path: encodePath`/sports/${sport}/leagues/${league}/athletes/${athleteId}/gamelog`,
      query: { ...params, season },
      options
    });
  }
  /** `getAthleteAvailabilityHistory` - GET .../athletes/{athleteId}/availability-history */
  getAthleteAvailabilityHistory(sport, league, athleteId, query, options) {
    return this.core.request({
      method: "GET",
      path: encodePath`/sports/${sport}/leagues/${league}/athletes/${athleteId}/availability-history`,
      query,
      options
    });
  }
  // ------------------------------------------------------------------ injuries & availability
  /** `getInjuries` - GET /sports/{sport}/leagues/{league}/injuries */
  getInjuries(sport, league, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/injuries`, query, options });
  }
  /** `getPlayerAvailability` - GET .../player-availability */
  getPlayerAvailability(sport, league, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/player-availability`, query, options });
  }
  /** `getPlayerAvailabilityHistory` - GET .../player-availability/history */
  getPlayerAvailabilityHistory(sport, league, query, options) {
    return this.core.request({
      method: "GET",
      path: encodePath`/sports/${sport}/leagues/${league}/player-availability/history`,
      query,
      options
    });
  }
  // ------------------------------------------------------------------ news & transactions
  /** `getNews` - GET /sports/{sport}/leagues/{league}/news */
  getNews(sport, league, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/news`, query, options });
  }
  /** `getNewsHistory` - GET .../news/history */
  getNewsHistory(sport, league, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/news/history`, query, options });
  }
  /** `getTransactions` - GET .../transactions */
  getTransactions(sport, league, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/transactions`, query, options });
  }
  // ------------------------------------------------------------------ seasons & schedule
  /** `getCurrentSeason` - GET .../season */
  getCurrentSeason(sport, league, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/season`, options });
  }
  /** `listSeasons` - GET .../seasons */
  listSeasons(sport, league, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/seasons`, query, options });
  }
  /** `getSeason` - GET .../seasons/{season} */
  getSeason(sport, league, season, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/seasons/${season}`, options });
  }
  /** `getSeasonSchedule` - GET .../seasons/{season}/schedule (`week` applies to NFL and college football) */
  getSeasonSchedule(sport, league, season, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/seasons/${season}/schedule`, query, options });
  }
  /** `listSeasonWeeks` - GET .../seasons/{season}/weeks */
  listSeasonWeeks(sport, league, season, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/seasons/${season}/weeks`, query, options });
  }
  /** `listSeasonTypes` - GET .../seasons/{season}/types */
  listSeasonTypes(sport, league, season, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/seasons/${season}/types`, options });
  }
  /** `getSeasonType` - GET .../seasons/{season}/types/{typeId} */
  getSeasonType(sport, league, season, typeId, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/seasons/${season}/types/${typeId}`, options });
  }
  /** `listGroups` - GET .../seasons/{season}/types/{typeId}/groups */
  listGroups(sport, league, season, typeId, options) {
    return this.core.request({
      method: "GET",
      path: encodePath`/sports/${sport}/leagues/${league}/seasons/${season}/types/${typeId}/groups`,
      options
    });
  }
  /** `getGroup` - GET .../seasons/{season}/types/{typeId}/groups/{groupId} */
  getGroup(sport, league, season, typeId, groupId, options) {
    return this.core.request({
      method: "GET",
      path: encodePath`/sports/${sport}/leagues/${league}/seasons/${season}/types/${typeId}/groups/${groupId}`,
      options
    });
  }
  /** `listGroupTeams` - GET .../seasons/{season}/types/{typeId}/groups/{groupId}/teams */
  listGroupTeams(sport, league, season, typeId, groupId, query, options) {
    return this.core.request({
      method: "GET",
      path: encodePath`/sports/${sport}/leagues/${league}/seasons/${season}/types/${typeId}/groups/${groupId}/teams`,
      query,
      options
    });
  }
  /** `listTeamSeasonEvents` - GET .../seasons/{season}/teams/{teamId}/events */
  listTeamSeasonEvents(sport, league, season, teamId, query, options) {
    return this.core.request({
      method: "GET",
      path: encodePath`/sports/${sport}/leagues/${league}/seasons/${season}/teams/${teamId}/events`,
      query,
      options
    });
  }
  /** `getTournament` - GET .../seasons/{season}/tournament */
  getTournament(sport, league, season, query, options) {
    return this.core.request({ method: "GET", path: encodePath`/sports/${sport}/leagues/${league}/seasons/${season}/tournament`, query, options });
  }
  // ------------------------------------------------------------------ websocket
  /** `createWebSocketToken` - POST https://www.realtimesportsapi.com/api/websocket/auth (token valid ~1 hour) */
  createWebSocketToken(options) {
    return this.core.request({ method: "POST", path: this.core.websocketAuthUrl, options });
  }
  /**
   * Open a managed WebSocket stream: authenticates, connects, subscribes, keeps the connection
   * alive with pings, and reconnects (re-authenticating when needed) with backoff.
   * Each delivered event message counts toward your monthly quota.
   */
  stream(options) {
    return createStream(this, options);
  }
};

exports.APIPromise = APIPromise;
exports.DEFAULT_BASE_URL = DEFAULT_BASE_URL;
exports.RealtimeSportsClient = RealtimeSportsClient;
exports.RealtimeSportsError = RealtimeSportsError;
exports.VERSION = VERSION;
exports.Webhooks = Webhooks;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map