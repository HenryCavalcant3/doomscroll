import { describe, expect, it } from "vitest";
import { goodMatch, onlyTitle, promptTitle, type VideoMatch } from "./personaChat.js";
import { CHAT_JEV, TALK_JEV, asksForVideo, decideChat, decideGroup, decideTalk, reactionFor, topicsIn, videoQuery } from "./personaJev.js";

const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length]!;
};
const calm = { asked: false, sinceLastVideo: 0, words: 3 };

describe("JEV no chat", () => {
  it("reconhece pedido de vídeo", () => {
    for (const t of ["me manda um vídeo de gato", "tem algum video engraçado?", "recomenda algo pra rir", "quero ver um vídeo de receita", "mostra alguma coisa legal"]) {
      expect(asksForVideo(t), t).toBe(true);
    }
    for (const t of ["oi tudo bem?", "vi um vídeo ontem", "o que você acha de gato?"]) expect(asksForVideo(t), t).toBe(false);
  });

  it("reage com emoji que combina: nada de 😂 para quem está triste", () => {
    expect(["😢", "❤️"]).toContain(reactionFor("tô muito triste hoje", seq(0.9)));
    expect(reactionFor("kkkkk que isso", seq(0.1))).toBe("😂");
    expect(reactionFor("que lindo esse cachorro", seq(0.1))).toBe("❤️");
  });

  it("reage mais quem tem mais atividade", () => {
    // Primeiro sorteio é o da reação: 0,2 reage com atividade 0,9 (chance 0,315), não com 0,2 (0,07).
    expect(decideChat(0.9, "oi", calm, seq(0.2, 0.5, 0.99)).react).not.toBeNull();
    expect(decideChat(0.2, "oi", calm, seq(0.2, 0.5, 0.99)).react).toBeNull();
  });

  it("pedido sempre manda vídeo; sem pedido, só com assunto, intervalo e sorte", () => {
    expect(decideChat(0.5, "manda um vídeo", { ...calm, asked: true }, seq(0.99)).action).toBe("enviar_video");
    const ready = { asked: false, sinceLastVideo: CHAT_JEV.minGap, words: CHAT_JEV.minWords };
    expect(decideChat(0.5, "x", ready, seq(0.99, 0.05)).action).toBe("enviar_video");
    expect(decideChat(0.5, "x", ready, seq(0.99, 0.5)).action).toBe("responder");
    expect(decideChat(0.5, "x", { ...ready, sinceLastVideo: 1 }, seq(0.99, 0.05)).action).toBe("responder");
    expect(decideChat(0.5, "x", { ...ready, words: 2 }, seq(0.99, 0.05)).action).toBe("responder");
  });
});

describe("busca de vídeo (RAG)", () => {
  const topics = [
    { slug: "animais", name: "Animais" },
    { slug: "comida", name: "Comida" },
    { slug: "receitas_da_vo", name: "Receitas da vó" },
  ];

  it("busca só o assunto do pedido", () => {
    expect(videoQuery("Me manda um vídeo de GATO?")).toBe("gato");
    expect(videoQuery("tem algum vídeo pra mim?")).toBe("mim");
    expect(videoQuery("manda um vídeo")).toBe("");
  });

  it("acha os tópicos citados por sinônimo, slug ou nome", () => {
    expect(topicsIn("fiz um bolo e meu cachorro comeu", topics)).toEqual(["animais", "comida"]);
    expect(topicsIn("receita de pão", topics)).toEqual(["comida"]);
    expect(topicsIn("hoje choveu", topics)).toEqual([]);
  });

  it("manda com tópico citado no pedido; sem pedido, exige destaque", () => {
    const m = (z: number, topicMatch: boolean): VideoMatch => ({ id: "v", title: null, description: null, similarity: 0.6, affinity: 0.3, z, topicMatch });
    expect(goodMatch(m(0.4, true), true)).toBe(true);
    expect(goodMatch(m(2, false), true)).toBe(false); // "vídeo de tricô": parecido com nada em especial
    expect(goodMatch(m(3, false), true)).toBe(true);
    expect(goodMatch(m(1, true), false)).toBe(false);
    expect(goodMatch(m(1.6, true), false)).toBe(true);
    expect(goodMatch(m(3, false), false)).toBe(true);
  });
});

describe("apresentação do vídeo", () => {
  const title = "Shorts in Minecraft - Dentist (Animation) #shorts";
  it("descarta o texto que só repete o título", () => {
    expect(onlyTitle("Shorts in Minecraft - Dentist (Animation) #shorts", title)).toBe(true);
    expect(onlyTitle("Vídeo: Shorts in Minecraft - Dentist (Animation) #shorts", title)).toBe(true);
    expect(onlyTitle("kkkk olha esse dentista no Minecraft", title)).toBe(false);
    expect(onlyTitle("qualquer coisa", null)).toBe(false);
  });
});

describe("título no prompt", () => {
  it("tira hashtags e enfeites que confundem o modelo", () => {
    expect(promptTitle("COMIDA DE RUA * Pastel * recheio diferente #shorts")).toBe("COMIDA DE RUA Pastel recheio diferente");
    expect(promptTitle("#shorts #fyp")).toBe("sem título");
    expect(promptTitle(null)).toBe("sem título");
  });
});

describe("JEV das personas entre si", () => {
  it("responde sempre antes do mínimo, nunca depois do máximo, e no meio depende da atividade", () => {
    expect(decideTalk(0.2, 1, "olha esse", () => 0.99).action).toBe("responder");
    expect(decideTalk(0.9, TALK_JEV.maxMessages, "olha esse", () => 0).action).toBe("ignorar");
    // 3 mensagens: chance 0,3 + 0,4 × atividade.
    expect(decideTalk(0.9, 3, "olha esse", () => 0.6).action).toBe("responder");
    expect(decideTalk(0.2, 3, "olha esse", () => 0.6).action).toBe("ignorar");
  });

  it("no grupo, só as duas maiores notas comentam; quem fica no meio só reage", () => {
    const out = decideGroup(
      [
        { id: "valdir", activity: 0.9, affinity: 0.9 },
        { id: "kelly", activity: 0.7, affinity: 0.9 },
        { id: "neide", activity: 0.6, affinity: 0.9 },
        { id: "rato", activity: 0.2, affinity: 0.1 },
      ],
      () => 0.5,
    );
    expect(Object.fromEntries(out.map((d) => [d.id, d.action]))).toEqual({ valdir: "comentar", kelly: "comentar", neide: "reagir", rato: "ignorar" });
  });
});
