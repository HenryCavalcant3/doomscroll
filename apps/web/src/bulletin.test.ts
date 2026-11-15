import { describe, expect, it } from "vitest";
import { dateLabel, isLatest, newVideosLabel, rollTime, shortDate, splitLabel } from "./bulletin";
import { parseRoute } from "./router";

const now = new Date(2026, 10, 14, 9, 30);

describe("textos do boletim", () => {
  it("data: ontem com o dia da semana; antigos sem o ontem", () => {
    expect(dateLabel("2026-11-13", now)).toBe("Ontem, sexta-feira, 13 de novembro");
    expect(dateLabel("2026-11-10", now)).toBe("Terça-feira, 10 de novembro");
    expect(isLatest("2026-11-13", now)).toBe(true);
    expect(isLatest("2026-11-12", now)).toBe(false);
    expect(isLatest("2026-12-31", new Date(2027, 0, 1, 8))).toBe(true);
    expect(shortDate("2026-11-13")).toBe("13 de novembro");
  });

  it("autonomia do estoque", () => {
    expect(rollTime(13_200)).toBe("3 h 40 min de rolagem");
    expect(rollTime(7_200)).toBe("2 h de rolagem");
    expect(rollTime(1_054)).toBe("17 min de rolagem");
    expect(rollTime(30)).toBe("menos de um minuto de rolagem");
  });

  it("singular e plural", () => {
    expect(newVideosLabel(1)).toBe("vídeo novo");
    expect(newVideosLabel(7)).toBe("vídeos novos");
    expect(splitLabel({ moradores: 30, personas: 12 })).toBe("30 moradores · 12 personas");
    expect(splitLabel({ moradores: 1, personas: 1 })).toBe("1 morador · 1 persona");
  });

  it("rota do boletim", () => {
    expect(parseRoute("#/boletim/2026-11-13")).toEqual({ name: "boletim", date: "2026-11-13" });
    expect(parseRoute("#/boletim/ontem")).toEqual({ name: "feed" });
  });
});
