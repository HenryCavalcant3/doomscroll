import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Primeira linha da saída de `<cmd> <args>`, ou null se a ferramenta não existir. */
export async function toolVersion(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run(cmd, args);
    return stdout.split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}
