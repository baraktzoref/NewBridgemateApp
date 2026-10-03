/**
 * Branded string types for the identifiers that cross the wire between the server,
 * the table PWA and the director app. Branding is compile-time only (no runtime
 * cost) — it exists so a TableToken can never be passed where a DeviceToken is
 * expected, even though both are plain strings underneath.
 *
 * Numeric domain values (round, table, pair, board numbers) are intentionally left
 * as plain `number`, matching the convention already used in @bridge/movement and
 * @bridge/scoring — there is no risk of confusing a round with a board the way
 * there is with two opaque tokens.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** UUID identifying an Event (a single tournament session) server-side. */
export type EventId = Brand<string, "EventId">;

/** The QR token printed/laminated at a physical table. Fixed for the table's lifetime. */
export type TableToken = Brand<string, "TableToken">;

/** Issued to a phone when it connects to a table; identifies that browser session. */
export type DeviceToken = Brand<string, "DeviceToken">;

/** Issued to a director on login; carries level-1 (director) authority. */
export type DirectorToken = Brand<string, "DirectorToken">;

/** Club membership number, entered once in round 1 to identify a player. */
export type MemberId = Brand<string, "MemberId">;

/** Server-assigned id of a persisted Result row. */
export type ResultId = Brand<string, "ResultId">;

/**
 * Client-generated idempotency key (UUID) attached to every write.
 * The server must treat two submissions with the same key as one write, so a
 * retried offline-queue entry or a double-tap never creates a duplicate result.
 */
export type ClientEventId = Brand<string, "ClientEventId">;

const brand = <B extends string>(value: string): Brand<string, B> => value as Brand<string, B>;

export const asEventId = (v: string): EventId => brand(v);
export const asTableToken = (v: string): TableToken => brand(v);
export const asDeviceToken = (v: string): DeviceToken => brand(v);
export const asDirectorToken = (v: string): DirectorToken => brand(v);
export const asMemberId = (v: string): MemberId => brand(v);
export const asResultId = (v: string): ResultId => brand(v);
export const asClientEventId = (v: string): ClientEventId => brand(v);
