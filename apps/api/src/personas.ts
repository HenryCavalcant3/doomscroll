import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

/** Formato de personas/<apelido>.json (SPEC 7.3). Qualquer pessoa pode mandar uma persona por pull request. */
export interface Persona {
  apelido: string;
  nome: string;
  avatar: string;
  bio: string;
  tom: string;
  exemplos: string[];
  /** 0 a 1: quanto a persona interage. */
  atividade: number;
  /** slug do tópico -> 0 a 1. */
  afinidade: Record<string, number>;
  /** apelido de outra persona -> como ela vê essa persona (opcional). */
  relacoes?: Record<string, string>;
}

/** Pasta personas/ na raiz do repositório (em dev e na imagem, onde fica em /app/personas). */
export const DEFAULT_PERSONAS_DIR = fileURLToPath(new URL("../../../personas", import.meta.url));

const text = (v: unknown, min: number, max: number) => typeof v === "string" && v.trim().length >= min && v.length <= max;
const unit = (v: unknown) => typeof v === "number" && v >= 0 && v <= 1;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Valida uma persona e devolve a lista de problemas (vazia quando está tudo certo). */
export function validatePersona(data: unknown, fileName: string, avatarFiles: Set<string>): string[] {
  if (!isObject(data)) return ["o arquivo precisa ser um objeto JSON"];
  const errors: string[] = [];
  const { apelido, nome, avatar, bio, tom, exemplos, atividade, afinidade, relacoes } = data;
  if (typeof apelido !== "string" || !/^[a-z0-9_]{3,30}$/.test(apelido)) {
    errors.push("apelido: de 3 a 30 letras minúsculas, números ou _");
  } else if (fileName !== `${apelido.replace(/_/g, "-")}.json`) {
    errors.push(`o arquivo deve se chamar ${apelido.replace(/_/g, "-")}.json`);
  }
  if (!text(nome, 2, 40)) errors.push("nome: de 2 a 40 caracteres");
  if (typeof avatar !== "string" || !/^[a-z0-9-]+\.svg$/.test(avatar)) {
    errors.push("avatar: nome de um arquivo .svg da pasta personas");
  } else if (!avatarFiles.has(avatar)) {
    errors.push(`avatar: ${avatar} não existe na pasta personas`);
  }
  if (!text(bio, 10, 300)) errors.push("bio: de 10 a 300 caracteres");
  if (!text(tom, 10, 300)) errors.push("tom: de 10 a 300 caracteres");
  if (!Array.isArray(exemplos) || exemplos.length < 3 || exemplos.length > 10 || !exemplos.every((e) => text(e, 2, 200))) {
    errors.push("exemplos: de 3 a 10 frases de até 200 caracteres");
  }
  if (!unit(atividade)) errors.push("atividade: número de 0 a 1");
  if (!isObject(afinidade) || !Object.entries(afinidade).every(([k, v]) => /^[a-z0-9-]+$/.test(k) && unit(v))) {
    errors.push("afinidade: objeto { slug do tópico: número de 0 a 1 }");
  }
  if (relacoes !== undefined && (!isObject(relacoes) || !Object.values(relacoes).every((v) => text(v, 2, 200)))) {
    errors.push("relacoes: objeto { apelido: frase curta }");
  }
  return errors;
}

/** Lê e valida todas as personas da pasta. Qualquer arquivo inválido impede a subida, com a lista de erros. */
export async function loadPersonas(dir: string): Promise<Persona[]> {
  const files = await readdir(dir);
  const avatars = new Set(files.filter((f) => f.endsWith(".svg")));
  const personas: Persona[] = [];
  const problems: string[] = [];
  for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
    let data: unknown;
    try {
      data = JSON.parse(await readFile(join(dir, file), "utf8"));
    } catch (err) {
      problems.push(`${file}: JSON inválido (${(err as Error).message})`);
      continue;
    }
    const errors = validatePersona(data, file, avatars);
    if (errors.length) problems.push(...errors.map((e) => `${file}: ${e}`));
    else personas.push(data as Persona);
  }
  if (problems.length) throw new Error(`Personas inválidas:\n- ${problems.join("\n- ")}`);
  return personas;
}

/**
 * Cria ou atualiza o usuário e o registro de cada persona. Roda a cada subida, então editar o JSON
 * e reiniciar a api basta para a mudança valer.
 */
export async function syncPersonas(pool: Pool, personas: Persona[], log: (msg: string) => void): Promise<void> {
  for (const p of personas) {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (nickname, avatar, is_ai) VALUES ($1, $2, true)
       ON CONFLICT (nickname) DO UPDATE SET avatar = EXCLUDED.avatar WHERE users.is_ai
       RETURNING id`,
      [p.apelido, p.avatar],
    );
    const id = user.rows[0]?.id;
    if (!id) {
      log(`O apelido ${p.apelido} já é de um morador; a persona foi ignorada.`);
      continue;
    }
    const config = { nome: p.nome, afinidade: p.afinidade, relacoes: p.relacoes ?? {} };
    await pool.query(
      `INSERT INTO personas (user_id, bio, tone, examples, activity_level, config) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio, tone = EXCLUDED.tone, examples = EXCLUDED.examples,
         activity_level = EXCLUDED.activity_level, config = EXCLUDED.config`,
      [id, p.bio, p.tom, JSON.stringify(p.exemplos), p.atividade, JSON.stringify(config)],
    );
  }
}
