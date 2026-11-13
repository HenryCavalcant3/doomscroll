import { describe, expect, it } from "vitest";
import { readConfig } from "./config.js";
import { toolVersion } from "./tools.js";

describe("worker", () => {
  it("lê DATABASE_URL do ambiente", () => {
    expect(readConfig({ DATABASE_URL: "postgres://x" })).toEqual({ databaseUrl: "postgres://x" });
  });

  it("falha sem DATABASE_URL", () => {
    expect(() => readConfig({})).toThrow(/DATABASE_URL/);
  });

  it("devolve a versão de uma ferramenta instalada e null para uma ausente", async () => {
    expect(await toolVersion("node", ["--version"])).toMatch(/^v\d+/);
    expect(await toolVersion("ferramenta-que-nao-existe", [])).toBeNull();
  });
});
