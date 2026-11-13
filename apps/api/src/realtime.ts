import type { MessageView } from "./chat.js";

/** Avisos mandados pelo WebSocket. O cliente busca o resto pelo REST. */
export type RealtimeEvent = { type: "ready" } | { type: "message"; message: MessageView };

/** Códigos de fechamento: o cliente não tenta reconectar com sessão inválida. */
export const WS_CLOSE = { noAuth: 4000, badSession: 4001 } as const;

export interface Peer {
  send(data: string): void;
  readonly readyState: number;
}

const OPEN = 1;

/** Conexões abertas por usuário (uma api só, então tudo em memória). */
export class Hub {
  private readonly peers = new Map<string, Set<Peer>>();

  /** Registra a conexão e devolve a função que a remove. */
  add(userId: string, peer: Peer): () => void {
    let set = this.peers.get(userId);
    if (!set) this.peers.set(userId, (set = new Set()));
    set.add(peer);
    return () => {
      set.delete(peer);
      if (set.size === 0 && this.peers.get(userId) === set) this.peers.delete(userId);
    };
  }

  send(userIds: Iterable<string>, event: RealtimeEvent) {
    const data = JSON.stringify(event);
    for (const id of new Set(userIds)) {
      for (const peer of this.peers.get(id) ?? []) {
        if (peer.readyState === OPEN) peer.send(data);
      }
    }
  }

  /** Quantas conexões o usuário tem abertas (usado nos testes). */
  count(userId: string) {
    return this.peers.get(userId)?.size ?? 0;
  }
}
