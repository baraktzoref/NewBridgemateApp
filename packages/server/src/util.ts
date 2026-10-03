import { randomBytes, randomInt } from "node:crypto";

export function newId(): string {
  return randomBytes(16).toString("hex");
}

/** 128-bit table QR token (see design doc section 6: printed/laminated, must not be guessable). */
export function newTableToken(): string {
  return randomBytes(16).toString("hex");
}

/** 4-digit event code shown on the director's screen (design doc section 3.1). */
export function newEventCode(): string {
  return String(randomInt(0, 10000)).padStart(4, "0");
}

export function now(): string {
  return new Date().toISOString();
}
