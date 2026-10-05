/**
 * Friendly type aliases derived from the generated OpenAPI types in `schema.d.ts`.
 * Regenerate `schema.d.ts` with `npm run generate`; these aliases follow automatically.
 */
import type { components, operations } from './schema';

export type { components, operations, paths } from './schema';

type Schemas = components['schemas'];

export type ApiErrorBody = Schemas['Error'];
export type RateLimit = Schemas['RateLimit'];
export type Pagination = Schemas['Pagination'];
export type Sport = Schemas['Sport'];
export type League = Schemas['League'];
export type LeagueDetail = Schemas['LeagueDetail'];
export type EventTeam = Schemas['EventTeam'];
export type EventStatus = Schemas['EventStatus'];
export type Event = Schemas['Event'];
export type PlayAthlete = Schemas['PlayAthlete'];
export type Play = Schemas['Play'];
export type Odds = Schemas['Odds'];
export type OddsHistoryEntry = Schemas['OddsHistoryEntry'];
export type BoxScore = Schemas['BoxScore'];
export type WinProbability = Schemas['WinProbability'];
export type GameRoster = Schemas['GameRoster'];
export type Team = Schemas['Team'];
export type RosterAthlete = Schemas['RosterAthlete'];
export type Roster = Schemas['Roster'];
export type DepthChart = Schemas['DepthChart'];
export type Athlete = Schemas['Athlete'];
export type AthleteSearchResult = Schemas['AthleteSearchResult'];
export type GameLogEntry = Schemas['GameLogEntry'];
export type AvailabilityState = Schemas['AvailabilityState'];
export type AvailabilityTransition = Schemas['AvailabilityTransition'];
export type Injury = Schemas['Injury'];
export type InjuryReport = Schemas['InjuryReport'];
export type PlayerAvailability = Schemas['PlayerAvailability'];
export type PlayerAvailabilityReport = Schemas['PlayerAvailabilityReport'];
export type NewsArticle = Schemas['NewsArticle'];
export type Transactions = Schemas['Transactions'];
export type Season = Schemas['Season'];
export type SeasonSummary = Schemas['SeasonSummary'];
export type SeasonType = Schemas['SeasonType'];
export type Group = Schemas['Group'];
export type Week = Schemas['Week'];
export type TournamentGame = Schemas['TournamentGame'];
export type Webhook = Schemas['Webhook'];
export type WebhookEventType = Schemas['WebhookEventType'];
export type WebhookFrequency = Schemas['WebhookFrequency'];
export type WebhookInput = Schemas['WebhookInput'];
export type WebhookDelivery = Schemas['WebhookDelivery'];

export type OperationId = keyof operations;

type JsonOf<R> = R extends { content: { 'application/json': infer J } } ? J : never;

/** JSON body of an operation's success (200/201) response. */
export type SuccessBody<Op extends OperationId> = operations[Op]['responses'] extends infer R
  ? 200 extends keyof R
    ? JsonOf<R[200]>
    : 201 extends keyof R
      ? JsonOf<R[201]>
      : never
  : never;

/** The `data` field of an operation's success envelope. */
export type ResponseData<Op extends OperationId> = SuccessBody<Op> extends { data: infer D } ? D : never;

/** Query parameters accepted by an operation. */
export type QueryParams<Op extends OperationId> = operations[Op]['parameters'] extends { query?: infer Q }
  ? NonNullable<Q>
  : never;

/** JSON request body of an operation. */
export type RequestBody<Op extends OperationId> = operations[Op] extends {
  requestBody?: { content: { 'application/json': infer B } };
}
  ? B
  : never;

/** `meta` block present on most success envelopes. */
export interface ResponseMeta {
  rateLimit?: RateLimit;
  pagination?: Pagination;
  [key: string]: unknown;
}

/** Full response returned by `.withMeta()`. */
export interface APIResponse<T> {
  data: T;
  meta: ResponseMeta | undefined;
  status: number;
  headers: Headers;
}

/** A path segment: sport/league slugs, ids and season years. */
export type PathParam = string | number;
