/**
 * A tiny, dependency-free validation toolkit for data crossing the wire from an
 * untrusted device (a phone or a director's browser) into the server. Deliberately
 * not a schema library: every DTO in dto.ts has one hand-written `parseX` function
 * built from these primitives, so the accepted shape is always explicit and easy
 * to audit — the same philosophy as validateMovement in @bridge/movement, which
 * reports every violation rather than stopping at the first.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
export const err = (...errors: string[]): Result<never> => ({ ok: false, errors });

/** Run several field-level checks against an unknown object; collect every error. */
export function collect(errors: (string | null)[]): string[] {
  return errors.filter((e): e is string => e !== null);
}

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function field(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}

export function checkString(x: unknown, name: string, opts: { minLen?: number; maxLen?: number } = {}): string | null {
  if (typeof x !== "string") return `${name} must be a string`;
  if (opts.minLen !== undefined && x.length < opts.minLen) return `${name} must be at least ${opts.minLen} characters`;
  if (opts.maxLen !== undefined && x.length > opts.maxLen) return `${name} must be at most ${opts.maxLen} characters`;
  return null;
}

export function checkNonEmptyString(x: unknown, name: string, maxLen = 200): string | null {
  return checkString(x, name, { minLen: 1, maxLen });
}

export function checkInt(x: unknown, name: string, opts: { min?: number; max?: number } = {}): string | null {
  if (typeof x !== "number" || !Number.isInteger(x)) return `${name} must be an integer`;
  if (opts.min !== undefined && x < opts.min) return `${name} must be >= ${opts.min}`;
  if (opts.max !== undefined && x > opts.max) return `${name} must be <= ${opts.max}`;
  return null;
}

export function checkEnum<T extends string>(x: unknown, name: string, allowed: readonly T[]): string | null {
  return typeof x === "string" && (allowed as readonly string[]).includes(x) ? null : `${name} must be one of: ${allowed.join(", ")}`;
}

export function checkBool(x: unknown, name: string): string | null {
  return typeof x === "boolean" ? null : `${name} must be a boolean`;
}

export function isEnum<T extends string>(x: unknown, allowed: readonly T[]): x is T {
  return typeof x === "string" && (allowed as readonly string[]).includes(x);
}
