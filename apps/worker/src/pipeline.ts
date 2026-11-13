import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Suggestion, TopicOption, VideoText } from "./ai.js";
import { embeddingText } from "./ai.js";
import type { VideoDb } from "./db.js";
import type { Probe } from "./ffmpeg.js";
import { QUEUE_OPTIONS, QUEUES, type QueueName } from "./queues.js";

export interface PipelineDeps {
  db: VideoDb;
  mediaDir: string;
  send(queue: QueueName, data: { videoId: string }): Promise<unknown>;
  download(url: string, dir: string): Promise<{ filePath: string; title: string | null; hashtags: string[] }>;
  convert(input: string, output: string): Promise<void>;
  probe(file: string): Promise<Probe>;
  thumbnail(input: string, output: string, atSeconds: number): Promise<void>;
  extractAudio(input: string, output: string): Promise<void>;
  transcribe(wav: string, outBase: string): Promise<string>;
  suggest(video: VideoText, topics: TopicOption[]): Promise<Suggestion>;
  embed(text: string): Promise<number[]>;
  log?: (msg: string) => void;
}

export interface JobInfo {
  data: { videoId: string };
  retryCount: number;
}

type Step = (deps: PipelineDeps, videoId: string) => Promise<void>;

async function requireVideo(deps: PipelineDeps, id: string) {
  const video = await deps.db.get(id);
  if (!video) throw new Error(`Vídeo ${id} não existe mais.`);
  return video;
}

const steps: Record<QueueName, Step> = {
  async [QUEUES.download](deps, id) {
    const video = await requireVideo(deps, id);
    await deps.db.setStage(id, "baixando", "baixando");
    const dir = join(deps.mediaDir, id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const result = await deps.download(video.sourceUrl, dir);
    await deps.db.saveDownload(id, result.title, result.hashtags);
    await deps.send(QUEUES.convert, { videoId: id });
  },

  async [QUEUES.convert](deps, id) {
    const dir = join(deps.mediaDir, id);
    const sourceName = (await readdir(dir)).find((n) => n.startsWith("source.") && !n.endsWith(".part"));
    if (!sourceName) throw new Error("Arquivo baixado não encontrado; baixe de novo.");
    const output = join(dir, "video.mp4");
    await deps.convert(join(dir, sourceName), output);
    const info = await deps.probe(output);
    await deps.thumbnail(output, join(dir, "thumb.jpg"), Math.min(1, info.duration / 2));
    await rm(join(dir, sourceName), { force: true });
    await deps.db.saveMedia(id, `${id}/video.mp4`, `${id}/thumb.jpg`, info.duration);
    await deps.send(QUEUES.transcribe, { videoId: id });
  },

  async [QUEUES.transcribe](deps, id) {
    const dir = join(deps.mediaDir, id);
    const video = join(dir, "video.mp4");
    let transcript = "";
    if ((await deps.probe(video)).hasAudio) {
      const wav = join(dir, "audio.wav");
      await deps.extractAudio(video, wav);
      try {
        transcript = await deps.transcribe(wav, join(dir, "transcricao"));
      } finally {
        await rm(wav, { force: true });
        await rm(join(dir, "transcricao.txt"), { force: true });
      }
    }
    await deps.db.saveTranscript(id, transcript);
    await deps.send(QUEUES.suggest, { videoId: id });
  },

  async [QUEUES.suggest](deps, id) {
    const video = await requireVideo(deps, id);
    const suggestion = await deps.suggest(video, await deps.db.listTopics());
    await deps.db.saveSuggestion(id, suggestion.description, suggestion.topics);
  },

  async [QUEUES.embed](deps, id) {
    const video = await requireVideo(deps, id);
    if (video.status !== "aprovado") return; // rejeitado ou removido nesse meio-tempo
    await deps.db.saveEmbedding(id, await deps.embed(embeddingText(video)));
  },
};

/**
 * Executa uma etapa do pipeline. Na última tentativa que falhar, registra o erro no vídeo
 * (status `falhou`; no embedding, o vídeo continua aprovado e só guarda o erro).
 */
export async function runStep(queue: QueueName, deps: PipelineDeps, job: JobInfo): Promise<void> {
  const id = job.data.videoId;
  try {
    await steps[queue](deps, id);
    deps.log?.(`[worker] ${queue} ok (${id})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log?.(`[worker] ${queue} falhou (${id}, tentativa ${job.retryCount + 1}): ${message}`);
    if (job.retryCount >= QUEUE_OPTIONS.retryLimit) {
      await deps.db.fail(id, message, queue === QUEUES.embed);
    }
    throw err;
  }
}
