import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { cleanSourceDescription } from "./text.js";
import { run } from "./tools.js";

export interface DownloadResult {
  filePath: string;
  title: string | null;
  hashtags: string[];
  sourceDescription: string | null;
}

/** Vídeos acima disso (ou ao vivo) não entram no bunker. */
export const MAX_DURATION_S = 600;

export function ytDlpArgs(url: string, dir: string): string[] {
  return [
    "--no-simulate",
    "--dump-json",
    "--no-playlist",
    "--no-progress",
    "--js-runtimes",
    "node",
    "--match-filter",
    `!is_live & duration <= ${MAX_DURATION_S}`,
    "-f",
    "bv*+ba/b",
    "-S",
    "res:1080",
    "--merge-output-format",
    "mkv",
    "-o",
    join(dir, "source.%(ext)s"),
    "--",
    url,
  ];
}

interface YtDlpInfo {
  title?: string;
  description?: string;
  tags?: string[];
}

export function parseInfo(stdout: string): Omit<DownloadResult, "filePath"> {
  const line = stdout.trim().split("\n").filter(Boolean).at(-1);
  if (!line) return { title: null, hashtags: [], sourceDescription: null };
  const info = JSON.parse(line) as YtDlpInfo;
  const tags = new Set<string>();
  for (const t of info.tags ?? []) tags.add(t.toLowerCase().replace(/^#/, ""));
  for (const m of `${info.title ?? ""} ${info.description ?? ""}`.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    tags.add(m[1]!.toLowerCase());
  }
  return {
    title: info.title?.trim() || null,
    hashtags: [...tags].filter(Boolean).slice(0, 20),
    sourceDescription: cleanSourceDescription(info.description),
  };
}

export async function download(url: string, dir: string): Promise<DownloadResult> {
  const stdout = await run("yt-dlp", ytDlpArgs(url, dir));
  const file = (await readdir(dir)).find((f) => f.startsWith("source.") && !f.endsWith(".part"));
  if (!file) {
    throw new Error(`Nada foi baixado. O vídeo pode ser ao vivo, privado ou ter mais de ${MAX_DURATION_S / 60} minutos.`);
  }
  return { filePath: join(dir, file), ...parseInfo(stdout) };
}
