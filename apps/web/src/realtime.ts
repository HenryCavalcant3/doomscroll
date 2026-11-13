import type { Message, Reaction } from "./api";

/** Avisos da api pelo WebSocket. "ready" chega a cada (re)conexão: hora de buscar o que perdeu. */
export type RealtimeEvent =
  | { type: "ready" }
  | { type: "message"; message: Message }
  | { type: "reaction"; conversationId: string; messageId: string; reactions: Reaction[] }
  /** Conversa nova (grupo) em que você entrou. */
  | { type: "conversation"; conversationId: string };

type Listener = (event: RealtimeEvent) => void;

/** Fechamento com sessão inválida (mesmo código da api): não adianta reconectar. */
export const BAD_SESSION = 4001;
const MAX_DELAY_MS = 30_000;

export interface RealtimeOptions {
  url: () => string;
  /** Trocado nos testes. */
  WebSocketImpl?: typeof WebSocket;
  onBadSession?: () => void;
}

/**
 * Conexão de avisos em tempo real. Manda o token como primeira mensagem (não vai na URL) e
 * reconecta sozinha com espera crescente até 30 s, a não ser que a sessão seja recusada.
 */
export class Realtime {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private retries = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly opts: RealtimeOptions) {}

  start(token: string) {
    this.stop();
    this.token = token;
    this.retries = 0;
    this.open();
  }

  stop() {
    this.token = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
  }

  /** Reconecta já (ex.: o celular voltou da tela apagada), se estiver esperando para tentar. */
  wake() {
    if (this.token && !this.ws) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.open();
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private open() {
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    const ws = new Impl(this.opts.url());
    this.ws = ws;
    ws.onopen = () => {
      if (this.token) ws.send(JSON.stringify({ type: "auth", token: this.token }));
    };
    ws.onmessage = (e: MessageEvent) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(String(e.data)) as RealtimeEvent;
      } catch {
        return;
      }
      if (event.type === "ready") this.retries = 0;
      for (const fn of this.listeners) fn(event);
    };
    ws.onclose = (e: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.token) return;
      if (e.code === BAD_SESSION) {
        this.token = null;
        this.opts.onBadSession?.();
        return;
      }
      const delay = Math.min(MAX_DELAY_MS, 1000 * 2 ** this.retries++);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.open();
      }, delay);
    };
  }
}

/** Endereço do WebSocket no mesmo host do app (nginx ou proxy do Vite). */
export const wsUrl = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`;
