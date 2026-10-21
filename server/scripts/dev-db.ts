// Local PostgreSQL for development without Docker (embedded-postgres: real Postgres binaries from npm).
//   npm run db:dev    then DATABASE_URL=postgres://postgres:music@127.0.0.1:5434/postgres
// Data lives in server/data/postgres. Not for production.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const port = Number(process.env.DEV_DB_PORT ?? 5434);
const databaseDir = fileURLToPath(new URL("../data/postgres", import.meta.url));

const pg = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "music",
  port,
  persistent: true,
  onLog: () => {},
});

if (!existsSync(databaseDir)) await pg.initialise();
await pg.start();
console.log(`Dev Postgres on postgres://postgres:music@127.0.0.1:${port}/postgres`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
