/** Texto das decisões do JEV no painel do dono. */
import type { PersonaDecision } from "./api";

const ACTIONS: Record<string, string> = {
  ignorar: "ignorou",
  curtir: "curtiu",
  comentar: "comentou",
  responder: "respondeu uma mensagem",
  enviar_video: "respondeu e mandou um vídeo",
};

/** "comentou “Gato derruba copo”", "respondeu e mandou um vídeo (“Receita de bolo”)". */
export function decisionText(d: PersonaDecision): string {
  const action = ACTIONS[d.action] ?? d.action;
  if (d.trigger === "video") return `${action} “${d.video ?? "vídeo apagado"}”`;
  return typeof d.reasons.video === "string" && d.reasons.video !== "nenhum" ? `${action} (“${d.reasons.video}”)` : action;
}

const LABELS: Record<string, string> = {
  afinidade: "afinidade",
  atividade: "atividade",
  acaso: "acaso",
  recencia: "recência",
  so_curtida: "só curtida",
  pediu_video: "pediu vídeo",
  reacao: "reação",
  desde_ultimo_video: "msgs desde o último vídeo",
  palavras: "palavras",
  similaridade: "similaridade",
  destaque: "destaque",
  topico_citado: "tópico citado",
};

const fmt = (v: unknown) =>
  typeof v === "number" ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : typeof v === "boolean" ? (v ? "sim" : "não") : String(v);

/** As parcelas da decisão em uma linha: "afinidade 0,8 · atividade 0,9 · acaso -0,05 · nota 1,1". */
export function reasonsText(d: PersonaDecision): string {
  const parts = Object.entries(d.reasons)
    .filter(([k]) => k !== "video")
    .map(([k, v]) => `${LABELS[k] ?? k} ${fmt(v)}`);
  if (d.trigger === "video") parts.push(`nota ${fmt(d.score)}`);
  return parts.join(" · ");
}
