import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PersonaProfile, Suggestion, TopicOption, VideoForComment, VideoText } from "./ai.js";
import { embeddingText } from "./ai.js";
import type { VideoDb } from "./db.js";
import type { Probe } from "./ffmpeg.js";
import { cleanTranscript } from "./text.js";
import type { DownloadResult } from "./ytdlp.js";
import { QUEUE_OPTIONS, QUEUES, type QueueName } from "./queues.js";

export interface PipelineDeps {
  db: VideoDb;
  mediaDir: string;
  send(queue: QueueName, data: { videoId: string }, options?: { startAfter: number }): Promise<unknown>;
  download(url: string, dir: string): Promise<DownloadResult>;
  convert(input: string, output: string): Promise<void>;
  probe(file: string): Promise<Probe>;
  thumbnail(input: string, output: string, atSeconds: number): Promise<void>;
  extractAudio(input: string, output: string): Promise<void>;
  transcribe(wav: string, outBase: string): Promise<string>;
  suggest(video: VideoText, topics: TopicOption[]): Promise<Suggestion>;
  embed(text: string): Promise<number[]>;
  comment(persona: PersonaProfile, video: VideoForComment, apocalypse: boolean): Promise<string>;
  /** Limite de ações de persona por hora (PERSONA_RATE); sem valor, não há limite. */
  personaRate?: number;
  /** Sorteio (0 a 1); substituível nos testes. */
  random?: () => number;
  log?: (msg: string) => void;
}

/** Chance de o comentário brincar com o fim do mundo (SPEC 7.3: só uma parte pequena das falas). */
export const APOCALYPSE_CHANCE = 0.15;

/** Quando o limite por hora estoura, o comentário volta para a fila depois deste tempo. */
export const RATE_RETRY_SECONDS = 600;

/** Filas que rodam depois da aprovação: uma falha nelas não tira o vídeo do feed. */
const AFTER_APPROVAL: ReadonlySet<QueueName> = new Set([QUEUES.embed, QUEUES.personaComment]);

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
    await deps.db.saveDownload(id, result.title, result.hashtags, result.sourceDescription);
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
        // Só marcações de música ou frase inventada repetida contam como "sem fala".
        transcript = cleanTranscript(await deps.transcribe(wav, join(dir, "transcricao")));
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

  async [QUEUES.personaComment](deps, id) {
    const video = await deps.db.videoForComment(id);
    if (video?.status !== "aprovado") return;
    const random = deps.random ?? Math.random;
    // Só personas que ainda não comentaram: nova tentativa ou job repetido não duplica comentário.
    for (const persona of await deps.db.personasWithoutComment(id)) {
      const limit = deps.personaRate ?? Infinity;
      if (limit <= 0) {
        deps.log?.(`[worker] PERSONA_RATE=0: personas não comentam (${id})`);
        return;
      }
      // Sem lançar erro: falha gastaria as tentativas e o comentário só voltaria na próxima subida.
      if ((await deps.db.personaActionsLastHour()) >= limit) {
        await deps.send(QUEUES.personaComment, { videoId: id }, { startAfter: RATE_RETRY_SECONDS });
        deps.log?.(`[worker] limite de ${limit} ações de persona por hora: comentário adiado (${id})`);
        return;
      }
      const text = await deps.comment(persona, video, random() < APOCALYPSE_CHANCE);
      await deps.db.addPersonaComment(id, persona.userId, text);
      deps.log?.(`[worker] ${persona.nickname} comentou (${id}): ${text}`);
    }
  },
};

/**
 * Executa uma etapa do pipeline. Na última tentativa que falhar, registra o erro no vídeo
 * (status `falhou` e arquivos apagados). Depois da aprovação o vídeo continua no feed: o embedding só
 * guarda o erro e o comentário da persona apenas registra no log.
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
      if (queue === QUEUES.personaComment) {
        // Sem comentário o vídeo continua no feed; a api tenta de novo na próxima subida.
      } else if (AFTER_APPROVAL.has(queue)) {
        await deps.db.fail(id, message, true);
      } else {
        await deps.db.fail(id, message, false);
        // Vídeo que falhou não vai para o feed: não deixa arquivos ocupando espaço.
        await rm(join(deps.mediaDir, id), { recursive: true, force: true });
      }
    }
    throw err;
  }
}
