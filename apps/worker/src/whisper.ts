import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { run } from "./tools.js";

export const modelUrl = (model: string) =>
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;

/**
 * Garante o modelo do Whisper no volume. Ele é baixado na primeira transcrição,
 * que sempre acontece com internet (o cadastro de vídeo já exige internet).
 */
export async function ensureModel(dir: string, model: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const file = join(dir, `ggml-${model}.bin`);
  try {
    await access(file);
    return file;
  } catch {
    // ainda não baixado
  }
  await mkdir(dir, { recursive: true });
  console.log(`[worker] baixando o modelo do Whisper (${model})...`);
  const res = await fetchImpl(modelUrl(model));
  if (!res.ok || !res.body) throw new Error(`Não foi possível baixar o modelo do Whisper (${res.status}).`);
  const tmp = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(tmp));
  await rename(tmp, file);
  console.log(`[worker] modelo do Whisper pronto em ${file}`);
  return file;
}

export function whisperArgs(modelFile: string, wav: string, outBase: string): string[] {
  return [
    "-m",
    modelFile,
    "-f",
    wav,
    "-l",
    "auto",
    "-t",
    String(Math.max(1, Math.min(8, availableParallelism()))),
    "-np",
    "-otxt",
    "-of",
    outBase,
  ];
}

export async function transcribe(modelFile: string, wav: string, outBase: string): Promise<string> {
  await run("whisper-cli", whisperArgs(modelFile, wav, outBase), 30 * 60_000);
  const text = await readFile(`${outBase}.txt`, "utf8");
  return text.replace(/\s+/g, " ").trim();
}
