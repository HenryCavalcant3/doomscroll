export interface TopicOption {
  slug: string;
  name: string;
}

export interface VideoText {
  title: string | null;
  hashtags: string[];
  transcript: string | null;
}

export interface Suggestion {
  topics: string[];
  description: string;
}

/** Dimensão da coluna vector(768) no banco, igual à do nomic-embed-text. */
export const EMBED_DIM = 768;
const MAX_TRANSCRIPT = 1500;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function describeVideo(v: VideoText): string {
  const tags = v.hashtags.length ? v.hashtags.map((h) => `#${h}`).join(" ") : "(nenhuma)";
  const transcript = v.transcript ? clip(v.transcript, MAX_TRANSCRIPT) : "(sem fala)";
  return `Título: ${clip(v.title ?? "(sem título)", 200)}\nHashtags: ${tags}\nTranscrição: ${transcript}`;
}

/** Prompt curto com exemplos: modelos pequenos imitam melhor do que seguem descrição (SPEC 7.1). */
export function buildTopicPrompt(video: VideoText, topics: TopicOption[]): string {
  const list = topics.map((t) => `- ${t.slug} (${t.name})`).join("\n");
  return `Você classifica vídeos curtos de uma rede social brasileira.

Tópicos permitidos (use exatamente estes códigos):
${list}

Regras:
- Quase sempre 1 tópico basta: o assunto PRINCIPAL do vídeo.
- Use 2 só se o vídeo for claramente das duas coisas ao mesmo tempo. Nunca chute.
- Se nenhum tópico servir, devolva a lista vazia.
- Escreva uma descrição de uma frase curta (até 120 caracteres), sem hashtags, SEMPRE em português do Brasil correto, mesmo que o vídeo seja em outra língua.
- A transcrição é automática e pode ter palavras erradas: descreva só o que está claro.
- Responda só com JSON.

Exemplo 1
Título: Cachorro aprende a abrir a porta sozinho
Hashtags: #cachorro #pet
Transcrição: olha ele empurrando a maçaneta com a pata
{"topicos": ["animais"], "descricao": "Cachorro aprende a abrir a porta com a pata."}

Exemplo 2
Título: Previsão de chuva forte no fim de semana
Hashtags: #tempo
Transcrição: a defesa civil alerta para temporais em todo o estado
{"topicos": ["noticias"], "descricao": "Alerta de temporais para o fim de semana."}

Exemplo 3
Título: Feeding the ducks at the park
Hashtags: #ducks
Transcrição: look at them coming, they love the bread, so cute
{"topicos": ["animais"], "descricao": "Patos correm para ganhar pão no parque."}

Exemplo 4
Título: Gato derruba copo da mesa e finge que não foi ele
Hashtags: #gato #engraçado
Transcrição: (risos) olha a cara dele, não fui eu
{"topicos": ["animais", "humor"], "descricao": "Gato derruba um copo e finge inocência."}

Agora este vídeo:
${describeVideo(video)}
`;
}

/** Schema passado ao Ollama: a saída só pode conter códigos de tópicos existentes. */
export function topicSchema(slugs: string[]) {
  return {
    type: "object",
    properties: {
      topicos: { type: "array", items: { type: "string", enum: slugs }, maxItems: 3 },
      descricao: { type: "string" },
    },
    required: ["topicos", "descricao"],
  };
}

/** Confere a resposta do modelo mesmo com o schema: só tópicos válidos, no máximo 3, descrição curta. */
export function parseSuggestion(raw: string, slugs: string[], fallbackDescription: string | null): Suggestion {
  let data: { topicos?: unknown; descricao?: unknown } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    // resposta inválida: segue com valores vazios
  }
  const allowed = new Set(slugs);
  const topics = Array.isArray(data.topicos)
    ? [...new Set(data.topicos.filter((t): t is string => typeof t === "string" && allowed.has(t)))].slice(0, 3)
    : [];
  let description = typeof data.descricao === "string" ? data.descricao.replace(/\s+/g, " ").trim() : "";
  if (!description) description = fallbackDescription ?? "";
  return { topics, description: clip(description, 200) };
}

/** Texto do vídeo usado para o embedding (prefixo de documento do nomic-embed-text). */
export function embeddingText(v: VideoText & { description: string | null }): string {
  const parts = [v.title, v.description, v.hashtags.map((h) => `#${h}`).join(" "), v.transcript && clip(v.transcript, 2000)];
  return `search_document: ${parts.filter(Boolean).join("\n")}`;
}

/** Persona como o worker a lê do banco (carregada de personas/*.json pela api). */
export interface PersonaProfile {
  userId: string;
  nickname: string;
  name: string;
  bio: string;
  tone: string;
  examples: string[];
}

/** O que a persona sabe do vídeo para comentar. A transcrição fica de fora: é longa e às vezes errada. */
export interface VideoForComment {
  title: string | null;
  description: string | null;
  topics: string[];
}

export const MAX_COMMENT = 160;

/**
 * Prompt do comentário pré-gerado (SPEC 5.1, passo 6). O tema apocalipse aparece só às vezes,
 * decidido por sorteio fora do modelo (SPEC 7.1: decisões por pesos, LLM só gera texto).
 */
export function buildCommentPrompt(persona: PersonaProfile, video: VideoForComment, apocalypse: boolean): string {
  const examples = persona.examples.map((e) => `- ${e}`).join("\n");
  const theme = apocalypse
    ? "- Desta vez, termine com uma piada curta sobre guardar o vídeo para quando a internet acabar ou sobre a vida no bunker."
    : "- Não fale de fim do mundo, apocalipse nem bunker. Reaja como uma pessoa comum.";
  return `Você é ${persona.name}, usuário de uma rede social brasileira de vídeos curtos.
Quem você é: ${persona.bio}
Seu jeito de escrever: ${persona.tone}

Frases suas (imite o estilo, não copie):
${examples}

Regras:
- Escreva UM comentário curto, de uma ou duas frases (até ${MAX_COMMENT - 60} caracteres), em português do Brasil.
- Escreva do jeito das suas frases acima: mesmas expressões, mesma pontuação, mesmos emojis.
- Reaja ao assunto do vídeo como quem comenta no celular. Não resuma o vídeo e não elogie a técnica.
- Sem hashtags e sem aspas.
${theme}
- Responda só com JSON: {"comentario": "..."}

Vídeo:
Título: ${clip(video.title ?? "(sem título)", 200)}
Descrição: ${video.description || "(sem descrição)"}
Tópicos: ${video.topics.join(", ") || "(nenhum)"}
`;
}

export const commentSchema = {
  type: "object",
  properties: { comentario: { type: "string" } },
  required: ["comentario"],
};

/** Limpa a resposta do modelo; devolve null se não sobrar um comentário usável. */
export function parseComment(raw: string): string | null {
  let data: { comentario?: unknown };
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data.comentario !== "string") return null;
  const text = data.comentario
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  if (text.length < 2) return null;
  return clip(text, MAX_COMMENT);
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .trim();

/** true quando o comentário é só uma frase de exemplo da persona repetida. */
export function copiesExample(text: string, examples: string[]): boolean {
  const t = normalize(text);
  return examples.some((e) => normalize(e) === t);
}

export class OllamaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly llmModel: string,
    private readonly embedModel: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post<T>(path: string, body: object): Promise<T> {
    const res = await this.fetchImpl(new URL(path, this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) throw new Error(`Ollama respondeu ${res.status} em ${path}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  async suggest(video: VideoText, topics: TopicOption[]): Promise<Suggestion> {
    const slugs = topics.map((t) => t.slug);
    const data = await this.post<{ response: string }>("/api/generate", {
      model: this.llmModel,
      prompt: buildTopicPrompt(video, topics),
      format: topicSchema(slugs),
      stream: false,
      options: { temperature: 0, num_ctx: 4096 },
    });
    return parseSuggestion(data.response, slugs, video.title);
  }

  async comment(persona: PersonaProfile, video: VideoForComment, apocalypse: boolean): Promise<string> {
    let last = "";
    // O modelo pequeno às vezes devolve uma das frases de exemplo inteira: nesse caso tenta de novo.
    for (let attempt = 0; attempt < 3; attempt++) {
      const data = await this.post<{ response: string }>("/api/generate", {
        model: this.llmModel,
        prompt: buildCommentPrompt(persona, video, apocalypse),
        format: commentSchema,
        stream: false,
        // Um pouco de variação: comentários iguais em todo vídeo ficariam artificiais.
        options: { temperature: 0.8, num_ctx: 4096, num_predict: 120 },
      });
      last = data.response;
      const text = parseComment(data.response);
      if (text && !copiesExample(text, persona.examples)) return text;
    }
    throw new Error(`Comentário vazio, inválido ou copiado do exemplo: ${last.slice(0, 120)}`);
  }

  async embed(text: string): Promise<number[]> {
    const data = await this.post<{ embeddings: number[][] }>("/api/embed", { model: this.embedModel, input: text });
    const vector = data.embeddings[0];
    if (!vector) throw new Error("O Ollama não devolveu embedding.");
    if (vector.length !== EMBED_DIM) {
      throw new Error(
        `O modelo ${this.embedModel} gera vetores de ${vector.length} dimensões, mas o banco espera ${EMBED_DIM}. ` +
          "Use nomic-embed-text ou ajuste a coluna embedding.",
      );
    }
    return vector;
  }
}
