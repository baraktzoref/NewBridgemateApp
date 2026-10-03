import { ServerError } from "../../server/src/domain/resultService.ts";
import { DeviceError } from "../../server/src/domain/deviceService.ts";

/**
 * Maps a domain error's `code` to an HTTP status. Kept as one table rather than
 * scattered try/catch blocks per route, so adding a new error code anywhere in
 * @bridge/server only requires one new line here.
 */
const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  BAD_EVENT_CODE: 401,
  ALREADY_ACTIVE: 409,
  NO_ACTIVE_DEVICE: 409,
  CONFLICT: 409,
  LOCKED: 423,
  ALREADY_CONFIRMED: 409,
  VALIDATION: 400,
};

export function statusForError(err: unknown): { status: number; message: string; code: string | null } {
  if (err instanceof ServerError || err instanceof DeviceError) {
    return { status: STATUS_BY_CODE[err.code] ?? 500, message: err.message, code: err.code };
  }
  if (err instanceof RangeError) return { status: 400, message: err.message, code: null };
  if (err instanceof Error) return { status: 500, message: err.message, code: null };
  return { status: 500, message: "unknown error", code: null };
}
