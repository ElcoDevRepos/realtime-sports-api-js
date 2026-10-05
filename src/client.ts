import { APIPromise, HttpCore, encodePath as p, type ClientOptions, type RequestOptions, type HttpMethod } from './core';
import { createStream, type StreamHandle, type StreamOptions } from './stream';
import type { OperationId, PathParam, QueryParams, RequestBody, ResponseData } from './types';

type Q<Op extends OperationId> = QueryParams<Op>;

/** Webhook management (`/webhooks`). */
export class Webhooks {
  constructor(private readonly core: HttpCore) {}

  /** `listWebhooks` - GET /webhooks */
  list(options?: RequestOptions): APIPromise<ResponseData<'listWebhooks'>> {
    return this.core.request({ method: 'GET', path: '/webhooks', options });
  }

  /** `createWebhook` - POST /webhooks. The response includes the signing `secret`; store it. */
  create(body: RequestBody<'createWebhook'>, options?: RequestOptions): APIPromise<ResponseData<'createWebhook'>> {
    return this.core.request({ method: 'POST', path: '/webhooks', body, options });
  }

  /** `getWebhook` - GET /webhooks/{webhookId} */
  get(webhookId: string, options?: RequestOptions): APIPromise<ResponseData<'getWebhook'>> {
    return this.core.request({ method: 'GET', path: p`/webhooks/${webhookId}`, options });
  }

  /** `updateWebhook` - PATCH /webhooks/{webhookId} */
  update(
    webhookId: string,
    body: RequestBody<'updateWebhook'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'updateWebhook'>> {
    return this.core.request({ method: 'PATCH', path: p`/webhooks/${webhookId}`, body, options });
  }

  /** `deleteWebhook` - DELETE /webhooks/{webhookId} */
  delete(webhookId: string, options?: RequestOptions): APIPromise<ResponseData<'deleteWebhook'>> {
    return this.core.request({ method: 'DELETE', path: p`/webhooks/${webhookId}`, options });
  }

  /** `getWebhookSecret` - GET /webhooks/{webhookId}/secret */
  getSecret(webhookId: string, options?: RequestOptions): APIPromise<ResponseData<'getWebhookSecret'>> {
    return this.core.request({ method: 'GET', path: p`/webhooks/${webhookId}/secret`, options });
  }

  /** `rotateWebhookSecret` - POST /webhooks/{webhookId}/secret */
  rotateSecret(webhookId: string, options?: RequestOptions): APIPromise<ResponseData<'rotateWebhookSecret'>> {
    return this.core.request({ method: 'POST', path: p`/webhooks/${webhookId}/secret`, options });
  }

  /** `testWebhook` - POST /webhooks/{webhookId}/test. Sends a sample (or replays `deliveryId`). */
  test(
    webhookId: string,
    body: RequestBody<'testWebhook'> = {},
    options?: RequestOptions
  ): APIPromise<ResponseData<'testWebhook'>> {
    return this.core.request({ method: 'POST', path: p`/webhooks/${webhookId}/test`, body, options });
  }

  /** `listWebhookDeliveries` - GET /webhooks/{webhookId}/deliveries */
  deliveries(
    webhookId: string,
    query?: Q<'listWebhookDeliveries'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'listWebhookDeliveries'>> {
    return this.core.request({ method: 'GET', path: p`/webhooks/${webhookId}/deliveries`, query, options });
  }
}

/**
 * Client for the Realtime Sports API.
 *
 * Every method returns an {@link APIPromise}: `await` it for the response `data`, or call
 * `.withMeta()` for `{ data, meta, status, headers }`.
 *
 * ```ts
 * const client = new RealtimeSportsClient({ apiKey: process.env.REALTIME_SPORTS_API_KEY });
 * const live = await client.listLiveEvents('football', 'nfl');
 * const { data, meta } = await client.listLiveEvents('football', 'nfl').withMeta();
 * console.log(meta?.rateLimit?.remaining);
 * ```
 */
export class RealtimeSportsClient {
  /** Low-level HTTP core (retries, auth, timeouts). */
  readonly core: HttpCore;
  /** Webhook management. */
  readonly webhooks: Webhooks;

  constructor(options: ClientOptions = {}) {
    this.core = new HttpCore(options);
    this.webhooks = new Webhooks(this.core);
  }

  /** Escape hatch for endpoints not yet wrapped. `path` is relative to the base URL. */
  request<T = unknown>(
    method: HttpMethod,
    path: string,
    init: { query?: Record<string, unknown>; body?: unknown } = {},
    options?: RequestOptions
  ): APIPromise<T> {
    return this.core.request<T>({ method, path, query: init.query, body: init.body, options });
  }

  // ------------------------------------------------------------------ sports & leagues

  /** `listSports` - GET /sports */
  listSports(options?: RequestOptions): APIPromise<ResponseData<'listSports'>> {
    return this.core.request({ method: 'GET', path: '/sports', options });
  }

  /** `listLeagues` - GET /sports/{sport}/leagues */
  listLeagues(sport: PathParam, options?: RequestOptions): APIPromise<ResponseData<'listLeagues'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues`, options });
  }

  /** `getLeague` - GET /sports/{sport}/leagues/{league} */
  getLeague(sport: PathParam, league: PathParam, options?: RequestOptions): APIPromise<ResponseData<'getLeague'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}`, options });
  }

  // ------------------------------------------------------------------ events

  /** `listEvents` - GET /sports/{sport}/leagues/{league}/events */
  listEvents(
    sport: PathParam,
    league: PathParam,
    query?: Q<'listEvents'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'listEvents'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/events`, query, options });
  }

  /** `listLiveEvents` - GET /sports/{sport}/leagues/{league}/events/live. Empty array when nothing is live. */
  listLiveEvents(
    sport: PathParam,
    league: PathParam,
    query?: Q<'listLiveEvents'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'listLiveEvents'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/events/live`, query, options });
  }

  /** `getEvent` - GET /sports/{sport}/leagues/{league}/events/{eventId} */
  getEvent(
    sport: PathParam,
    league: PathParam,
    eventId: PathParam,
    query?: Q<'getEvent'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getEvent'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/events/${eventId}`, query, options });
  }

  /** `getEventBoxScore` - GET .../events/{eventId}/boxscore */
  getEventBoxScore(
    sport: PathParam,
    league: PathParam,
    eventId: PathParam,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getEventBoxScore'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/events/${eventId}/boxscore`, options });
  }

  /** `getEventWinProbability` - GET .../events/{eventId}/winprobability */
  getEventWinProbability(
    sport: PathParam,
    league: PathParam,
    eventId: PathParam,
    query?: Q<'getEventWinProbability'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getEventWinProbability'>> {
    return this.core.request({
      method: 'GET',
      path: p`/sports/${sport}/leagues/${league}/events/${eventId}/winprobability`,
      query,
      options
    });
  }

  /** `getEventRoster` - GET .../events/{eventId}/roster */
  getEventRoster(
    sport: PathParam,
    league: PathParam,
    eventId: PathParam,
    query?: Q<'getEventRoster'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getEventRoster'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/events/${eventId}/roster`, query, options });
  }

  /** `listPlays` - GET .../events/{eventId}/plays (paginated; see `meta.pagination`) */
  listPlays(
    sport: PathParam,
    league: PathParam,
    eventId: PathParam,
    query?: Q<'listPlays'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'listPlays'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/events/${eventId}/plays`, query, options });
  }

  /** `listPenalties` - GET .../events/{eventId}/penalties */
  listPenalties(
    sport: PathParam,
    league: PathParam,
    eventId: PathParam,
    query?: Q<'listPenalties'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'listPenalties'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/events/${eventId}/penalties`, query, options });
  }

  /** `getEventOdds` - GET .../events/{eventId}/odds */
  getEventOdds(
    sport: PathParam,
    league: PathParam,
    eventId: PathParam,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getEventOdds'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/events/${eventId}/odds`, options });
  }

  /** `getEventOddsHistory` - GET .../events/{eventId}/odds/history */
  getEventOddsHistory(
    sport: PathParam,
    league: PathParam,
    eventId: PathParam,
    query?: Q<'getEventOddsHistory'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getEventOddsHistory'>> {
    return this.core.request({
      method: 'GET',
      path: p`/sports/${sport}/leagues/${league}/events/${eventId}/odds/history`,
      query,
      options
    });
  }

  // ------------------------------------------------------------------ teams

  /** `listTeams` - GET /sports/{sport}/leagues/{league}/teams */
  listTeams(
    sport: PathParam,
    league: PathParam,
    query?: Q<'listTeams'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'listTeams'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/teams`, query, options });
  }

  /** `getTeam` - GET .../teams/{teamId} */
  getTeam(sport: PathParam, league: PathParam, teamId: PathParam, options?: RequestOptions): APIPromise<ResponseData<'getTeam'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/teams/${teamId}`, options });
  }

  /** `getTeamRoster` - GET .../teams/{teamId}/roster */
  getTeamRoster(
    sport: PathParam,
    league: PathParam,
    teamId: PathParam,
    query?: Q<'getTeamRoster'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getTeamRoster'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/teams/${teamId}/roster`, query, options });
  }

  /** `getTeamDepthChart` - GET .../teams/{teamId}/depthchart */
  getTeamDepthChart(
    sport: PathParam,
    league: PathParam,
    teamId: PathParam,
    query?: Q<'getTeamDepthChart'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getTeamDepthChart'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/teams/${teamId}/depthchart`, query, options });
  }

  // ------------------------------------------------------------------ athletes

  /** `listAthletes` - GET /sports/{sport}/leagues/{league}/athletes */
  listAthletes(
    sport: PathParam,
    league: PathParam,
    query?: Q<'listAthletes'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'listAthletes'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/athletes`, query, options });
  }

  /** `searchAthletes` - GET .../athletes/search?query=... */
  searchAthletes(
    sport: PathParam,
    league: PathParam,
    query: string,
    params?: Omit<Q<'searchAthletes'>, 'query'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'searchAthletes'>> {
    return this.core.request({
      method: 'GET',
      path: p`/sports/${sport}/leagues/${league}/athletes/search`,
      query: { ...params, query },
      options
    });
  }

  /** `getAthlete` - GET .../athletes/{athleteId} */
  getAthlete(
    sport: PathParam,
    league: PathParam,
    athleteId: PathParam,
    query?: Q<'getAthlete'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getAthlete'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/athletes/${athleteId}`, query, options });
  }

  /** `getAthleteGameLog` - GET .../athletes/{athleteId}/gamelog?season=... */
  getAthleteGameLog(
    sport: PathParam,
    league: PathParam,
    athleteId: PathParam,
    season: number,
    params?: Omit<Q<'getAthleteGameLog'>, 'season'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getAthleteGameLog'>> {
    return this.core.request({
      method: 'GET',
      path: p`/sports/${sport}/leagues/${league}/athletes/${athleteId}/gamelog`,
      query: { ...params, season },
      options
    });
  }

  /** `getAthleteAvailabilityHistory` - GET .../athletes/{athleteId}/availability-history */
  getAthleteAvailabilityHistory(
    sport: PathParam,
    league: PathParam,
    athleteId: PathParam,
    query?: Q<'getAthleteAvailabilityHistory'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getAthleteAvailabilityHistory'>> {
    return this.core.request({
      method: 'GET',
      path: p`/sports/${sport}/leagues/${league}/athletes/${athleteId}/availability-history`,
      query,
      options
    });
  }

  // ------------------------------------------------------------------ injuries & availability

  /** `getInjuries` - GET /sports/{sport}/leagues/{league}/injuries */
  getInjuries(
    sport: PathParam,
    league: PathParam,
    query?: Q<'getInjuries'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getInjuries'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/injuries`, query, options });
  }

  /** `getPlayerAvailability` - GET .../player-availability */
  getPlayerAvailability(
    sport: PathParam,
    league: PathParam,
    query?: Q<'getPlayerAvailability'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getPlayerAvailability'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/player-availability`, query, options });
  }

  /** `getPlayerAvailabilityHistory` - GET .../player-availability/history */
  getPlayerAvailabilityHistory(
    sport: PathParam,
    league: PathParam,
    query?: Q<'getPlayerAvailabilityHistory'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getPlayerAvailabilityHistory'>> {
    return this.core.request({
      method: 'GET',
      path: p`/sports/${sport}/leagues/${league}/player-availability/history`,
      query,
      options
    });
  }

  // ------------------------------------------------------------------ news & transactions

  /** `getNews` - GET /sports/{sport}/leagues/{league}/news */
  getNews(sport: PathParam, league: PathParam, query?: Q<'getNews'>, options?: RequestOptions): APIPromise<ResponseData<'getNews'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/news`, query, options });
  }

  /** `getNewsHistory` - GET .../news/history */
  getNewsHistory(
    sport: PathParam,
    league: PathParam,
    query?: Q<'getNewsHistory'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getNewsHistory'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/news/history`, query, options });
  }

  /** `getTransactions` - GET .../transactions */
  getTransactions(
    sport: PathParam,
    league: PathParam,
    query?: Q<'getTransactions'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getTransactions'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/transactions`, query, options });
  }

  // ------------------------------------------------------------------ seasons & schedule

  /** `getCurrentSeason` - GET .../season */
  getCurrentSeason(sport: PathParam, league: PathParam, options?: RequestOptions): APIPromise<ResponseData<'getCurrentSeason'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/season`, options });
  }

  /** `listSeasons` - GET .../seasons */
  listSeasons(
    sport: PathParam,
    league: PathParam,
    query?: Q<'listSeasons'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'listSeasons'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/seasons`, query, options });
  }

  /** `getSeason` - GET .../seasons/{season} */
  getSeason(sport: PathParam, league: PathParam, season: PathParam, options?: RequestOptions): APIPromise<ResponseData<'getSeason'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/seasons/${season}`, options });
  }

  /** `getSeasonSchedule` - GET .../seasons/{season}/schedule (`week` applies to NFL and college football) */
  getSeasonSchedule(
    sport: PathParam,
    league: PathParam,
    season: PathParam,
    query?: Q<'getSeasonSchedule'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getSeasonSchedule'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/seasons/${season}/schedule`, query, options });
  }

  /** `listSeasonWeeks` - GET .../seasons/{season}/weeks */
  listSeasonWeeks(
    sport: PathParam,
    league: PathParam,
    season: PathParam,
    query?: Q<'listSeasonWeeks'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'listSeasonWeeks'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/seasons/${season}/weeks`, query, options });
  }

  /** `listSeasonTypes` - GET .../seasons/{season}/types */
  listSeasonTypes(
    sport: PathParam,
    league: PathParam,
    season: PathParam,
    options?: RequestOptions
  ): APIPromise<ResponseData<'listSeasonTypes'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/seasons/${season}/types`, options });
  }

  /** `getSeasonType` - GET .../seasons/{season}/types/{typeId} */
  getSeasonType(
    sport: PathParam,
    league: PathParam,
    season: PathParam,
    typeId: PathParam,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getSeasonType'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/seasons/${season}/types/${typeId}`, options });
  }

  /** `listGroups` - GET .../seasons/{season}/types/{typeId}/groups */
  listGroups(
    sport: PathParam,
    league: PathParam,
    season: PathParam,
    typeId: PathParam,
    options?: RequestOptions
  ): APIPromise<ResponseData<'listGroups'>> {
    return this.core.request({
      method: 'GET',
      path: p`/sports/${sport}/leagues/${league}/seasons/${season}/types/${typeId}/groups`,
      options
    });
  }

  /** `getGroup` - GET .../seasons/{season}/types/{typeId}/groups/{groupId} */
  getGroup(
    sport: PathParam,
    league: PathParam,
    season: PathParam,
    typeId: PathParam,
    groupId: PathParam,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getGroup'>> {
    return this.core.request({
      method: 'GET',
      path: p`/sports/${sport}/leagues/${league}/seasons/${season}/types/${typeId}/groups/${groupId}`,
      options
    });
  }

  /** `listGroupTeams` - GET .../seasons/{season}/types/{typeId}/groups/{groupId}/teams */
  listGroupTeams(
    sport: PathParam,
    league: PathParam,
    season: PathParam,
    typeId: PathParam,
    groupId: PathParam,
    query?: Q<'listGroupTeams'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'listGroupTeams'>> {
    return this.core.request({
      method: 'GET',
      path: p`/sports/${sport}/leagues/${league}/seasons/${season}/types/${typeId}/groups/${groupId}/teams`,
      query,
      options
    });
  }

  /** `listTeamSeasonEvents` - GET .../seasons/{season}/teams/{teamId}/events */
  listTeamSeasonEvents(
    sport: PathParam,
    league: PathParam,
    season: PathParam,
    teamId: PathParam,
    query?: Q<'listTeamSeasonEvents'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'listTeamSeasonEvents'>> {
    return this.core.request({
      method: 'GET',
      path: p`/sports/${sport}/leagues/${league}/seasons/${season}/teams/${teamId}/events`,
      query,
      options
    });
  }

  /** `getTournament` - GET .../seasons/{season}/tournament */
  getTournament(
    sport: PathParam,
    league: PathParam,
    season: PathParam,
    query?: Q<'getTournament'>,
    options?: RequestOptions
  ): APIPromise<ResponseData<'getTournament'>> {
    return this.core.request({ method: 'GET', path: p`/sports/${sport}/leagues/${league}/seasons/${season}/tournament`, query, options });
  }

  // ------------------------------------------------------------------ websocket

  /** `createWebSocketToken` - POST https://www.realtimesportsapi.com/api/websocket/auth (token valid ~1 hour) */
  createWebSocketToken(options?: RequestOptions): APIPromise<ResponseData<'createWebSocketToken'>> {
    return this.core.request({ method: 'POST', path: this.core.websocketAuthUrl, options });
  }

  /**
   * Open a managed WebSocket stream: authenticates, connects, subscribes, keeps the connection
   * alive with pings, and reconnects (re-authenticating when needed) with backoff.
   * Each delivered event message counts toward your monthly quota.
   */
  stream(options: StreamOptions): StreamHandle {
    return createStream(this, options);
  }
}
