/**
 * Thin wrapper around node:sqlite so the rest of the server depends on this
 * module's shape, not on a specific driver. node:sqlite (Node >= 22.5) is used
 * here because it needs no network install in this environment; its synchronous
 * API (prepare().run()/get()/all()) is close enough to better-sqlite3's that
 * swapping drivers later should only touch this file.
 */
import { DatabaseSync } from "node:sqlite";

export type Row = Record<string, unknown>;

export class Db {
  readonly raw: DatabaseSync;

  constructor(path = ":memory:") {
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA foreign_keys = ON;");
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  run(sql: string, params: unknown[] = []): { lastInsertRowid: number | bigint; changes: number | bigint } {
    return this.raw.prepare(sql).run(...(params as never[]));
  }

  get<T = Row>(sql: string, params: unknown[] = []): T | undefined {
    return this.raw.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  all<T = Row>(sql: string, params: unknown[] = []): T[] {
    return this.raw.prepare(sql).all(...(params as never[])) as T[];
  }

  /** Run `fn` inside a transaction; rolls back if it throws. */
  transaction<T>(fn: () => T): T {
    this.raw.exec("BEGIN");
    try {
      const result = fn();
      this.raw.exec("COMMIT");
      return result;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }

  close(): void {
    this.raw.close();
  }
}
