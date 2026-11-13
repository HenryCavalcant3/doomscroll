import { describe, expect, it } from "vitest";
import type { MessageView } from "./chat.js";
import { OllamaError, chatStream } from "./ollama.js";
import { LOOPED, badReply, replyProblem, buildChatMessages, cleanReply, generateReply, type ChatGenerator, messageLine, pickExamples, stopWords } from "./personaChat.js";

const tio = { id: "u-tio", nickname: "tio_valdir", name: "Tio Valdir", bio: "Tio do bunker.", tone: "Animado.", examples: ["Bom dia!", "KKKK", "Que coisa linda", "Repassem!"] };
const msg = (nickname: string, text: string | null, video: MessageView["video"] = null): MessageView => ({
  id: "m",
  conversationId: "c",
  type: video ? "video" : "text",
  text,
  video,
  reactions: [],
  createdAt: "",
  sender: { nickname, avatarUrl: null, isAi: nickname === "tio_valdir" },
});

describe("chat com persona", () => {
  it("limpa nome na frente, aspas e corta resposta longa numa frase", () => {
    expect(cleanReply('Tio Valdir: "Bom dia!"', tio)).toBe("Bom dia!");
    expect(cleanReply("@tio_valdir: oi", tio)).toBe("oi");
    const long = `${"Frase curta aqui. ".repeat(30)}fim`;
    const cut = cleanReply(long, tio, 100);
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(cut.endsWith(".")).toBe(true);
  });

  it("monta o histórico com a persona como assistant e o vídeo descrito", () => {
    const video = { id: "v", title: "Gato pula", description: "Um gato pula no sofá.", videoUrl: null, thumbUrl: null };
    const prompt = buildChatMessages(tio, "ana", "Ana gosta de gatos.", [msg("ana", "olha isso"), msg("ana", null, video), msg("tio_valdir", "KKKK")], ["KKKK"]);
    expect(prompt[0]!.content).toContain("O que você sabe de @ana: Ana gosta de gatos.");
    expect(prompt[0]!.content).toContain("- KKKK");
    expect(prompt[0]!.content).not.toContain("Repassem!");
    expect(prompt.slice(1)).toEqual([
      { role: "user", content: "olha isso" },
      { role: "user", content: "[mandou um vídeo: Gato pula — Um gato pula no sofá.]" },
      { role: "assistant", content: "KKKK" },
    ]);
    expect(messageLine(msg("ana", null, { ...video, title: null, description: null }))).toBe("[mandou um vídeo sem título nem descrição: você não sabe o que tem nele]");
  });

  it("sem memória, diz que a conversa está começando", () => {
    expect(buildChatMessages(tio, "ana", "", [])[0]!.content).toContain("vocês estão começando a conversar agora");
  });

  it("para antes de escrever a fala do outro lado e sorteia exemplos sem repetir", () => {
    expect(stopWords("ana")).toEqual(["\n\n", "@ana:", "ana:", "Você:"]);
    const picked = pickExamples(tio.examples);
    expect(new Set(picked).size).toBe(3);
  });
});

describe("resposta que não serve", () => {
  const ex = ["Ai que cachorrinho mais lindo de chapéu, Deus abençoe ❤️", "KKKK"];
  it("recusa eco da última mensagem e cópia de exemplo", () => {
    const history = [msg("ana", "O que você mais gosta de assistir aqui?")];
    expect(badReply("o que voce mais gosta de assistir aqui", ex, history)).toBe(true);
    expect(badReply("Ai que cachorrinho mais lindo, minha filha", ex, history)).toBe(true);
    expect(badReply("KKKK", ex, history)).toBe(true);
    expect(badReply("", ex, history)).toBe(true);
  });
  it("recusa repetição sem fim e resposta em inglês", () => {
    const history = [msg("ana", "você é um robô?")];
    expect(badReply("Não sou eu, sou eu sou eu sou eu sou eu sou eu, sou sou sou", [], history)).toBe(true);
    expect(replyProblem("Ah meu filho, sou que sou sou sou, sempre comovida", [], history)).toBe("gagueira");
    expect(replyProblem("Não, sou eu sou eu sou eu. Tudo bem?", [], history)).toBe("gagueira");
    expect(badReply("Hey there! Yeah, I speak English. How can I help you today?", [], history)).toBe(true);
    expect(badReply("Sou uma persona de IA, mas o bom dia é de verdade!", [], history)).toBe(false);
    expect(badReply("Adoro o show do Iron Maiden, é top", [], history)).toBe(false);
  });

  it("aceita resposta própria e palavra longa que veio da conversa", () => {
    expect(badReply("Gosto de receita e de bicho, minha filha!", ex, [msg("ana", "oi")])).toBe(false);
    expect(badReply("Que cachorrinho mais lindo, mande mais!", ex, [msg("ana", "olha esse cachorrinho")])).toBe(false);
  });
});

describe("nova tentativa", () => {
  it("tira o exemplo copiado e avisa no prompt, sem citar a resposta recusada", async () => {
    const neide = { ...tio, examples: ["Ai que cachorrinho mais lindo de chapéu", "Receita boa demais, vou fazer domingo", "Deus abençoe essa família"] };
    const prompts: string[] = [];
    const replies = ["Ai que cachorrinho mais lindo, meu filho", "Que gato sapeca, meu filho!"];
    const generate: ChatGenerator = async (messages) => {
      prompts.push(messages[0]!.content);
      return replies[prompts.length - 1]!;
    };
    const out = await generateReply(generate, neide, "ana", "", [msg("ana", "olha meu gato")], () => {}, new AbortController().signal);
    expect(out).toEqual({ text: "Que gato sapeca, meu filho!", rejected: ["Ai que cachorrinho mais lindo, meu filho"] });
    expect(prompts[0]).not.toContain("descartada");
    expect(prompts[1]).toContain("descartada");
    expect(prompts[1]).not.toContain("cachorrinho");
  });
});

describe("quando nenhuma tentativa serve", () => {
  const signal = new AbortController().signal;
  const always = (reply: string): ChatGenerator => async () => reply;
  it("manda a última com problema leve (inglês) em vez de ficar muda", async () => {
    const out = await generateReply(always("Hey there! Yes, I speak English. How can I help you?"), tio, "ana", "", [msg("ana", "do you speak english?")], () => {}, signal);
    expect(out.text).toBe("Hey there! Yes, I speak English. How can I help you?");
    expect(out.rejected).toHaveLength(3);
  });
  it("não manda eco nem gagueira", async () => {
    expect((await generateReply(always("oi"), tio, "ana", "", [msg("ana", "oi")], () => {}, signal)).text).toBe("");
    expect((await generateReply(always("sou eu sou eu sou eu"), tio, "ana", "", [msg("ana", "oi")], () => {}, signal)).text).toBe("");
  });
});

describe("repetição sem fim", () => {
  it("conta como tentativa recusada e tenta de novo; outro erro do Ollama sobe", async () => {
    let calls = 0;
    const looping: ChatGenerator = async () => {
      if (calls++ === 0) throw new OllamaError("Erro do Ollama: prediction aborted, token repeat limit reached", 502);
      return "Que risada boa!";
    };
    const signal = new AbortController().signal;
    expect(await generateReply(looping, tio, "ana", "", [msg("ana", "😂😂😂")], () => {}, signal)).toEqual({ text: "Que risada boa!", rejected: [LOOPED] });
    const down: ChatGenerator = async () => {
      throw new OllamaError("Não foi possível falar com o Ollama.", 502);
    };
    await expect(generateReply(down, tio, "ana", "", [msg("ana", "oi")], () => {}, signal)).rejects.toThrow("Não foi possível");
  });
});

describe("streaming do Ollama", () => {
  it("junta linhas partidas entre pedaços e devolve o texto inteiro", async () => {
    const lines = ['{"message":{"content":"Bom "},"done":false}\n{"mess', 'age":{"content":"dia!"},"done":false}\n', '{"message":{"content":""},"done":true}'];
    const body = new ReadableStream({
      start(c) {
        for (const l of lines) c.enqueue(new TextEncoder().encode(l));
        c.close();
      },
    });
    const fetchImpl = (async () => new Response(body, { status: 200 })) as typeof fetch;
    const seen: string[] = [];
    const full = await chatStream({ baseUrl: "http://x", model: "m", messages: [], timeoutMs: 1000, fetchImpl }, (t) => seen.push(t));
    expect(full).toBe("Bom dia!");
    expect(seen).toEqual(["Bom ", "Bom dia!"]);
  });
});
