import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { Config } from "./config.js";
import { parseVideoLink } from "./links.js";
import { generate, OllamaError } from "./ollama.js";
import { verifyPin } from "./pin.js";
import { QUEUES } from "./queues.js";
import type { Store, VideoStatus } from "./store.js";

export interface JobQueue {
  send(name: string, data: object): Promise<unknown>;
}

export interface AppDeps {
  config: Config;
  store: Store;
  queue: JobQueue;
  fetchImpl?: typeof fetch;
  logger?: boolean;
  /** Serve os arquivos de MEDIA_DIR em /media (desligado nos testes). */
  serveMedia?: boolean;
  /** Apaga os arquivos de um vídeo rejeitado. */
  removeMedia?: (id: string) => Promise<void>;
}

const STATUSES: VideoStatus[] = ["baixando", "processando", "pendente", "aprovado", "rejeitado", "falhou"];

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

export function buildApp({
  config,
  store,
  queue,
  fetchImpl,
  logger = false,
  serveMedia = false,
  removeMedia = async () => {},
}: AppDeps) {
  const app = Fastify({ logger });

  if (serveMedia) {
    app.register(fastifyStatic, { root: config.mediaDir, prefix: "/media/", index: false, list: false });
  }

  app.get("/health", async () => ({ status: "ok" }));

  app.post<{ Body: { prompt: string } }>(
    "/ai/teste",
    {
      schema: {
        body: {
          type: "object",
          required: ["prompt"],
          additionalProperties: false,
          properties: { prompt: { type: "string", minLength: 1, maxLength: 2000 } },
        },
      },
    },
    async (req, reply) => {
      try {
        return await generate({
          baseUrl: config.ollamaUrl,
          model: config.llmModel,
          prompt: req.body.prompt,
          timeoutMs: config.llmTimeoutMs,
          fetchImpl,
        });
      } catch (err) {
        if (err instanceof OllamaError) {
          req.log.warn({ err }, "falha ao chamar o Ollama");
          return reply.code(err.status).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get("/topics", async () => store.listTopics());

  // Cadastro de vídeo. Até o passo 4 (login) todo vídeo é registrado em nome do dono.
  app.post<{ Body: { url: string } }>(
    "/videos",
    {
      schema: {
        body: {
          type: "object",
          required: ["url"],
          additionalProperties: false,
          properties: { url: { type: "string", minLength: 1, maxLength: 500 } },
        },
      },
    },
    async (req, reply) => {
      const link = parseVideoLink(req.body.url);
      if (!link) {
        return reply.code(400).send({ error: "Link não aceito. Use um link do YouTube Shorts ou do TikTok." });
      }
      const existing = await store.findActiveVideoBySource(link.url);
      if (existing) {
        return reply.code(409).send({ error: "Esse vídeo já está no bunker.", id: existing });
      }
      const owner = await store.getOwner();
      if (!owner) return reply.code(503).send({ error: "O bunker ainda não tem dono." });
      const id = await store.createVideo(link.url, link.platform, owner.id);
      await queue.send(QUEUES.download, { videoId: id });
      return reply.code(201).send(await store.getVideo(id));
    },
  );

  app.get<{ Params: { id: string } }>("/videos/:id", { schema: { params: idParams } }, async (req, reply) => {
    const video = await store.getVideo(req.params.id);
    return video ?? reply.code(404).send({ error: "Vídeo não encontrado." });
  });

  app.put<{ Params: { id: string }; Body: { topics: string[] } }>(
    "/videos/:id/topics",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["topics"],
          additionalProperties: false,
          properties: {
            topics: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await store.confirmTopics(req.params.id, req.body.topics);
      switch (result) {
        case "ok":
          return store.getVideo(req.params.id);
        case "not_found":
          return reply.code(404).send({ error: "Vídeo não encontrado." });
        case "invalid_state":
          return reply.code(409).send({ error: "Os tópicos só podem ser confirmados quando o processamento termina." });
        case "invalid_topics":
          return reply.code(400).send({ error: "Algum tópico não existe." });
      }
    },
  );

  // Painel do dono: rotas protegidas pelo PIN no cabeçalho x-owner-pin.
  app.register(async (owner) => {
    owner.decorateRequest("ownerId", "");
    owner.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
      const pin = req.headers["x-owner-pin"];
      const record = await store.getOwner();
      if (typeof pin !== "string" || !record || !(await verifyPin(pin, record.pinHash))) {
        return reply.code(401).send({ error: "PIN do dono inválido." });
      }
      (req as FastifyRequest & { ownerId: string }).ownerId = record.id;
    });
    const ownerId = (req: FastifyRequest) => (req as FastifyRequest & { ownerId: string }).ownerId;

    owner.post("/owner/login", async (_req, reply) => reply.code(204).send());

    owner.get<{ Querystring: { status?: VideoStatus } }>(
      "/owner/videos",
      {
        schema: {
          querystring: { type: "object", properties: { status: { type: "string", enum: STATUSES } } },
        },
      },
      async (req) => store.listVideos(req.query.status ?? "pendente"),
    );

    owner.post<{ Params: { id: string } }>(
      "/owner/videos/:id/approve",
      { schema: { params: idParams } },
      async (req, reply) => {
        if (!(await store.approve(req.params.id, ownerId(req)))) {
          return reply.code(409).send({ error: "Só vídeos pendentes podem ser aprovados." });
        }
        await queue.send(QUEUES.embed, { videoId: req.params.id });
        return store.getVideo(req.params.id);
      },
    );

    owner.post<{ Params: { id: string } }>(
      "/owner/videos/:id/reject",
      { schema: { params: idParams } },
      async (req, reply) => {
        if (!(await store.reject(req.params.id, ownerId(req)))) {
          return reply.code(409).send({ error: "Só vídeos pendentes podem ser rejeitados." });
        }
        // O registro fica como histórico; os arquivos saem do disco.
        await removeMedia(req.params.id).catch((err) => req.log.error({ err }, "falha ao apagar mídia"));
        return store.getVideo(req.params.id);
      },
    );

    owner.post<{ Body: { name: string } }>(
      "/owner/topics",
      {
        schema: {
          body: {
            type: "object",
            required: ["name"],
            additionalProperties: false,
            properties: { name: { type: "string", minLength: 2, maxLength: 40 } },
          },
        },
      },
      async (req, reply) => {
        const name = req.body.name.trim();
        const slug = slugify(name);
        if (!slug) return reply.code(400).send({ error: "Nome de tópico inválido." });
        const topic = await store.createTopic(name, slug);
        return topic ? reply.code(201).send(topic) : reply.code(409).send({ error: "Esse tópico já existe." });
      },
    );
  });

  return app;
}
