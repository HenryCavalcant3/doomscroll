import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoDb, VideoRecord } from "./db.js";
import { RATE_RETRY_SECONDS, runStep, type PipelineDeps } from "./pipeline.js";
import { QUEUES } from "./queues.js";

const ID = "11111111-1111-4111-8111-111111111111";
const VALDIR = {
  userId: "22222222-2222-4222-8222-222222222222",
  nickname: "tio_valdir",
  name: "Tio Valdir",
  bio: "Tio do bunker.",
  tone: "Animado.",
  examples: ["Bom dia!"],
  // Gosto alto: o JEV manda comentar (com o acaso no meio, random 0.5).
  activity: 1,
  affinity: { humor: 1 },
  commented: false,
  recentWithAuthor: 0,
};
const RATO = { ...VALDIR, userId: "33333333-3333-4333-8333-333333333333", nickname: "rato", name: "Rato" };

function fakeDb(): VideoDb & {
  video: VideoRecord & { stage: string; error?: string; embedding?: number[] };
  topics: string[];
  comments: { userId: string; text: string }[];
  likes: string[];
  decisions: { userId: string; action: string; reasons: Record<string, unknown> }[];
  personas: (typeof VALDIR)[];
  actionsLastHour: number;
} {
  const video = {
    id: ID, sourceUrl: "https://youtu.be/x", status: "baixando", stage: "baixando", title: null as string | null,
    hashtags: [] as string[], sourceDescription: null as string | null, description: null as string | null, transcript: null as string | null, filePath: null as string | null,
  };
  const db = {
    video: video as typeof video & { error?: string; embedding?: number[] },
    topics: [] as string[],
    get: async () => ({ ...video }),
    setStage: async (_: string, status: string, stage: string) => Object.assign(video, { status, stage }),
    saveDownload: async (_: string, title: string | null, hashtags: string[], sourceDescription: string | null) =>
      Object.assign(video, { title, hashtags, sourceDescription, status: "processando", stage: "convertendo" }),
    saveMedia: async (_: string, filePath: string) => Object.assign(video, { filePath, stage: "transcrevendo" }),
    saveTranscript: async (_: string, transcript: string) => Object.assign(video, { transcript, stage: "sugerindo" }),
    saveSuggestion: async (_: string, description: string, topics: string[]) => {
      db.topics = topics;
      Object.assign(video, { description, stage: "aguardando_confirmacao" });
    },
    saveEmbedding: async (_: string, embedding: number[]) => Object.assign(db.video, { embedding, stage: "concluido" }),
    fail: async (_: string, error: string, keep: boolean) => Object.assign(db.video, { error, status: keep ? video.status : "falhou" }),
    listTopics: async () => [{ slug: "humor", name: "Humor" }],
    comments: [] as { userId: string; text: string }[],
    likes: [] as string[],
    decisions: [] as { userId: string; action: string; reasons: Record<string, unknown> }[],
    personas: [VALDIR],
    videoForComment: async () => ({ status: video.status, title: video.title, description: video.description, topics: ["Humor"], topicSlugs: ["humor"] }),
    personasToDecide: async () => db.personas.filter((p) => !db.decisions.some((d) => d.userId === p.userId)),
    addPersonaLike: async (_: string, userId: string) => {
      if (!db.likes.includes(userId)) db.likes.push(userId);
    },
    saveDecision: async (userId: string, _: string, d: { action: string; reasons: Record<string, unknown> }) => {
      db.decisions.push({ userId, action: d.action, reasons: d.reasons });
    },
    addPersonaComment: async (_: string, userId: string, text: string) => {
      if (db.comments.some((c) => c.userId === userId)) return false;
      db.comments.push({ userId, text });
      return true;
    },
    actionsLastHour: 0,
    personaActionsLastHour: async () => db.actionsLastHour,
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
      return { filePath: join(dir, "source.mkv"), title: "Gato", hashtags: ["gato"], sourceDescription: "Meu gato" };
    },
    convert: async (_in, out) => writeFile(out, "mp4"),
    probe: async () => ({ duration: 8, hasAudio: true }),
    thumbnail: async (_in, out) => writeFile(out, "jpg"),
    extractAudio: async (_in, out) => writeFile(out, "wav"),
    transcribe: async () => "miau miau, olha o gato",
    suggest: vi.fn(async () => ({ topics: ["humor"], description: "Um gato." })),
    embed: vi.fn(async () => [0.1, 0.2]),
    comment: vi.fn(async () => "Bom dia, sobreviventes!"),
    random: () => 0.5,
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
      transcript: "miau miau, olha o gato",
      sourceDescription: "Meu gato",
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

  it("trata transcrição só de música como vídeo sem fala", async () => {
    await runStep(QUEUES.download, deps, job);
    await runStep(QUEUES.convert, deps, job);
    deps.transcribe = async () => "(upbeat music)";
    await runStep(QUEUES.transcribe, deps, job);
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

describe("JEV no vídeo aprovado", () => {
  it("só decide sobre vídeo aprovado, uma vez por persona; comentar também curte", async () => {
    await runStep(QUEUES.personaComment, deps, job);
    expect(deps.comment).not.toHaveBeenCalled();

    db.video.status = "aprovado";
    await runStep(QUEUES.personaComment, deps, job);
    await runStep(QUEUES.personaComment, deps, job);
    expect(deps.comment).toHaveBeenCalledTimes(1);
    expect(deps.comment).toHaveBeenCalledWith(VALDIR, expect.objectContaining({ topics: ["Humor"] }), false);
    expect(db.comments).toEqual([{ userId: VALDIR.userId, text: "Bom dia, sobreviventes!" }]);
    expect(db.likes).toEqual([VALDIR.userId]);
    expect(db.decisions).toEqual([{ userId: VALDIR.userId, action: "comentar", reasons: expect.objectContaining({ afinidade: 1, atividade: 1 }) }]);
  });

  it("persona sem afinidade com o vídeo ignora: nem curte nem comenta", async () => {
    db.video.status = "aprovado";
    db.personas = [{ ...RATO, activity: 0.1, affinity: { humor: 0 } }];
    await runStep(QUEUES.personaComment, deps, job);
    expect(deps.comment).not.toHaveBeenCalled();
    expect(db.likes).toEqual([]);
    expect(db.decisions.map((d) => d.action)).toEqual(["ignorar"]);
  });

  it("no acervo antigo e para quem já comentou, no máximo curte", async () => {
    db.video.status = "aprovado";
    db.personas = [VALDIR, { ...RATO, commented: true }];
    await runStep(QUEUES.personaComment, deps, { ...job, data: { videoId: ID, likesOnly: true } });
    expect(deps.comment).not.toHaveBeenCalled();
    expect(db.likes).toEqual([VALDIR.userId, RATO.userId]);
    expect(db.decisions.map((d) => [d.action, d.reasons.so_curtida])).toEqual([
      ["curtir", "acervo"],
      ["curtir", "acervo"],
    ]);

    db.decisions = [];
    db.likes = [];
    db.personas = [{ ...RATO, commented: true }];
    await runStep(QUEUES.personaComment, deps, job);
    expect(db.decisions.map((d) => [d.action, d.reasons.so_curtida])).toEqual([["curtir", "ja_comentou"]]);
  });

  it("às vezes pede a brincadeira com o fim do mundo", async () => {
    db.video.status = "aprovado";
    deps.random = () => 0.01;
    await runStep(QUEUES.personaComment, deps, job);
    expect(deps.comment).toHaveBeenCalledWith(VALDIR, expect.anything(), true);
  });

  it("com o limite por hora estourado, adia o comentário sem gastar tentativas", async () => {
    db.video.status = "aprovado";
    deps.personaRate = 5;
    db.actionsLastHour = 5;
    const delayed: unknown[] = [];
    deps.send = async (queue, data, options) => delayed.push({ queue, data, options });
    await runStep(QUEUES.personaComment, deps, job);
    expect(deps.comment).not.toHaveBeenCalled();
    expect(delayed).toEqual([{ queue: QUEUES.personaComment, data: { videoId: ID }, options: { startAfter: RATE_RETRY_SECONDS } }]);

    db.actionsLastHour = 4;
    await runStep(QUEUES.personaComment, deps, job);
    expect(db.comments).toHaveLength(1);
  });

  it("uma persona que falha não impede as outras, e o job volta para a fila", async () => {
    db.video.status = "aprovado";
    db.personas = [RATO, VALDIR];
    let ratoFails = true;
    deps.comment = async (p) => {
      if (p.nickname === "rato" && ratoFails) throw new Error("copiou o exemplo");
      return `oi do ${p.nickname}`;
    };
    await expect(runStep(QUEUES.personaComment, deps, job)).rejects.toThrow("rato: copiou o exemplo");
    expect(db.comments).toEqual([{ userId: VALDIR.userId, text: "oi do tio_valdir" }]);

    ratoFails = false;
    await runStep(QUEUES.personaComment, deps, job);
    expect(db.comments.map((c) => c.text)).toEqual(["oi do tio_valdir", "oi do rato"]);
  });

  it("PERSONA_RATE=0 desliga os comentários sem reagendar, mas a curtida continua", async () => {
    db.video.status = "aprovado";
    deps.personaRate = 0;
    await runStep(QUEUES.personaComment, deps, job);
    expect(deps.comment).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(db.likes).toEqual([VALDIR.userId]);
    expect(db.decisions[0]!.reasons.so_curtida).toBe("persona_rate_0");
  });

  it("falha no comentário não tira o vídeo do feed nem apaga arquivos", async () => {
    await runStep(QUEUES.download, deps, job);
    db.video.status = "aprovado";
    deps.comment = async () => {
      throw new Error("ollama fora");
    };
    await expect(runStep(QUEUES.personaComment, deps, { ...job, retryCount: 2 })).rejects.toThrow();
    expect(db.video.status).toBe("aprovado");
    expect(db.video.error).toBeUndefined();
    expect(await readdir(deps.mediaDir)).toContain(ID);
  });
});
