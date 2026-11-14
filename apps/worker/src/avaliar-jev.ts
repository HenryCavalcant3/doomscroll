/**
 * Bancada do JEV: simula as decisões de cada persona sobre os vídeos aprovados (sem a IA e sem
 * gravar nada) e mostra quanto cada uma comentaria, curtiria e ignoraria. Serve para calibrar os
 * pesos e limiares de jev.ts.
 *
 * Uso (com o banco acessível):
 *   DATABASE_URL=... pnpm --filter @doomscroll/worker avaliar:jev -- [--rodadas 200]
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { JEV, decideVideo, type PersonaTaste, type VideoAction } from "./jev.js";

const { values: args } = parseArgs({
  options: {
    rodadas: { type: "string", default: "200" },
    personas: { type: "string", default: fileURLToPath(new URL("../../../personas", import.meta.url)) },
  },
});

interface Persona extends PersonaTaste {
  name: string;
}

async function loadPersonas(dir: string): Promise<Persona[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const list: Persona[] = [];
  for (const f of files) {
    const p = JSON.parse(await readFile(join(dir, f), "utf8"));
    list.push({ name: p.nome, activity: p.atividade, affinity: p.afinidade });
  }
  return list;
}

async function loadVideos(): Promise<{ title: string; topics: string[] }[]> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const res = await pool.query<{ title: string | null; topics: string[] }>(
      `SELECT v.title, COALESCE(array_agg(t.slug) FILTER (WHERE t.id IS NOT NULL), '{}') AS topics
         FROM videos v LEFT JOIN video_topics vt ON vt.video_id = v.id LEFT JOIN topics t ON t.id = vt.topic_id
        WHERE v.status = 'aprovado' GROUP BY v.id`,
    );
    return res.rows.map((r) => ({ title: r.title ?? "(sem título)", topics: r.topics }));
  } finally {
    await pool.end();
  }
}

const pct = (n: number, d: number) => `${Math.round((100 * n) / d)}%`;

const personas = await loadPersonas(args.personas);
const videos = await loadVideos();
const rounds = Number(args.rodadas);
const count = new Map<string, Record<VideoAction, number>>(personas.map((p) => [p.name, { ignorar: 0, curtir: 0, comentar: 0 }]));
const perVideo = { comentar: [] as number[], curtir: [] as number[] };

for (let r = 0; r < rounds; r++) {
  for (const video of videos) {
    let comments = 0;
    let likes = 0;
    for (const p of personas) {
      const { action } = decideVideo(p, { topics: video.topics, recentWithAuthor: 0 });
      count.get(p.name)![action]++;
      if (action === "comentar") comments++;
      if (action !== "ignorar") likes++;
    }
    perVideo.comentar.push(comments);
    perVideo.curtir.push(likes);
  }
}

const total = rounds * videos.length;
console.log(`${videos.length} vídeos, ${rounds} rodadas. Limiares: curtir ≥ ${JEV.likeAt}, comentar ≥ ${JEV.commentAt}.\n`);
console.log("| Persona | Atividade | Comenta | Só curte | Ignora |");
console.log("|---|---|---|---|---|");
for (const p of personas) {
  const c = count.get(p.name)!;
  console.log(`| ${p.name} | ${p.activity} | ${pct(c.comentar, total)} | ${pct(c.curtir, total)} | ${pct(c.ignorar, total)} |`);
}
const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
const hist = (xs: number[]) =>
  Array.from({ length: personas.length + 1 }, (_, n) => `${n}: ${pct(xs.filter((x) => x === n).length, xs.length)}`).join(", ");
console.log(`\nPor vídeo: ${mean(perVideo.comentar)} personas comentam (${hist(perVideo.comentar)})`);
console.log(`Por vídeo: ${mean(perVideo.curtir)} personas curtem (comentar também curte)`);
