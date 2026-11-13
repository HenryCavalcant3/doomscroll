/**
 * Prioridade das chamadas à IA no worker (SPEC 11: chat do usuário > ingestão > personas).
 * Cada fila tem o próprio consumidor, então sem isto a ingestão e as personas disputariam o Ollama
 * ao mesmo tempo. O portão deixa uma chamada por vez e, quando libera, escolhe a de maior prioridade.
 * O chat com usuários roda na api e vai direto ao Ollama: como o worker nunca tem mais de uma chamada
 * em andamento, a resposta do chat espera no máximo uma geração.
 */
export const PRIORITY = { ingest: 0, persona: 1 } as const;

type Waiter = { priority: number; seq: number; start: () => void };

export class LlmGate {
  private busy = false;
  private seq = 0;
  private readonly waiting: Waiter[] = [];

  /** Roda `fn` quando for a vez dela; menor número passa na frente, e empate respeita a ordem de chegada. */
  async run<T>(priority: number, fn: () => Promise<T>): Promise<T> {
    if (this.busy) {
      await new Promise<void>((start) => {
        this.waiting.push({ priority, seq: this.seq++, start });
        this.waiting.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      });
    }
    this.busy = true;
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next.start();
      else this.busy = false;
    }
  }

  get pending(): number {
    return this.waiting.length;
  }
}
