import { describe, expect, it } from "vitest";
import type { PersonaDecision } from "./api";
import { decisionText, reasonsText } from "./decisions";

const base: PersonaDecision = {
  nickname: "rato",
  name: "Rato",
  trigger: "video",
  action: "curtir",
  score: 0.5,
  reasons: { afinidade: 0.8, atividade: 0.2, acaso: -0.05, recencia: 0 },
  video: "Speedrun de Mario",
  createdAt: "2026-11-13T00:00:00.000Z",
};

describe("decisões no painel do dono", () => {
  it("descreve a decisão sobre o vídeo e as parcelas da nota", () => {
    expect(decisionText(base)).toBe("curtiu “Speedrun de Mario”");
    expect(reasonsText(base)).toBe("afinidade 0,8 · atividade 0,2 · acaso -0,05 · recência 0 · nota 0,5");
  });

  it("na mensagem mostra o vídeo mandado, sem o texto da conversa", () => {
    const sent = { ...base, trigger: "mensagem" as const, action: "enviar_video", video: null, reasons: { pediu_video: true, video: "Gato derruba copo", similaridade: 0.72, destaque: 2.6, topico_citado: true } };
    expect(decisionText(sent)).toBe("respondeu e mandou um vídeo (“Gato derruba copo”)");
    expect(reasonsText(sent)).toBe("pediu vídeo sim · similaridade 0,72 · destaque 2,6 · tópico citado sim");
    expect(decisionText({ ...sent, action: "responder", reasons: { video: "nenhum" } })).toBe("respondeu uma mensagem");
  });

  it("descreve o tique e as conversas entre personas", () => {
    const tick = { ...base, trigger: "tique" as const, action: "enviar_video", score: 0.8, video: "Speedrun de Mario", reasons: { atividade: 0.9, relacao: true, para: "rato" } };
    expect(decisionText(tick)).toBe("puxou conversa: mandou “Speedrun de Mario” para @rato");
    expect(reasonsText(tick)).toBe("atividade 0,9 · se conhecem sim · nota 0,8");
    expect(decisionText({ ...tick, reasons: { para: "Grupo do Bunker" } })).toBe("puxou conversa: mandou “Speedrun de Mario” para Grupo do Bunker");
    const talk = { ...base, trigger: "mensagem" as const, video: null, reasons: { mensagens: 4, chance: 0.5 } };
    expect(decisionText({ ...talk, action: "ignorar" })).toBe("deixou a conversa morrer");
    expect(decisionText({ ...talk, action: "responder" })).toBe("respondeu outra persona");
    expect(decisionText({ ...talk, action: "comentar", reasons: { acao: "comentar" } })).toBe("respondeu no Grupo do Bunker");
    expect(decisionText({ ...talk, action: "comentar", reasons: { acao: "comentar", nivel: 1, mencao: true } })).toBe(
      "respondeu outra persona no Grupo do Bunker (alguém citou o nome)",
    );
    expect(decisionText({ ...talk, action: "reagir", reasons: { acao: "comentar", teto_da_conversa: true } })).toBe("só reagiu no Grupo do Bunker (a conversa chegou ao teto)");
  });
});
