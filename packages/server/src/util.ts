import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

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

/** 6-digit director PIN (design doc 3.2: level-1 authority, kept separate from the table-facing event code). */
export function newDirectorPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

const SCRYPT_KEYLEN = 32;

/** Salts + hashes a PIN (scrypt) for storage; never store the plaintext PIN. */
export function hashPin(pin: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, SCRYPT_KEYLEN).toString("hex");
  return { hash, salt };
}

/** Constant-time comparison against a stored hash+salt pair. */
export function verifyPin(pin: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(pin, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
