import { createContext, useContext, useEffect, useLayoutEffect, useRef } from "react";
import type { Conversation, Message } from "./api";
import type { Realtime, RealtimeEvent } from "./realtime";

/** Junta mensagens sem repetir (pelo id), em ordem de envio. */
export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Nome da conversa: o do grupo ou o apelido de quem está do outro lado. */
export const conversationTitle = (c: Conversation) => c.name ?? (c.members.map((m) => m.nickname).join(", ") || "Conversa");

/** Hora (hoje), "ontem" ou dia/mês. */
export function shortTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export const RealtimeContext = createContext<Realtime | null>(null);

/** Recebe os avisos em tempo real enquanto o componente está na tela. */
export function useRealtimeEvents(fn: (event: RealtimeEvent) => void) {
  const rt = useContext(RealtimeContext);
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  useEffect(() => rt?.subscribe((e) => latest.current(e)), [rt]);
}
