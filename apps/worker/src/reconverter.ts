/**
 * Reconverte os vídeos do acervo que passam do teto de taxa (VIDEO_MAXRATE), convertidos antes dele.
 * O arquivo novo ganha outro nome (video-leve.mp4) e o banco passa a apontar para ele: /media é
 * servido com cache imutável, então um endereço nunca troca de conteúdo. Depois o antigo é apagado.
 *
 * Uso (dentro do container do worker, que tem o ffmpeg e o volume dos vídeos):
 *   docker compose exec worker node dist/reconverter.js             # só lista
 *   docker compose exec worker node dist/reconverter.js --aplicar   # reconverte
 */
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
import { readConfig } from "./config.js";
import { convert, probe } from "./ffmpeg.js";

/** Acima disto (vídeo + 128 kb/s de áudio, com folga) o vídeo foi convertido sem o teto. */
const LIMIT_MBPS = 2.3;
const NEW_NAME = "video-leve.mp4";

const { values: args } = parseArgs({ options: { aplicar: { type: "boolean", default: false } } });
const config = readConfig(process.env);
const pool = new pg.Pool({ connectionString: config.databaseUrl });

try {
  const { rows } = await pool.query<{ id: string; file_path: string; duration: number }>(
    // Só os já processados: as etapas do pipeline leem o video.mp4 pelo nome.
    "SELECT id, file_path, duration FROM videos WHERE file_path IS NOT NULL AND duration > 0 AND stage = 'concluido'",
  );
  const heavy: { id: string; filePath: string; mbps: number; mb: number }[] = [];
  for (const r of rows) {
    const size = await stat(join(config.mediaDir, r.file_path)).then((s) => s.size, () => 0);
    const mbps = (size * 8) / r.duration / 1e6;
    if (mbps > LIMIT_MBPS) heavy.push({ id: r.id, filePath: r.file_path, mbps, mb: size / 1e6 });
  }
  heavy.sort((a, b) => b.mbps - a.mbps);
  console.log(`${heavy.length} de ${rows.length} vídeos acima de ${LIMIT_MBPS} Mbps.`);

  let before = 0;
  let after = 0;
  for (const v of heavy) {
    const label = `${v.id.slice(0, 8)}  ${v.mbps.toFixed(2)} Mbps  ${v.mb.toFixed(1)} MB`;
    if (!args.aplicar) {
      console.log(label);
      continue;
    }
    const input = join(config.mediaDir, v.filePath);
    const newPath = `${v.id}/${NEW_NAME}`;
    const output = join(config.mediaDir, newPath);
    if (newPath === v.filePath) {
      console.log(`${label}  já reconvertido, fica como está`);
      continue;
    }
    const started = Date.now();
    await convert(input, output);
    const info = await probe(output);
    const size = (await stat(output)).size;
    // Confere o resultado antes de trocar: mesmo tamanho de vídeo, com no máximo 1 s de diferença.
    const durationRow = await pool.query<{ duration: number }>("SELECT duration FROM videos WHERE id = $1", [v.id]);
    if (Math.abs(info.duration - durationRow.rows[0]!.duration) > 1) {
      await rm(output, { force: true });
      console.log(`${label}  duração mudou (${info.duration.toFixed(1)} s), mantido o original`);
      continue;
    }
    await pool.query("UPDATE videos SET file_path = $2, updated_at = now() WHERE id = $1", [v.id, newPath]);
    await rm(input, { force: true });
    before += v.mb;
    after += size / 1e6;
    const mbps = (size * 8) / info.duration / 1e6;
    console.log(`${label}  ->  ${mbps.toFixed(2)} Mbps  ${(size / 1e6).toFixed(1)} MB  (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }
  if (args.aplicar && heavy.length) console.log(`Total: ${before.toFixed(0)} MB -> ${after.toFixed(0)} MB.`);
  if (!args.aplicar && heavy.length) console.log("Nada foi mudado. Rode com --aplicar para reconverter.");
} finally {
  await pool.end();
}
