import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Primeira linha da saída de `<cmd> <args>`, ou null se a ferramenta não existir. */
export async function toolVersion(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args);
    return stdout.split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Roda um programa sem shell (os argumentos nunca são interpretados) e devolve o stdout.
 * Em caso de erro, a mensagem traz o fim do stderr.
 */
export async function run(cmd: string, args: string[], timeoutMs = 15 * 60_000): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as Error & { stderr?: string; killed?: boolean };
    const detail = e.killed ? "tempo esgotado" : (e.stderr ?? "").trim().split("\n").slice(-3).join(" | ");
    throw new Error(`${cmd} falhou: ${detail || e.message}`, { cause: err });
  }
}
