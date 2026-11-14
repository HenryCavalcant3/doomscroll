import { mkdir } from "node:fs/promises";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { OllamaClient } from "./ai.js";
import { readConfig } from "./config.js";
import { LlmGate, PRIORITY } from "./gate.js";
import { PgMemoryDb, PgTickDb, PgVideoDb } from "./db.js";
import * as ffmpeg from "./ffmpeg.js";
import { runStep, type JobData, type PipelineDeps } from "./pipeline.js";
import { updateMemory } from "./memory.js";
import { ensureQueues, QUEUES, VIDEO_QUEUES } from "./queues.js";
import { runTick } from "./tick.js";
import { run, toolVersion } from "./tools.js";
import { ensureModel, transcribe } from "./whisper.js";
import { download } from "./ytdlp.js";

const config = readConfig();

const [ytDlp, ffmpegVersion, whisper] = await Promise.all([
  toolVersion("yt-dlp", ["--version"]),
  toolVersion("ffmpeg", ["-version"]),
  // whisper-cli não tem --version e escreve a ajuda no stderr; basta saber se roda.
  run("whisper-cli", ["--help"], 10_000).then(
    () => "ok",
    () => null,
  ),
]);
console.log(`[worker] yt-dlp: ${ytDlp ?? "não encontrado"}`);
console.log(`[worker] ffmpeg: ${ffmpegVersion ?? "não encontrado"}`);
console.log(`[worker] whisper-cli: ${whisper ?? "não encontrado"}`);

await mkdir(config.mediaDir, { recursive: true });
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const ollama = new OllamaClient(config.ollamaUrl, config.llmModel, config.embedModel);

// Uma chamada à IA por vez, com a ingestão na frente das personas.
const gate = new LlmGate();

const boss = new PgBoss(config.databaseUrl);
boss.on("error", (err) => console.error("[worker] erro no pg-boss:", err));
await boss.start();
await ensureQueues(boss);

const deps: PipelineDeps = {
  db: new PgVideoDb(pool),
  mediaDir: config.mediaDir,
  send: (queue, data, options) => boss.send(queue, data, options),
  download,
  convert: ffmpeg.convert,
  probe: ffmpeg.probe,
  thumbnail: ffmpeg.thumbnail,
  extractAudio: ffmpeg.extractAudio,
  transcribe: async (wav, outBase) => transcribe(await ensureModel(config.whisperDir, config.whisperModel), wav, outBase),
  suggest: (video, topics) => gate.run(PRIORITY.ingest, () => ollama.suggest(video, topics)),
  embed: (text) => gate.run(PRIORITY.ingest, () => ollama.embed(text)),
  comment: (persona, video, apocalypse) => gate.run(PRIORITY.persona, () => ollama.comment(persona, video, apocalypse)),
  personaRate: config.personaRate,
  log: (msg) => console.log(msg),
};

// Um job por vez em cada fila: ffmpeg e Whisper já usam vários núcleos.
for (const queue of VIDEO_QUEUES) {
  await boss.work<JobData>(queue, { batchSize: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
    if (job) await runStep(queue, deps, job);
  });
}
const memoryDb = new PgMemoryDb(pool);
await boss.work<{ personaId: string; contactId: string }>(QUEUES.personaMemory, { batchSize: 1, pollingIntervalSeconds: 5 }, async ([job]) => {
  if (!job) return;
  await updateMemory(
    {
      db: memoryDb,
      summarize: (name, contact, summary, lines) => gate.run(PRIORITY.persona, () => ollama.memory(name, contact, summary, lines)),
      log: (msg) => console.log(msg),
    },
    job.data,
  );
});
// Agendador das personas: o tique só decide; as falas são escritas pela api (fila persona.talk).
const tickDb = new PgTickDb(pool);
await boss.work(QUEUES.personaTick, { batchSize: 1, pollingIntervalSeconds: 5 }, async ([job]) => {
  if (!job) return;
  await runTick({ db: tickDb, send: (queue, data) => boss.send(queue, data), personaRate: config.personaRate, log: (msg) => console.log(msg) });
});
if (config.personaTick) {
  await boss.schedule(QUEUES.personaTick, config.personaTick);
  console.log(`[worker] agendador das personas: ${config.personaTick}`);
} else {
  await boss.unschedule(QUEUES.personaTick);
  console.log("[worker] agendador das personas desligado (PERSONA_TICK=off)");
}
console.log(`[worker] ouvindo as filas: ${Object.values(QUEUES).join(", ")}`);

const shutdown = async () => {
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
