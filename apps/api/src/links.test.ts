import { describe, expect, it } from "vitest";
import { parseVideoLink } from "./links.js";
import { generatePin, hashPin, verifyPin } from "./pin.js";

describe("parseVideoLink", () => {
  it.each([
    ["https://www.youtube.com/shorts/abcdefghijk", "youtube"],
    ["https://youtu.be/abcdefghijk", "youtube"],
    ["http://m.youtube.com/watch?v=abcdefghijk", "youtube"],
    ["https://www.tiktok.com/@user/video/123", "tiktok"],
    ["https://vm.tiktok.com/ZMabc/", "tiktok"],
  ])("aceita %s", (input, platform) => {
    expect(parseVideoLink(input)?.platform).toBe(platform);
  });

  it.each([
    "nao é link",
    "ftp://youtube.com/x",
    "https://youtube.com.evil.com/shorts/abcdefghijk",
    "https://www.youtube.com/shorts/curto",
    "https://www.youtube.com/@canal",
    "https://exemplo.com/shorts/abc",
    "https://user:senha@youtube.com/shorts/abc",
    "file:///etc/passwd",
    "--exec=rm",
  ])("recusa %s", (input) => {
    expect(parseVideoLink(input)).toBeNull();
  });

  it("leva todos os formatos de link do YouTube para a mesma forma", () => {
    const forms = [
      "https://youtu.be/jNQXAC9IVRw?si=x",
      "http://www.youtube.com/watch?v=jNQXAC9IVRw&t=3#x",
      "https://youtube.com/shorts/jNQXAC9IVRw?feature=share",
      "https://m.youtube.com/watch?v=jNQXAC9IVRw",
    ];
    for (const f of forms) expect(parseVideoLink(f)?.url).toBe("https://www.youtube.com/watch?v=jNQXAC9IVRw");
  });

  it("força https e remove parâmetros de rastreamento do TikTok", () => {
    expect(parseVideoLink("http://www.tiktok.com/@a/video/1?is_from_webapp=1&utm_source=y#t")?.url).toBe(
      "https://www.tiktok.com/@a/video/1",
    );
  });
});

describe("PIN", () => {
  it("confere o PIN certo e recusa o errado", async () => {
    const hash = await hashPin("4321");
    expect(hash).not.toContain("4321");
    expect(await verifyPin("4321", hash)).toBe(true);
    expect(await verifyPin("1234", hash)).toBe(false);
    expect(await verifyPin("4321", "lixo")).toBe(false);
  });

  it("gera PINs de 6 dígitos", () => {
    expect(generatePin()).toMatch(/^\d{6}$/);
  });
});
