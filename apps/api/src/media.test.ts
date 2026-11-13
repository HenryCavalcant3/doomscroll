import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { removeVideoMedia, sweepMedia } from "./media.js";

const ids = {
  aprovado: "00000000-0000-4000-8000-000000000001",
  rejeitado: "00000000-0000-4000-8000-000000000002",
  falhou: "00000000-0000-4000-8000-000000000003",
  baixando: "00000000-0000-4000-8000-000000000004",
  orfao: "00000000-0000-4000-8000-000000000005",
};

async function mediaDir() {
  const dir = await mkdtemp(join(tmpdir(), "doomscroll-media-"));
  for (const id of Object.values(ids)) {
    await mkdir(join(dir, id));
    await writeFile(join(dir, id, "video.mp4"), "x");
  }
  await mkdir(join(dir, "nao-e-uuid"));
  return dir;
}

describe("mídia", () => {
  it("na subida apaga pastas de rejeitados, falhos e órfãos, e mantém o resto", async () => {
    const dir = await mediaDir();
    const statuses = new Map([
      [ids.aprovado, "aprovado"],
      [ids.rejeitado, "rejeitado"],
      [ids.falhou, "falhou"],
      [ids.baixando, "baixando"],
    ]);
    const removed = await sweepMedia(dir, async () => statuses);
    expect(removed.sort()).toEqual([ids.rejeitado, ids.falhou, ids.orfao].sort());
    expect((await readdir(dir)).sort()).toEqual([ids.aprovado, ids.baixando, "nao-e-uuid"].sort());
  });

  it("só apaga pastas cujo nome é um id de vídeo", async () => {
    const dir = await mediaDir();
    await removeVideoMedia(dir, "../nao-e-uuid");
    await removeVideoMedia(dir, ids.aprovado);
    expect(await readdir(dir)).toContain("nao-e-uuid");
    expect(await readdir(dir)).not.toContain(ids.aprovado);
  });
});
