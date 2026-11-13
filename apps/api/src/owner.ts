import type { Pool } from "pg";
import { generatePin, hashPin } from "./pin.js";

/**
 * Garante que existe um dono do bunker. Na primeira subida cria o usuário "dono" com o OWNER_PIN
 * ou, sem ele, com um PIN aleatório que é mostrado uma única vez no log.
 * O dono entra no app como qualquer pessoa, com o apelido "dono" e esse PIN.
 */
export async function ensureOwner(pool: Pool, ownerPin: string | undefined, log: (msg: string) => void): Promise<void> {
  const existing = await pool.query("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1");
  if (existing.rowCount) return;

  const pin = ownerPin || generatePin();
  const res = await pool.query(
    "INSERT INTO users (nickname, pin_hash, role) VALUES ('dono', $1, 'owner') ON CONFLICT (nickname) DO NOTHING",
    [await hashPin(pin)],
  );
  if (!res.rowCount) return;
  if (ownerPin) {
    log("Dono do bunker criado com o PIN definido em OWNER_PIN.");
  } else {
    log(`Dono do bunker criado. PIN gerado: ${pin} (anote; ele não será mostrado de novo).`);
  }
}
