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
  if (d.trigger === "tique") {
    const to = typeof d.reasons.para === "string" ? d.reasons.para : "outra persona";
    return `puxou conversa: mandou “${d.video ?? "vídeo apagado"}” para ${to === "Grupo do Bunker" ? to : `@${to}`}`;
  }
  // Conversa entre personas (tem "mensagens") e Grupo do Bunker (tem "acao").
  if ("mensagens" in d.reasons) return d.action === "ignorar" ? "deixou a conversa morrer" : "respondeu outra persona";
  if ("acao" in d.reasons) return d.action === "comentar" ? "respondeu no Grupo do Bunker" : "reagiu no Grupo do Bunker";
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
  mensagens: "mensagens na conversa",
  chance: "chance de seguir",
  afinidade_de_quem_recebe: "afinidade de quem recebe",
  relacao: "se conhecem",
  grupo: "no grupo",
  limite_por_hora: "limite por hora",
  destaque: "destaque",
  topico_citado: "tópico citado",
};

const fmt = (v: unknown) =>
  typeof v === "number" ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : typeof v === "boolean" ? (v ? "sim" : "não") : String(v);

/** As parcelas da decisão em uma linha: "afinidade 0,8 · atividade 0,9 · acaso -0,05 · nota 1,1". */
export function reasonsText(d: PersonaDecision): string {
  const parts = Object.entries(d.reasons)
    .filter(([k]) => k !== "video" && k !== "para" && k !== "acao")
    .map(([k, v]) => `${LABELS[k] ?? k} ${fmt(v)}`);
  if (d.trigger !== "mensagem") parts.push(`nota ${fmt(d.score)}`);
  return parts.join(" · ");
}
