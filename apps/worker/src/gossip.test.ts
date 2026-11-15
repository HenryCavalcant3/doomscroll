import { describe, expect, it } from "vitest";
import { curiousFacts, pickCuriousFact, type Counts, type PersonaActivity } from "./gossip.js";

const c = (over: Partial<Counts> = {}): Counts => ({ likes: 0, comments: 0, groupMessages: 0, videoTargets: 0, ...over });
const persona = (id: string, today: Partial<Counts>, past: Partial<Counts> = {}): PersonaActivity => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  today: c(today),
  past: Array.from({ length: 7 }, () => c(past)),
});

describe("fato curioso", () => {
  it("quem quase nunca curte e curtiu", () => {
    const [f] = curiousFacts([persona("rato", { likes: 4 })], []);
    expect(f).toMatchObject({ detector: "curtiu_raro", quem: "Rato", intensidade: "alta" });
  });

  it("curtir dentro do normal não é fofoca", () => {
    expect(curiousFacts([persona("kelly", { likes: 6 }, { likes: 5 })], [])).toEqual([]);
  });

  it("muito mais comentários que a média", () => {
    const [f] = curiousFacts([persona("kelly", { comments: 12 }, { comments: 2 })], []);
    expect(f).toMatchObject({ detector: "comentou_muito", intensidade: "alta" });
  });

  it("silêncio de quem costuma aparecer", () => {
    const [f] = curiousFacts([persona("tio", {}, { likes: 3, groupMessages: 2 })], []);
    expect(f).toMatchObject({ detector: "silencio", quem: "Tio" });
    expect(curiousFacts([persona("tio", {}, { likes: 1 })], [])).toEqual([]);
  });

  it("par que trocou muitas mensagens", () => {
    const ps = [persona("rato", {}), persona("kelly", {})];
    const [f] = curiousFacts(ps, [{ a: "rato", b: "kelly", today: 14, pastTotal: 7, pastDays: 7 }]);
    expect(f).toMatchObject({ detector: "papo_em_dupla", quem: "Rato e Kelly", subjects: ["rato", "kelly"] });
  });

  it("sem três dias de histórico com o bunker ligado, não há fato", () => {
    const novata = { ...persona("rato", { likes: 9 }), past: [c(), c()] };
    expect(curiousFacts([novata], [])).toEqual([]);
    const ps = [persona("rato", {}), persona("kelly", {})];
    expect(curiousFacts(ps, [{ a: "rato", b: "kelly", today: 30, pastTotal: 0, pastDays: 2 }])).toEqual([]);
  });

  it("o mais fora do padrão primeiro, sem a persona de plantão", () => {
    const ps = [persona("rato", { likes: 6 }), persona("kelly", { comments: 6 }, { comments: 1 })];
    expect(curiousFacts(ps, [])[0]?.quem).toBe("Rato");
    expect(pickCuriousFact(ps, [], "rato")?.quem).toBe("Kelly");
    expect(pickCuriousFact([persona("rato", { likes: 6 })], [], "rato")).toBeNull();
  });

  it("fala só de números do banco: nenhuma frase do fato tem dígito", () => {
    const ps = [persona("rato", { likes: 40, comments: 40, groupMessages: 40, videoTargets: 40 }), persona("kelly", {}, { likes: 9 })];
    const facts = curiousFacts(ps, [{ a: "rato", b: "kelly", today: 50, pastTotal: 0, pastDays: 7 }]);
    expect(facts.length).toBeGreaterThanOrEqual(6);
    for (const f of facts) expect(`${f.quem} ${f.o_que} ${f.intensidade}`).not.toMatch(/\d/);
  });
});
