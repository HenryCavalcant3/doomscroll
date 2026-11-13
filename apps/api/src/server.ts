import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
import { removeVideoMedia, sweepMedia } from "./media.js";
import { migrate } from "./migrate.js";
import { ensureOwner } from "./owner.js";
import { loadPersonas, syncPersonas } from "./personas.js";
import { ensureQueues, QUEUES } from "./queues.js";
import { PgStore } from "./store.js";
import { PgChatStore } from "./chat.js";
import { chatStream } from "./ollama.js";
import { CHAT_OPTIONS, PersonaReplier, PgPersonaChatStore } from "./personaChat.js";
import { Hub } from "./realtime.js";

const config = readConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl });

// A api só começa a escutar (e o healthcheck só passa) depois das migrações.
const applied = await migrate(pool, fileURLToPath(new URL("../migrations", import.meta.url)));
if (applied.length) console.log(`[api] migrações aplicadas: ${applied.join(", ")}`);
await ensureOwner(pool, config.ownerPin, (msg) => console.log(`[api] ${msg}`));
const personas = await loadPersonas(config.personasDir);
await syncPersonas(pool, personas, (msg) => console.log(`[api] ${msg}`));
console.log(`[api] personas: ${personas.map((p) => p.apelido).join(", ") || "nenhuma"}`);
await mkdir(config.mediaDir, { recursive: true });
const store = new PgStore(pool);
const chat = new PgChatStore(pool);
await chat.ensureBunker();
const swept = await sweepMedia(config.mediaDir, (ids) => store.statusOf(ids));
if (swept.length) console.log(`[api] arquivos de ${swept.length} vídeo(s) rejeitado(s) ou com falha apagados`);

const boss = new PgBoss(config.databaseUrl);
boss.on("error", (err) => console.error("[api] erro no pg-boss:", err));
await boss.start();
await ensureQueues(boss);

// Vídeos aprovados cujo comentário falhou (nenhuma persona comentou) ganham comentário agora.
const missing = await store.videosMissingPersonaComments();
for (const videoId of missing) await boss.send(QUEUES.personaComment, { videoId });
if (missing.length) console.log(`[api] comentários de persona enfileirados para ${missing.length} vídeo(s)`);

const hub = new Hub();
const personaStore = new PgPersonaChatStore(pool);
const replier = new PersonaReplier({
  chat,
  personas: personaStore,
  hub,
  queue: boss,
  // O stop impede o modelo de escrever a fala do outro lado.
  generate: (messages, stop, onText, signal) =>
    chatStream(
      {
        baseUrl: config.ollamaUrl,
        model: config.llmModel,
        messages,
        options: { ...CHAT_OPTIONS, stop },
        timeoutMs: config.llmTimeoutMs,
        signal,
      },
      onText,
    ),
  log: (msg) => console.log(`[api] ${msg}`),
});

const app = buildApp({
  config,
  store,
  chat,
  hub,
  replier,
  personas: personaStore,
  queue: boss,
  logger: true,
  serveMedia: true,
  removeMedia: (id) => removeVideoMedia(config.mediaDir, id),
});

const shutdown = async () => {
  await app.close();
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: config.host });
