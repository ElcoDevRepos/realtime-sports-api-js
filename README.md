# realtime-sports-api

Official TypeScript/JavaScript client for the [Realtime Sports API](https://www.realtimesportsapi.com/docs?utm_source=github&utm_medium=realtime-sports-api-js):
live scores, play-by-play, box scores, schedules, teams, athletes, injuries, news, betting odds,
webhooks and a WebSocket push stream for NFL, college football, NBA, men's college basketball, MLB,
NHL and 23 soccer competitions.

- Zero runtime dependencies, built on `fetch` (Node 18+, browsers, Deno, Bun, edge runtimes)
- Types generated from the OpenAPI spec, with one method per API operation
- Retries with backoff for 5xx and network errors; short `Retry-After` waits on 429
- Managed WebSocket stream with re-auth, resubscribe, keepalive and reconnect

> **Freshness:** data is aggregated from public sources and is typically 20-30 seconds behind live
> play. There is no SLA. It is not suitable for uses that need sub-second data.

> **Coverage:** 29 leagues monitored live: NFL, college football, NBA, men's college basketball, MLB,
> NHL and 23 soccer competitions. Betting odds come from a single source book. Not intended for
> sub-second in-play betting.

## Install

The package is **not yet on npm**. Install it straight from GitHub (the built `dist/` is committed,
so no build step runs on install):

```bash
npm install github:ElcoDevRepos/realtime-sports-api-js
# pin a commit or tag for reproducible builds:
npm install github:ElcoDevRepos/realtime-sports-api-js#<commit-or-tag>
```

The package name is `realtime-sports-api`, so imports look the same as they will once it is published
to npm.

Get a free key at <https://www.realtimesportsapi.com/signup?utm_source=github&utm_medium=realtime-sports-api-js>.

## Quickstart

```ts
import { RealtimeSportsClient } from 'realtime-sports-api';

const client = new RealtimeSportsClient({ apiKey: process.env.REALTIME_SPORTS_API_KEY });

// Games in progress right now (an empty array when nothing is live)
const live = await client.listLiveEvents('football', 'nfl');
for (const game of live) {
  console.log(`${game.awayTeam?.abbreviation} ${game.awayTeam?.score} @ ${game.homeTeam?.abbreviation} ${game.homeTeam?.score}  ${game.status?.detail}`);
}

// Week 5 of the 2026 NFL regular season
const week5 = await client.getSeasonSchedule('football', 'nfl', 2026, { week: 5, seasonType: 2 });
```

CommonJS works too: `const { RealtimeSportsClient } = require('realtime-sports-api')`.

If `apiKey` is omitted the client reads `REALTIME_SPORTS_API_KEY` from the environment (where one exists).
Do not ship your API key in browser code you serve to the public; call the API from your server instead.

### Return values: `data` by default, `.withMeta()` for the envelope

Every method returns an `APIPromise`. Awaiting it gives you the response's `data`. Call `.withMeta()`
to get `{ data, meta, status, headers }` instead, for example to watch your remaining quota or read
pagination:

```ts
const { data: plays, meta } = await client.listPlays('football', 'nfl', '401772982', { limit: 100 }).withMeta();
console.log(meta?.rateLimit?.remaining, meta?.pagination?.hasNextPage);
```

This is the same for every method.

## Client options

```ts
new RealtimeSportsClient({
  apiKey: '...',               // required (or REALTIME_SPORTS_API_KEY)
  baseUrl: 'https://www.realtimesportsapi.com/api/v1', // default
  maxRetries: 2,               // retries after the first attempt (5xx, network errors, short 429s)
  timeoutMs: 30_000,           // per attempt
  maxRetryAfterSeconds: 60,    // longest Retry-After the client will wait out on a 429
  useApiKeyHeader: false,      // send X-API-Key instead of Authorization: Bearer
  fetch: customFetch,          // defaults to global fetch
  headers: { 'X-Trace': '1' }  // extra headers on every request
});
```

Every method also takes a final optional `RequestOptions`: `{ signal, timeoutMs, maxRetries, headers }`.

## Methods

Path arguments are positional (`sport`, `league`, ids, `season`). Optional query parameters go in
an object after them. Required query parameters (`query` for search, `season` for game logs) are
positional. Method names match the OpenAPI `operationId`s.

Sport slugs: `football` (American football), `basketball`, `baseball`, `hockey`, `soccer`.
League slugs include `nfl`, `college-football`, `nba`, `mens-college-basketball`, `mlb`, `nhl`, and
soccer competitions such as `eng.1`, `usa.1`, `uefa.champions`.

### Sports and leagues

| Method | Endpoint |
| --- | --- |
| `listSports()` | `GET /sports` |
| `listLeagues(sport)` | `GET /sports/{sport}/leagues` |
| `getLeague(sport, league)` | `GET /sports/{sport}/leagues/{league}` |

### Events (games)

All paths below are under `/sports/{sport}/leagues/{league}`.

| Method | Endpoint | Query options |
| --- | --- | --- |
| `listEvents(sport, league, q?)` | `/events` | `limit`, `includeOdds` |
| `listLiveEvents(sport, league, q?)` | `/events/live` | `includeOdds` |
| `getEvent(sport, league, eventId, q?)` | `/events/{eventId}` | `includeOdds` |
| `getEventBoxScore(sport, league, eventId)` | `/events/{eventId}/boxscore` | |
| `getEventWinProbability(sport, league, eventId, q?)` | `/events/{eventId}/winprobability` | `drives` |
| `getEventRoster(sport, league, eventId, q?)` | `/events/{eventId}/roster` | `team`, `starters`, `enrich` |
| `listPlays(sport, league, eventId, q?)` | `/events/{eventId}/plays` | `limit`, `page`, `enrich` |
| `listPenalties(sport, league, eventId, q?)` | `/events/{eventId}/penalties` | `enrich` |
| `getEventOdds(sport, league, eventId)` | `/events/{eventId}/odds` | |
| `getEventOddsHistory(sport, league, eventId, q?)` | `/events/{eventId}/odds/history` | `limit` |

### Teams

| Method | Endpoint | Query options |
| --- | --- | --- |
| `listTeams(sport, league, q?)` | `/teams` | `limit`, `page` |
| `getTeam(sport, league, teamId)` | `/teams/{teamId}` | |
| `getTeamRoster(sport, league, teamId, q?)` | `/teams/{teamId}/roster` | `season` |
| `getTeamDepthChart(sport, league, teamId, q?)` | `/teams/{teamId}/depthchart` | `season` |

### Athletes

| Method | Endpoint | Query options |
| --- | --- | --- |
| `listAthletes(sport, league, q?)` | `/athletes` | `limit`, `page`, `include` |
| `searchAthletes(sport, league, query, q?)` | `/athletes/search` | `limit` |
| `getAthlete(sport, league, athleteId, q?)` | `/athletes/{athleteId}` | `season`, `seasonType` |
| `getAthleteGameLog(sport, league, athleteId, season, q?)` | `/athletes/{athleteId}/gamelog` | `week`, `seasonType` |
| `getAthleteAvailabilityHistory(sport, league, athleteId, q?)` | `/athletes/{athleteId}/availability-history` | `limit`, `from`, `to` |

### Injuries and availability

| Method | Endpoint | Query options |
| --- | --- | --- |
| `getInjuries(sport, league, q?)` | `/injuries` | `team` |
| `getPlayerAvailability(sport, league, q?)` | `/player-availability` | `team`, `status` |
| `getPlayerAvailabilityHistory(sport, league, q?)` | `/player-availability/history` | `team`, `since`, `status`, `limit` |

### News and transactions

| Method | Endpoint | Query options |
| --- | --- | --- |
| `getNews(sport, league, q?)` | `/news` | `limit`, `page`, `team`, `athlete`, `since`, `from`, `to` |
| `getNewsHistory(sport, league, q?)` | `/news/history` | `from`, `to`, `team`, `athlete`, `limit`, `page` |
| `getTransactions(sport, league, q?)` | `/transactions` | `limit`, `page`, `team`, `season` |

### Seasons and schedules

| Method | Endpoint | Query options |
| --- | --- | --- |
| `getCurrentSeason(sport, league)` | `/season` | |
| `listSeasons(sport, league, q?)` | `/seasons` | `limit`, `page` |
| `getSeason(sport, league, season)` | `/seasons/{season}` | |
| `getSeasonSchedule(sport, league, season, q?)` | `/seasons/{season}/schedule` | `week` (NFL/college football), `seasonType` (1 pre, 2 regular, 3 post), `includeOdds` |
| `listSeasonWeeks(sport, league, season, q?)` | `/seasons/{season}/weeks` | `seasonType` |
| `listSeasonTypes(sport, league, season)` | `/seasons/{season}/types` | |
| `getSeasonType(sport, league, season, typeId)` | `/seasons/{season}/types/{typeId}` | |
| `listGroups(sport, league, season, typeId)` | `/seasons/{season}/types/{typeId}/groups` | |
| `getGroup(sport, league, season, typeId, groupId)` | `/seasons/{season}/types/{typeId}/groups/{groupId}` | |
| `listGroupTeams(sport, league, season, typeId, groupId, q?)` | `.../groups/{groupId}/teams` | `pageSize`, `page` |
| `listTeamSeasonEvents(sport, league, season, teamId, q?)` | `/seasons/{season}/teams/{teamId}/events` | `page`, `pageSize`, `limit` |
| `getTournament(sport, league, season, q?)` | `/seasons/{season}/tournament` | `round`, `region`, `firstFour`, `startDate`, `endDate` |

### Webhooks

| Method | operationId | Endpoint |
| --- | --- | --- |
| `webhooks.list()` | `listWebhooks` | `GET /webhooks` |
| `webhooks.create({ url, events, leagues?, frequency?, active? })` | `createWebhook` | `POST /webhooks` |
| `webhooks.get(id)` | `getWebhook` | `GET /webhooks/{id}` |
| `webhooks.update(id, patch)` | `updateWebhook` | `PATCH /webhooks/{id}` |
| `webhooks.delete(id)` | `deleteWebhook` | `DELETE /webhooks/{id}` |
| `webhooks.getSecret(id)` | `getWebhookSecret` | `GET /webhooks/{id}/secret` |
| `webhooks.rotateSecret(id)` | `rotateWebhookSecret` | `POST /webhooks/{id}/secret` |
| `webhooks.test(id, { eventType?, deliveryId? })` | `testWebhook` | `POST /webhooks/{id}/test` |
| `webhooks.deliveries(id, { limit? })` | `listWebhookDeliveries` | `GET /webhooks/{id}/deliveries` |

Webhook event types: `event.live`, `event.score_change`, `event.status_change`, `event.play`,
`event.final`. Frequencies: `asap`, `30s`, `1m`, `5m`, `10m`, `30m`.

### WebSocket and escape hatch

| Method | Description |
| --- | --- |
| `createWebSocketToken()` | `POST /api/websocket/auth` (outside `/v1`); returns `{ url, token, expiresIn }` |
| `stream(options)` | Managed WebSocket connection (see below) |
| `request(method, path, { query, body })` | Call any path under the base URL with the same auth and retries |

### Types

All schema types are exported: `Event`, `EventTeam`, `EventStatus`, `Play`, `Odds`, `Team`,
`Athlete`, `Injury`, `NewsArticle`, `Webhook`, `WebhookInput`, and more. The raw generated
`paths`, `components` and `operations` types are exported too, along with helpers
`ResponseData<'operationId'>` and `QueryParams<'operationId'>`.

```ts
import type { Event, ResponseData } from 'realtime-sports-api';
type Schedule = ResponseData<'getSeasonSchedule'>; // Event[]
```

## Errors and retries

Every failure throws a `RealtimeSportsError`:

| Property | Meaning |
| --- | --- |
| `status` | HTTP status, or `undefined` for network errors and timeouts |
| `code` | API error code (`MISSING_TOKEN`, `USER_NOT_FOUND`, `TRIAL_EXPIRED`, `rate_limit_exceeded`, ...) or `NETWORK_ERROR`, `TIMEOUT`, `ABORTED` |
| `message` | Human-readable message from the API |
| `hint` | Optional hint on how to fix the request |
| `retryAfter` | Seconds from the `Retry-After` header (429s) |
| `isRateLimited` / `isAuthError` | Convenience checks for 429 and 401/403 |

```ts
import { RealtimeSportsError } from 'realtime-sports-api';

try {
  await client.listLiveEvents('basketball', 'nba');
} catch (err) {
  if (err instanceof RealtimeSportsError && err.isRateLimited) {
    console.log(`Monthly quota exhausted; retry in ${err.retryAfter}s or upgrade your plan.`);
  } else {
    throw err;
  }
}
```

Retry behavior (`maxRetries`, default 2):

- **5xx and network errors/timeouts:** retried with exponential backoff and jitter (about 0.5 s, 1 s, 2 s ..., capped at 8 s)
  for `GET`/`DELETE`. `POST`/`PATCH` (creating or changing webhooks) are not retried on 5xx or network errors, to avoid duplicates.
- **429:** the API returns 429 when your **monthly** quota is exhausted, with a `Retry-After` header.
  If `Retry-After` is at most `maxRetryAfterSeconds` (default 60) the client waits and retries once per
  remaining retry. If it is longer, or missing, the error is thrown immediately: a monthly quota will not
  clear in seconds, so waiting would only hang your program.
- **Other 4xx:** thrown immediately.

## Streaming (WebSocket)

`client.stream()` handles the whole lifecycle: it calls `POST /api/websocket/auth`, connects to
`${url}?token=${token}`, sends your subscriptions, pings every 30 s, and on disconnect reconnects with
backoff, re-authenticating when the 1-hour token is near expiry or was rejected, then resubscribes.

```ts
import { RealtimeSportsClient } from 'realtime-sports-api';
import WebSocket from 'ws'; // only needed on Node < 22; browsers, Deno, Bun and Node 22+ have a global WebSocket

const client = new RealtimeSportsClient({ apiKey: process.env.REALTIME_SPORTS_API_KEY });

const stream = client.stream({
  WebSocket, // omit when a global WebSocket exists
  subscriptions: [
    { event: 'event_score_change', filters: { sport: 'football', league: 'nfl' } },
    { event: 'event_final', filters: { sport: 'football', league: 'nfl' } }
  ],
  onMessage: (msg) => {
    const d = msg.data;
    console.log(msg.type, d.name, `${d.awayTeam?.score}-${d.homeTeam?.score}`);
  },
  onSubscribed: (ack) => ack.warnings?.forEach((w) => console.warn(w)),
  onError: (err) => console.error(err.code, err.message),
  onClose: ({ code, willReconnect }) => console.log('closed', code, { willReconnect })
});

// later
stream.subscribe({ event: 'event_play', filters: { sport: 'football', league: 'nfl', eventId: '401772982' } });
stream.unsubscribe({ event: 'event_final', filters: { sport: 'football', league: 'nfl' } });
stream.close();
```

| Option | Default | Description |
| --- | --- | --- |
| `subscriptions` | `[]` | `{ event, filters?: { sport, league, eventId }, frequency? }` |
| `onMessage(msg)` | | Data events: `event_score_change`, `event_live`, `event_status_change`, `event_play`, `event_final`, `event_odds_change` |
| `onSubscribed(ack)` | | Server acknowledgement; check `ack.warnings` (e.g. a league that is not monitored) |
| `onError(err)` | | Connection errors, server `error` messages, `quota_exceeded`, fatal auth errors |
| `onOpen()` / `onClose(info)` / `onReconnecting(info)` | | Lifecycle hooks |
| `onRawMessage(msg)` | | Every server message, including control messages |
| `WebSocket` | `globalThis.WebSocket` | Constructor, e.g. from the `ws` package |
| `pingIntervalMs` | `30000` | App-level ping; `0` disables. Pongs do not count toward quota |
| `pongTimeoutMs` | `10000` | Reconnect if no pong arrives in time |
| `reconnect` | enabled | `false`, or `{ maxAttempts, initialDelayMs, maxDelayMs }` |

Notes:

- WebSocket access needs a plan that includes it; a key without access gets an `onError` with
  status 401/403 (or code `WEBSOCKET_FORBIDDEN`) and the stream stops instead of retrying.
- **Each delivered event message counts toward your monthly quota**. Narrow filters (`league`,
  `eventId`) and the server-side `frequency` throttle (`30s`, `1m`, `5m`, ...) keep usage down.
- Soccer uses `sport: 'soccer'`. `sport: 'football'` is American football only.
- Events that happen while disconnected are not replayed. If you need every event, also use webhooks
  or re-read the event over REST after reconnecting.

## Quotas and polling

Monthly quotas as of October 2026: Free 125 calls (1,000 during the first 30 days), Starter 10,000,
Growth 25,000, Pro 50,000, Scale 500,000. Current numbers are on the
[pricing page](https://www.realtimesportsapi.com/pricing?utm_source=github&utm_medium=realtime-sports-api-js). Every successful REST call counts as one call.

Polling math, for one league:

| Pattern | Calls |
| --- | --- |
| `listLiveEvents` every 30 s during a 3.5-hour game window | 420 per window |
| ... every 60 s | 210 per window |
| Idle check every 15 min, 24 hours a day | 96 per day (~2,900 per month) |

So poll every 30-60 s only while something is live, back off to 10-15 minutes otherwise, and prefer
the WebSocket stream or webhooks for continuous updates. Polling faster than every ~20 s gains nothing
because the data itself is typically 20-30 s behind live play.

## Regenerating types

`src/schema.d.ts` is generated from the OpenAPI spec with `openapi-typescript`:

```bash
npm run generate                                   # from https://www.realtimesportsapi.com/openapi.json
SPEC=/path/to/openapi.json npm run generate        # from a local file
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Links

- Free API key: [https://www.realtimesportsapi.com/signup](https://www.realtimesportsapi.com/signup?utm_source=github&utm_medium=realtime-sports-api-js)
- API docs: [https://www.realtimesportsapi.com/docs](https://www.realtimesportsapi.com/docs?utm_source=github&utm_medium=realtime-sports-api-js)
- Pricing and quotas: [https://www.realtimesportsapi.com/pricing](https://www.realtimesportsapi.com/pricing?utm_source=github&utm_medium=realtime-sports-api-js)
- Hosted MCP server for AI assistants: [https://www.realtimesportsapi.com/docs/mcp](https://www.realtimesportsapi.com/docs/mcp?utm_source=github&utm_medium=realtime-sports-api-js)
- Python SDK: [ElcoDevRepos/realtime-sports-api-python](https://github.com/ElcoDevRepos/realtime-sports-api-python)
- Runnable examples (curl, JS, Python, MCP configs): [ElcoDevRepos/realtime-sports-api-examples](https://github.com/ElcoDevRepos/realtime-sports-api-examples)

## License

MIT
