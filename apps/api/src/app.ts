import Fastify from "fastify";
import type { Config } from "./config.js";
import { generate, OllamaError } from "./ollama.js";

export interface AppDeps {
  config: Config;
  fetchImpl?: typeof fetch;
  logger?: boolean;
}

export function buildApp({ config, fetchImpl, logger = false }: AppDeps) {
  const app = Fastify({ logger });

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

  return app;
}
