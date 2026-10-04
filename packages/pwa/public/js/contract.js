// Client-side mirror of @bridge/shared's CONTRACT_TEXT_RE, for instant UI feedback.
// The server is still the final authority — this only avoids a round trip for an
// obviously malformed contract (e.g. "9S" or "4W").
export const CONTRACT_TEXT_RE = /^[1-7](C|D|H|S|NT|N)(X|XX)?$/i;

export const SEATS = ["N", "E", "S", "W"];

/** @param {string} text */
export function isValidContractText(text) {
  return typeof text === "string" && CONTRACT_TEXT_RE.test(text.trim());
}

/** Normalizes to the server's expected casing/shape ("3nt" -> "3NT", "4sx" -> "4SX"). */
export function normalizeContractText(text) {
  return String(text).trim().toUpperCase().replace(/^N$/i, "N");
}

/** @param {string} declarer @param {number} tricks */
export function isValidDeclarerAndTricks(declarer, tricks) {
  return SEATS.includes(declarer) && Number.isInteger(tricks) && tricks >= 0 && tricks <= 13;
}
