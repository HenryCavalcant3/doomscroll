import { run } from "./tools.js";

const BASE = ["-y", "-hide_banner", "-loglevel", "error"];

/** MP4 H.264/AAC pronto para streaming; vertical até 720 de largura, horizontal até 1280. */
export function convertArgs(input: string, output: string): string[] {
  return [
    ...BASE,
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    "scale=w='if(gt(iw,ih),min(1280,iw),min(720,iw))':h=-2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    output,
  ];
}

export function thumbnailArgs(input: string, output: string, atSeconds: number): string[] {
  return [...BASE, "-ss", atSeconds.toFixed(2), "-i", input, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", output];
}

/** Áudio no formato que o whisper.cpp espera: WAV 16 kHz mono. */
export function audioArgs(input: string, output: string): string[] {
  return [...BASE, "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output];
}

export interface Probe {
  duration: number;
  hasAudio: boolean;
}

export function parseProbe(stdout: string): Probe {
  const data = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
  return {
    duration: Number(data.format?.duration ?? 0) || 0,
    hasAudio: (data.streams ?? []).some((s) => s.codec_type === "audio"),
  };
}

export async function probe(file: string): Promise<Probe> {
  const out = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type",
    "-of",
    "json",
    file,
  ]);
  return parseProbe(out);
}

export const convert = (input: string, output: string) => run("ffmpeg", convertArgs(input, output)).then(() => {});
export const thumbnail = (input: string, output: string, at: number) =>
  run("ffmpeg", thumbnailArgs(input, output, at)).then(() => {});
export const extractAudio = (input: string, output: string) => run("ffmpeg", audioArgs(input, output)).then(() => {});
