import { mkdir } from "node:fs/promises";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { OllamaClient } from "./ai.js";
import { readConfig } from "./config.js";
import { PgVideoDb } from "./db.js";
import * as ffmpeg from "./ffmpeg.js";
import { runStep, type PipelineDeps } from "./pipeline.js";
import { ensureQueues, QUEUES } from "./queues.js";
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

const boss = new PgBoss(config.databaseUrl);
boss.on("error", (err) => console.error("[worker] erro no pg-boss:", err));
await boss.start();
await ensureQueues(boss);

const deps: PipelineDeps = {
  db: new PgVideoDb(pool),
  mediaDir: config.mediaDir,
  send: (queue, data) => boss.send(queue, data),
  download,
  convert: ffmpeg.convert,
  probe: ffmpeg.probe,
  thumbnail: ffmpeg.thumbnail,
  extractAudio: ffmpeg.extractAudio,
  transcribe: async (wav, outBase) => transcribe(await ensureModel(config.whisperDir, config.whisperModel), wav, outBase),
  suggest: (video, topics) => ollama.suggest(video, topics),
  embed: (text) => ollama.embed(text),
  log: (msg) => console.log(msg),
};

// Um job por vez em cada fila: ffmpeg e Whisper já usam vários núcleos.
for (const queue of Object.values(QUEUES)) {
  await boss.work<{ videoId: string }>(queue, { batchSize: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
    if (job) await runStep(queue, deps, job);
  });
}
console.log(`[worker] ouvindo as filas: ${Object.values(QUEUES).join(", ")}`);

const shutdown = async () => {
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
