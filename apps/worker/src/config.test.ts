import { describe, expect, it } from "vitest";
import { readConfig } from "./config.js";
import { toolVersion } from "./tools.js";

describe("worker", () => {
  it("lê DATABASE_URL e usa padrões para o resto", () => {
    expect(readConfig({ DATABASE_URL: "postgres://x" })).toMatchObject({
      databaseUrl: "postgres://x",
      whisperModel: "base",
      embedModel: "nomic-embed-text",
    });
  });

  it("falha sem DATABASE_URL ou com WHISPER_MODEL estranho", () => {
    expect(() => readConfig({})).toThrow(/DATABASE_URL/);
    expect(() => readConfig({ DATABASE_URL: "x", WHISPER_MODEL: "../../etc" })).toThrow(/WHISPER_MODEL/);
  });

  it("devolve a versão de uma ferramenta instalada e null para uma ausente", async () => {
    expect(await toolVersion("node", ["--version"])).toMatch(/^v\d+/);
    expect(await toolVersion("ferramenta-que-nao-existe", [])).toBeNull();
  });
});
