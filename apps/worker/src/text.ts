/** Limpeza dos textos que chegam de fora (Whisper e plataforma) antes de irem para a IA. */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Tira da transcrição as marcações que o Whisper põe no lugar de som sem fala ("[MÚSICA]",
 * "(upbeat music)", "♪") e descarta o que sobra quando não parece fala de verdade: menos de 3
 * palavras ou texto que é a mesma coisa repetida (o Whisper inventa frases sobre música).
 */
export function cleanTranscript(raw: string): string {
  const text = raw
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫🎵🎶]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < 3) return "";
  if (words.length >= 8 && new Set(words).size / words.length < 0.3) return "";
  return text;
}

/** Descrição escrita por quem postou: sem links, hashtags e menções, só o texto. */
export function cleanSourceDescription(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#@][\p{L}\p{N}_.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length >= 3 ? clip(text, 500) : null;
}

/** A IA às vezes descreve a própria dificuldade ("transcrição confusa…") em vez do vídeo. */
export function isMetaDescription(description: string): boolean {
  return /transcri|[áa]udio|n[ãa]o (foi poss[íi]vel|identifiquei|entendi|[ée] poss[íi]vel)|t[óo]pico|informa[çc][õo]es insuficientes/i.test(
    description,
  );
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];

/**
 * true quando o comentário copia uma frase de exemplo inteira ou um pedaço específico dela
 * (3 palavras seguidas com uma palavra longa que não aparece no vídeo, como "churrasco da família"
 * num vídeo de gato). Expressões curtas do jeito da persona ("que coisa linda") continuam valendo.
 */
export function copiesExample(text: string, examples: string[], videoText = ""): boolean {
  const words = normalize(text);
  const videoWords = new Set(normalize(videoText));
  for (const example of examples) {
    const ex = normalize(example);
    if (ex.join(" ") === words.join(" ")) return true;
    const grams = new Set<string>();
    for (let i = 0; i + 3 <= ex.length; i++) grams.add(ex.slice(i, i + 3).join(" "));
    for (let i = 0; i + 3 <= words.length; i++) {
      const gram = words.slice(i, i + 3);
      const long = gram.filter((w) => w.length >= 6);
      if (grams.has(gram.join(" ")) && long.length > 0 && long.every((w) => !videoWords.has(w))) return true;
    }
  }
  return false;
}
