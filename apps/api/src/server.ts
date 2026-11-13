import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
import { migrate } from "./migrate.js";
import { ensureOwner } from "./owner.js";
import { ensureQueues } from "./queues.js";
import { PgStore } from "./store.js";

const config = readConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl });

// A api só começa a escutar (e o healthcheck só passa) depois das migrações.
const applied = await migrate(pool, fileURLToPath(new URL("../migrations", import.meta.url)));
if (applied.length) console.log(`[api] migrações aplicadas: ${applied.join(", ")}`);
await ensureOwner(pool, config.ownerPin, (msg) => console.log(`[api] ${msg}`));
await mkdir(config.mediaDir, { recursive: true });

const boss = new PgBoss(config.databaseUrl);
boss.on("error", (err) => console.error("[api] erro no pg-boss:", err));
await boss.start();
await ensureQueues(boss);

const app = buildApp({ config, store: new PgStore(pool), queue: boss, logger: true, serveMedia: true });

const shutdown = async () => {
  await app.close();
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: config.host });
