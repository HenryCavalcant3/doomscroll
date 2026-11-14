import { describe, expect, it } from "vitest";
import { goodMatch, onlyTitle, promptTitle, type VideoMatch } from "./personaChat.js";
import { CHAT_JEV, GROUP_JEV, PAUSE, TALK_JEV, asksForVideo, decideChat, decideGroup, decideTalk, mentionsIn, quickPause, reactionFor, talkPause, topicsIn, videoQuery } from "./personaJev.js";

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

  const group = [
    { id: "valdir", activity: 0.9, affinity: 0.9 },
    { id: "kelly", activity: 0.7, affinity: 0.9 },
    { id: "rato", activity: 0.2, affinity: 0.1 },
  ];
  const actions = (out: { id: string; action: string }[]) => Object.fromEntries(out.map((d) => [d.id, d.action]));

  it("na cadeia, só uma persona comenta, e o sorteio do nível pode calar todo mundo", () => {
    // Nível 1: o sorteio (0,1) passa na chance de 0,5, e o sorteio pesado cai no Valdir; só ele comenta.
    expect(actions(decideGroup(group, () => 0.1, { depth: 1, fromHuman: false }))).toMatchObject({ valdir: "comentar", kelly: "reagir" });
    // Nível 2: o mesmo sorteio que passava no 1 (0,3) não passa na chance de 0,2.
    const rolls = [0.5, 0.5, 0.5, 0.3];
    expect(actions(decideGroup(group, () => rolls.shift()!, { depth: 2, fromHuman: false }))).not.toContain("comentar");
    // Nível 3: ninguém, nem com sorteio zero.
    expect(Object.values(actions(decideGroup(group, () => 0, { depth: 3, fromHuman: false })))).not.toContain("comentar");
  });

  it("quem é citado por gente comenta mesmo com nota baixa; citado por persona, ganha bônus", () => {
    const cited = group.map((c) => ({ ...c, mentioned: c.id === "rato" }));
    const byHuman = decideGroup(cited, () => 0.5);
    expect(actions(byHuman)).toEqual({ rato: "comentar", valdir: "comentar", kelly: "reagir" });
    expect(byHuman.find((d) => d.id === "rato")!.reasons).toMatchObject({ mencao: true });
    // Citado por persona no nível 1: a chance do nível sobe para 0,7 e o Rato ganha o bônus no sorteio (aqui sai a Kelly).
    const byPersona = decideGroup(cited, () => 0.6, { depth: 1, fromHuman: false });
    expect(actions(byPersona).rato).not.toBe("comentar");
    expect(byPersona.find((d) => d.id === "rato")!.score).toBeCloseTo(0.1 + 0.04 + 0.03 + GROUP_JEV.mentionBonus);
  });

  it("mensagem de gente sempre tem ao menos uma resposta, sorteada pela nota; na cadeia, só se o nível deixar", () => {
    // Madrugada: Valdir e Neide fora do ritmo, Rato no pico.
    const night = [
      { id: "neide", activity: 0.5, affinity: null, rhythm: 0.4 },
      { id: "rato", activity: 0.2, affinity: null, rhythm: 1 },
      { id: "valdir", activity: 0.9, affinity: null, rhythm: 0.4 },
    ];
    // Ninguém chega a 0,6; o sorteio (0,5) cai no Rato (nota 0,22 contra 0,23 do Valdir e 0,15 da Neide).
    const out = decideGroup(night, () => 0.5);
    expect(actions(out)).toEqual({ neide: "ignorar", rato: "comentar", valdir: "ignorar" });
    expect(out.find((d) => d.id === "rato")!.reasons).toMatchObject({ resposta_garantida: true });
    // Nível 1: sorteio 0,6 não passa na chance de 0,5.
    expect(Object.values(actions(decideGroup(night, () => 0.6, { depth: 1, fromHuman: false })))).not.toContain("comentar");
    // Vídeo do agendador no grupo (de persona) não força ninguém.
    expect(Object.values(actions(decideGroup(night, () => 0.5, { depth: 0, fromHuman: false })))).not.toContain("comentar");
  });

  it("quem falou muito há pouco perde nota (cansaço), até um teto", () => {
    const [fresh] = decideGroup([{ id: "valdir", activity: 0.9, affinity: null }], () => 0.5);
    const [tired] = decideGroup([{ id: "valdir", activity: 0.9, affinity: null, recent: 10 }], () => 0.5);
    expect(fresh!.score - tired!.score).toBeCloseTo(GROUP_JEV.maxRecentPenalty);
    expect(tired!.reasons).toMatchObject({ cansaco: -GROUP_JEV.maxRecentPenalty });
  });

  it("fora do ritmo a nota cai, e quem recebeu a resposta ganha bônus", () => {
    const [night] = decideGroup([{ id: "neide", activity: 0.6, affinity: 0.5, rhythm: 0.4 }], () => 0.5);
    const [day] = decideGroup([{ id: "neide", activity: 0.6, affinity: 0.5 }], () => 0.5);
    expect(day!.score - night!.score).toBeCloseTo((0.5 * 0.6 + 0.4 * 0.5) * 0.6);
    expect(night!.reasons).toMatchObject({ ritmo: 0.4 });
    const [back] = decideGroup([{ id: "neide", activity: 0.6, affinity: 0.5, repliedTo: true }], () => 0.5);
    expect(back!.score - day!.score).toBeCloseTo(GROUP_JEV.replyBonus);
  });
});

describe("menções e pausas", () => {
  const personas = [
    { id: "u-neide", nickname: "dona_neide", name: "Dona Neide" },
    { id: "u-cap", nickname: "capitao_enlatado", name: "Capitão Enlatado" },
    { id: "u-rato", nickname: "rato", name: "Rato" },
  ];

  it("acha quem foi citado pelo @apelido ou por uma palavra do nome", () => {
    expect(mentionsIn("@dona_neide a senhora viu?", personas)).toEqual(["u-neide"]);
    expect(mentionsIn("Neide, e o bolo?", personas)).toEqual(["u-neide"]);
    expect(mentionsIn("capitao, quantas latas?", personas)).toEqual(["u-cap"]);
    expect(mentionsIn("e o Rato sumiu de novo", personas)).toEqual(["u-rato"]);
    // "Dona" sozinho não identifica ninguém.
    expect(mentionsIn("dona de casa também treina", personas)).toEqual([]);
  });

  it("a pausa quase sempre é curta, às vezes uns minutos, e nunca passa do teto", () => {
    expect(talkPause(40, () => 0)).toBe(10);
    expect(talkPause(40, () => 0.79)).toBeLessThanOrEqual(40);
    const rolls = [0.9, 0];
    expect(talkPause(40, () => rolls.shift()!)).toBe(60);
    const max = PAUSE.bands.at(-1)!.to * 40;
    for (let i = 0; i < 200; i++) expect(talkPause(40)).toBeLessThanOrEqual(max);
    expect(max).toBe(300);
    expect(quickPause(40, () => 0.99)).toBeLessThanOrEqual(40);
  });
});
