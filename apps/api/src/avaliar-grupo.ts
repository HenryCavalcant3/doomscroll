/**
 * Bancada do Grupo do Bunker (sem IA): simula milhares de mensagens de gente no grupo e mede, por
 * hora do dia, quantas falas de persona cada uma gera (com a cadeia) e quem fala mais. Serve para
 * calibrar GROUP_JEV e o ritmo das personas.
 *
 * pnpm --filter @doomscroll/api avaliar:grupo
 */
import { DEFAULT_PERSONAS_DIR, loadPersonas } from "./personas.js";
import { decideGroup, GROUP_JEV } from "./personaJev.js";
import { rhythm } from "./ritmo.js";

const RUNS = 5000;
const HOURS = [3, 8, 13, 20, 23];

const personas = await loadPersonas(DEFAULT_PERSONAS_DIR);

/** Quem mandou as últimas mensagens do grupo (cansaço), como no histórico que a api lê. */
let window: string[] = [];

/** Uma mensagem de gente (texto, sem tópico): devolve quem falou, em ordem. */
function simulate(hour: number): string[] {
  const said: string[] = [];
  window = [...window, "gente"].slice(-12);
  const all = personas.map((p) => ({ id: p.apelido, activity: p.atividade, affinity: null, rhythm: rhythm(p.ritmo, hour) }));
  // Fila de mensagens a decidir: [quem mandou, nível, para quem respondeu].
  const queue: [string | null, number, string | null][] = [[null, 0, null]];
  while (queue.length) {
    const [sender, depth, repliedTo] = queue.shift()!;
    if (depth >= GROUP_JEV.chain.length || said.length >= GROUP_JEV.maxChain) continue;
    const candidates = all
      .filter((c) => c.id !== sender)
      .map((c) => ({ ...c, repliedTo: c.id === repliedTo, recent: window.filter((w) => w === c.id).length }));
    for (const d of decideGroup(candidates, Math.random, { depth, fromHuman: sender === null })) {
      if (d.action !== "comentar" || said.length >= GROUP_JEV.maxChain) continue;
      said.push(d.id);
      window = [...window, d.id].slice(-12);
      queue.push([d.id, depth + 1, sender]);
    }
  }
  return said;
}

console.log(`Grupo do Bunker: ${RUNS} mensagens de gente por hora (texto, sem citar ninguém)\n`);
for (const hour of HOURS) {
  const counts = new Map<string, number>();
  let total = 0;
  let chains = 0;
  window = [];
  for (let i = 0; i < RUNS; i++) {
    const said = simulate(hour);
    total += said.length;
    if (said.length > 1) chains++;
    for (const id of said) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const who = [...counts].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ${Math.round((100 * n) / total)}%`);
  console.log(
    `${String(hour).padStart(2, "0")}h  falas por mensagem ${(total / RUNS).toFixed(2)}  ·  com mais de uma fala ${Math.round((100 * chains) / RUNS)}%  ·  ${who.join(", ")}`,
  );
}
