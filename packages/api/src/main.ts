/**
 * Runs the server standalone: `node --experimental-strip-types --experimental-sqlite src/main.ts`.
 * DB_PATH and PORT are read from the environment so this can point at a real
 * file (the club's event database) instead of the in-memory default used by tests.
 */
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 8080);
const dbPath = process.env.DB_PATH ?? "./bridge.sqlite";

const { server } = createApp(dbPath);
server.listen(port, () => {
  console.log(`bridge server listening on http://0.0.0.0:${port} (db: ${dbPath})`);
});
