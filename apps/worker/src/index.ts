import { PgBoss } from "pg-boss";
import { readConfig } from "./config.js";
import { toolVersion } from "./tools.js";

const config = readConfig();

const [ytDlp, ffmpeg] = await Promise.all([
  toolVersion("yt-dlp", ["--version"]),
  toolVersion("ffmpeg", ["-version"]),
]);
console.log(`[worker] yt-dlp: ${ytDlp ?? "não encontrado"}`);
console.log(`[worker] ffmpeg: ${ffmpeg ?? "não encontrado"}`);

const boss = new PgBoss(config.databaseUrl);
boss.on("error", (err) => console.error("[worker] erro no pg-boss:", err));
await boss.start();
console.log("[worker] fila pg-boss pronta. Nenhum job registrado ainda (passo 1 do SPEC).");

const shutdown = async () => {
  await boss.stop({ graceful: true });
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
