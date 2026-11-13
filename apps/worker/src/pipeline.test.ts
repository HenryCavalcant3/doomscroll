import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoDb, VideoRecord } from "./db.js";
import { runStep, type PipelineDeps } from "./pipeline.js";
import { QUEUES } from "./queues.js";

const ID = "11111111-1111-4111-8111-111111111111";

function fakeDb(): VideoDb & { video: VideoRecord & { stage: string; error?: string; embedding?: number[] }; topics: string[] } {
  const video = {
    id: ID, sourceUrl: "https://youtu.be/x", status: "baixando", stage: "baixando", title: null as string | null,
    hashtags: [] as string[], description: null as string | null, transcript: null as string | null, filePath: null as string | null,
  };
  const db = {
    video: video as typeof video & { error?: string; embedding?: number[] },
    topics: [] as string[],
    get: async () => ({ ...video }),
    setStage: async (_: string, status: string, stage: string) => Object.assign(video, { status, stage }),
    saveDownload: async (_: string, title: string | null, hashtags: string[]) =>
      Object.assign(video, { title, hashtags, status: "processando", stage: "convertendo" }),
    saveMedia: async (_: string, filePath: string) => Object.assign(video, { filePath, stage: "transcrevendo" }),
    saveTranscript: async (_: string, transcript: string) => Object.assign(video, { transcript, stage: "sugerindo" }),
    saveSuggestion: async (_: string, description: string, topics: string[]) => {
      db.topics = topics;
      Object.assign(video, { description, stage: "aguardando_confirmacao" });
    },
    saveEmbedding: async (_: string, embedding: number[]) => Object.assign(db.video, { embedding, stage: "concluido" }),
    fail: async (_: string, error: string, keep: boolean) => Object.assign(db.video, { error, status: keep ? video.status : "falhou" }),
    listTopics: async () => [{ slug: "humor", name: "Humor" }],
  };
  return db as never;
}

let db: ReturnType<typeof fakeDb>;
let deps: PipelineDeps;
let sent: string[];

beforeEach(async () => {
  db = fakeDb();
  sent = [];
  const mediaDir = await mkdtemp(join(tmpdir(), "doomscroll-"));
  deps = {
    db,
    mediaDir,
    send: async (queue) => sent.push(queue),
    download: async (_url, dir) => {
      await writeFile(join(dir, "source.mkv"), "x");
      return { filePath: join(dir, "source.mkv"), title: "Gato", hashtags: ["gato"] };
    },
    convert: async (_in, out) => writeFile(out, "mp4"),
    probe: async () => ({ duration: 8, hasAudio: true }),
    thumbnail: async (_in, out) => writeFile(out, "jpg"),
    extractAudio: async (_in, out) => writeFile(out, "wav"),
    transcribe: async () => "miau",
    suggest: vi.fn(async () => ({ topics: ["humor"], description: "Um gato." })),
    embed: vi.fn(async () => [0.1, 0.2]),
  };
});

const job = { data: { videoId: ID }, retryCount: 0 };

describe("pipeline de ingestão", () => {
  it("leva o vídeo do download até aguardar a confirmação dos tópicos", async () => {
    await runStep(QUEUES.download, deps, job);
    await runStep(QUEUES.convert, deps, job);
    await runStep(QUEUES.transcribe, deps, job);
    await runStep(QUEUES.suggest, deps, job);

    expect(sent).toEqual([QUEUES.convert, QUEUES.transcribe, QUEUES.suggest]);
    expect(db.video).toMatchObject({
      status: "processando",
      stage: "aguardando_confirmacao",
      title: "Gato",
      transcript: "miau",
      description: "Um gato.",
      filePath: `${ID}/video.mp4`,
    });
    expect(db.topics).toEqual(["humor"]);
    // Só ficam o MP4 e a thumbnail; arquivo original e áudio temporário são apagados.
    expect((await readdir(join(deps.mediaDir, ID))).sort()).toEqual(["thumb.jpg", "video.mp4"]);
  });

  it("não transcreve vídeo sem áudio", async () => {
    await runStep(QUEUES.download, deps, job);
    await runStep(QUEUES.convert, deps, job);
    deps.probe = async () => ({ duration: 8, hasAudio: false });
    deps.transcribe = vi.fn();
    await runStep(QUEUES.transcribe, deps, job);
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(db.video.transcript).toBe("");
  });

  it("só gera embedding de vídeo aprovado", async () => {
    await runStep(QUEUES.embed, deps, job);
    expect(deps.embed).not.toHaveBeenCalled();
    db.video.status = "aprovado";
    await runStep(QUEUES.embed, deps, job);
    expect(db.video.embedding).toEqual([0.1, 0.2]);
  });

  it("marca o vídeo como falhou só na última tentativa e apaga os arquivos", async () => {
    await runStep(QUEUES.download, deps, job);
    deps.convert = async () => {
      throw new Error("arquivo corrompido");
    };
    await expect(runStep(QUEUES.convert, deps, job)).rejects.toThrow("arquivo corrompido");
    expect(db.video.status).toBe("processando");
    expect(await readdir(deps.mediaDir)).toContain(ID);

    await expect(runStep(QUEUES.convert, deps, { ...job, retryCount: 2 })).rejects.toThrow();
    expect(db.video).toMatchObject({ status: "falhou", error: "arquivo corrompido" });
    expect(await readdir(deps.mediaDir)).not.toContain(ID);
  });

  it("falha no embedding mantém o vídeo aprovado e os arquivos", async () => {
    await runStep(QUEUES.download, deps, job);
    db.video.status = "aprovado";
    deps.embed = async () => {
      throw new Error("ollama fora");
    };
    await expect(runStep(QUEUES.embed, deps, { ...job, retryCount: 2 })).rejects.toThrow();
    expect(db.video).toMatchObject({ status: "aprovado", error: "ollama fora" });
    expect(await readdir(deps.mediaDir)).toContain(ID);
  });
});
