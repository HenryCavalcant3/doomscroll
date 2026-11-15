import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

/** Pautas de fofoca do Boletim do Bunker (docs/boletim/BOLETIM.md), usadas quando não há fato curioso real. */
export const DEFAULT_PAUTAS_FILE = fileURLToPath(new URL("../../../docs/boletim/pautas.json", import.meta.url));

/** Único marcador aceito no texto: trocado por outra persona, nunca por um morador. */
export const PERSONA_SLOT = "{persona}";

export interface Pauta {
  id: string;
  texto: string;
  ativa: boolean;
}

const ID = /^[a-z0-9-]+$/;

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Problemas de uma pauta (texto do dono ou do arquivo); lista vazia quando está boa. Com os apelidos
 * dos moradores, recusa pauta que cita alguém de verdade (regra fixa 4: a fofoca nunca é sobre morador).
 */
export function pautaErrors(texto: unknown, residents: string[] = []): string[] {
  if (typeof texto !== "string" || !texto.trim()) return ["texto vazio"];
  const errors: string[] = [];
  if (texto.length > 200) errors.push("texto com mais de 200 caracteres");
  // Regra fixa 3: número só vem do SQL, e a pauta vai para a LLM reescrever.
  if (/\d/.test(texto)) errors.push("texto com número (escreva por extenso)");
  const rest = texto.split(PERSONA_SLOT).join("");
  if (/[{}]/.test(rest)) errors.push(`só o marcador ${PERSONA_SLOT} é aceito entre chaves`);
  if (texto.split(PERSONA_SLOT).length > 2) errors.push(`${PERSONA_SLOT} aparece mais de uma vez`);
  if (rest.includes("@")) errors.push("texto com @ (pauta não chama ninguém)");
  const words = new Set(plain(rest).split(/[^a-z0-9_]+/));
  const named = residents.filter((n) => words.has(plain(n)));
  if (named.length) errors.push(`texto cita morador (${named.join(", ")}): use ${PERSONA_SLOT} ou ninguém`);
  return errors;
}

/** Valida o conteúdo do pautas.json. Qualquer pauta inválida impede a subida, com a lista de erros. */
export function parsePautas(data: unknown): Pauta[] {
  const list = typeof data === "object" && data !== null ? (data as { pautas?: unknown }).pautas : undefined;
  if (!Array.isArray(list)) throw new Error("Pautas inválidas: falta a lista \"pautas\".");
  const problems: string[] = [];
  const seen = new Set<string>();
  const pautas: Pauta[] = [];
  list.forEach((item: unknown, i) => {
    const p = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const where = typeof p.id === "string" ? p.id : `#${i + 1}`;
    const errors = pautaErrors(p.texto);
    if (typeof p.id !== "string" || !ID.test(p.id)) errors.push("id precisa ser minúsculo, com letras, números e hífen");
    else if (seen.has(p.id)) errors.push("id repetido");
    if (typeof p.ativa !== "boolean") errors.push("ativa precisa ser true ou false");
    if (errors.length) problems.push(...errors.map((e) => `${where}: ${e}`));
    else {
      seen.add(p.id as string);
      pautas.push({ id: p.id as string, texto: p.texto as string, ativa: p.ativa as boolean });
    }
  });
  if (problems.length) throw new Error(`Pautas inválidas:\n- ${problems.join("\n- ")}`);
  return pautas;
}

/** Id de uma pauta nova, tirado das primeiras palavras do texto ("gerador-fez-barulho"). */
export function pautaId(texto: string): string {
  const words = plain(texto.split(PERSONA_SLOT).join(" ")).split(/[^a-z0-9]+/).filter(Boolean);
  let id = "";
  for (const w of words) {
    if (id && (id + "-" + w).length > 30) break;
    id = id ? `${id}-${w}` : w.slice(0, 30);
  }
  return id || "pauta";
}

export async function loadPautas(file: string): Promise<Pauta[]> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    throw new Error(`Pautas: não consegui ler ${file} (${(err as Error).message})`, { cause: err });
  }
  return parsePautas(data);
}

/**
 * Grava as pautas que ainda não existem. Ao contrário das personas, não atualiza as que já estão
 * no banco: depois da primeira subida, quem manda é o painel do dono. Devolve quantas entraram.
 */
export async function syncPautas(pool: Pool, pautas: Pauta[]): Promise<number> {
  let added = 0;
  for (const p of pautas) {
    const res = await pool.query("INSERT INTO gossip_topics (id, text, active) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING", [
      p.id,
      p.texto,
      p.ativa,
    ]);
    added += res.rowCount ?? 0;
  }
  return added;
}
