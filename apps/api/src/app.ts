import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { bearerToken, hashToken, LoginLimiter, newToken, NEW_PIN, NICKNAME, normalizeNickname } from "./auth.js";
import type { Config } from "./config.js";
import { parseVideoLink } from "./links.js";
import { generate, OllamaError } from "./ollama.js";
import { hashPin, verifyPin } from "./pin.js";
import { QUEUES } from "./queues.js";
import type { Store, UserView, VideoStatus } from "./store.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Preenchido pelo hook de sessão nas rotas protegidas. */
    user: UserView;
  }
}

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
  /** Relógio dos limites de tentativa de PIN (trocado nos testes). */
  now?: () => number;
}

const LOGIN_WINDOW_MS = 15 * 60_000;

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
  now = Date.now,
}: AppDeps) {
  // Atrás do nginx do web: o IP de quem acessa vem no X-Forwarded-For.
  const app = Fastify({ logger, trustProxy: true });
  const failuresByNickname = new LoginLimiter(5, LOGIN_WINDOW_MS, now);
  const failuresByIp = new LoginLimiter(20, LOGIN_WINDOW_MS, now);

  if (serveMedia) {
    app.register(fastifyStatic, { root: config.mediaDir, prefix: "/media/", index: false, list: false });
    // Só os SVG da pasta personas (os JSON não são servidos).
    app.register(fastifyStatic, {
      root: config.personasDir,
      prefix: "/avatars/",
      index: false,
      list: false,
      decorateReply: false,
      allowedPath: (path) => /^\/[a-z0-9-]+\.svg$/.test(path),
    });
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

  // Entrada (SPEC 4): apelido + PIN. Apelido novo cria a conta; apelido existente confere o PIN.
  app.post<{ Body: { nickname: string; pin: string } }>(
    "/auth/entrar",
    {
      schema: {
        body: {
          type: "object",
          required: ["nickname", "pin"],
          additionalProperties: false,
          properties: {
            nickname: { type: "string", minLength: 1, maxLength: 40 },
            pin: { type: "string", minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (req, reply) => {
      const nickname = normalizeNickname(req.body.nickname);
      const { pin } = req.body;
      if (!NICKNAME.test(nickname)) {
        return reply.code(400).send({ error: "O apelido precisa ter de 3 a 30 letras sem acento, números ou _." });
      }
      const nickKey = `apelido:${nickname}`;
      const ipKey = `ip:${req.ip}`;
      const wait = Math.max(failuresByNickname.blockedFor(nickKey), failuresByIp.blockedFor(ipKey));
      if (wait > 0) {
        return reply
          .code(429)
          .header("retry-after", String(wait))
          .send({ error: `Muitas tentativas com PIN errado. Tente de novo em ${Math.ceil(wait / 60)} min.` });
      }

      const found = await store.findUser(nickname);
      let user: UserView;
      let created = false;
      if (found) {
        if (!found.pinHash) return reply.code(409).send({ error: "Esse apelido é de uma persona. Escolha outro." });
        if (!(await verifyPin(pin, found.pinHash))) {
          failuresByNickname.fail(nickKey);
          failuresByIp.fail(ipKey);
          return reply.code(401).send({ error: "PIN incorreto." });
        }
        failuresByNickname.reset(nickKey);
        user = found.user;
      } else {
        if (!NEW_PIN.test(pin)) return reply.code(400).send({ error: "O PIN precisa ter de 4 a 6 números." });
        const newUser = await store.createUser(nickname, await hashPin(pin));
        // Outra pessoa criou o mesmo apelido no mesmo instante.
        if (!newUser) return reply.code(409).send({ error: "Esse apelido acabou de ser criado. Tente entrar de novo." });
        user = newUser;
        created = true;
      }
      const token = newToken();
      await store.createSession(user.id, hashToken(token));
      return reply.code(created ? 201 : 200).send({ token, user, created });
    },
  );

  // Daqui para baixo, tudo pede sessão (cabeçalho Authorization: Bearer <token>).
  app.register(async (priv) => {
    priv.decorateRequest("user", null as unknown as UserView);
    priv.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
      const token = bearerToken(req.headers.authorization);
      const user = token ? await store.sessionUser(hashToken(token)) : null;
      if (!user) return reply.code(401).send({ error: "Entre com seu apelido e PIN." });
      req.user = user;
    });

    priv.get("/auth/eu", async (req) => req.user);

    priv.post("/auth/sair", async (req, reply) => {
      await store.deleteSession(hashToken(bearerToken(req.headers.authorization)!));
      return reply.code(204).send();
    });

    priv.get("/topics", async () => store.listTopics());

    priv.post<{ Body: { url: string } }>(
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
        const id = await store.createVideo(link.url, link.platform, req.user.id);
        await queue.send(QUEUES.download, { videoId: id });
        return reply.code(201).send(await store.getVideo(id));
      },
    );

    // Feed (SPEC 5.2). POST porque o cliente manda a lista do que já viu nesta sessão.
    priv.post<{ Body: { exclude?: string[]; limit?: number } }>(
      "/feed",
      {
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            properties: {
              exclude: { type: "array", maxItems: 1000, items: { type: "string", maxLength: 36 } },
              limit: { type: "integer", minimum: 1, maximum: 20 },
            },
          },
        },
      },
      async (req) => store.feed(req.user.id, req.body.exclude ?? [], req.body.limit ?? 5),
    );

    priv.get<{ Params: { id: string } }>("/videos/:id/comments", { schema: { params: idParams } }, async (req, reply) => {
      const comments = await store.listComments(req.params.id);
      return comments ?? reply.code(404).send({ error: "Vídeo não encontrado." });
    });

    priv.post<{ Params: { id: string }; Body: { text: string } }>(
      "/videos/:id/comments",
      {
        schema: {
          params: idParams,
          body: {
            type: "object",
            required: ["text"],
            additionalProperties: false,
            properties: { text: { type: "string", minLength: 1, maxLength: 500 } },
          },
        },
      },
      async (req, reply) => {
        const text = req.body.text.replace(/\s+/g, " ").trim();
        if (!text) return reply.code(400).send({ error: "Escreva alguma coisa." });
        const comment = await store.addComment(req.user.id, req.params.id, text);
        return comment ? reply.code(201).send(comment) : reply.code(404).send({ error: "Vídeo não encontrado." });
      },
    );

    // Curtir é idempotente: PUT curte, DELETE descurte.
    for (const method of ["PUT", "DELETE"] as const) {
      priv.route<{ Params: { id: string } }>({
        method,
        url: "/videos/:id/like",
        schema: { params: idParams },
        handler: async (req, reply) => {
          const result = await store.setLike(req.user.id, req.params.id, method === "PUT");
          return result ?? reply.code(404).send({ error: "Vídeo não encontrado." });
        },
      });
    }

    priv.get<{ Params: { id: string } }>("/videos/:id", { schema: { params: idParams } }, async (req, reply) => {
      const video = await store.getVideo(req.params.id);
      return video ?? reply.code(404).send({ error: "Vídeo não encontrado." });
    });

    priv.put<{ Params: { id: string }; Body: { topics: string[] } }>(
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

    // Perfil (tela 6): de usuário ou de persona, com os vídeos curtidos.
    priv.get<{ Params: { nickname: string } }>(
      "/users/:nickname",
      { schema: { params: { type: "object", required: ["nickname"], properties: { nickname: { type: "string", maxLength: 40 } } } } },
      async (req, reply) => {
        const profile = await store.profile(normalizeNickname(req.params.nickname), req.user.id);
        return profile ?? reply.code(404).send({ error: "Ninguém com esse apelido no bunker." });
      },
    );

    // Painel do dono: só para quem entrou com a conta de dono.
    priv.register(async (owner) => {
      owner.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
        if (req.user.role !== "owner") return reply.code(403).send({ error: "Só o dono do bunker pode fazer isso." });
      });

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
          if (!(await store.approve(req.params.id, req.user.id))) {
            return reply.code(409).send({ error: "Só vídeos pendentes podem ser aprovados." });
          }
          await queue.send(QUEUES.embed, { videoId: req.params.id });
          await queue.send(QUEUES.personaComment, { videoId: req.params.id });
          return store.getVideo(req.params.id);
        },
      );

      owner.post<{ Params: { id: string } }>(
        "/owner/videos/:id/reject",
        { schema: { params: idParams } },
        async (req, reply) => {
          if (!(await store.reject(req.params.id, req.user.id))) {
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
  });

  return app;
}
