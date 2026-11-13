import type { Video } from "./api";

export type StepState = "feito" | "em andamento" | "na fila" | "falhou";

const STEPS = [
  { stage: "baixando", label: "Baixando" },
  { stage: "convertendo", label: "Convertendo" },
  { stage: "transcrevendo", label: "Transcrevendo" },
  { stage: "sugerindo", label: "Sugerindo tópicos" },
] as const;

/** Linhas do card "Processamento" a partir do stage/status do vídeo. */
export function processingSteps(video: Pick<Video, "stage" | "status">): { label: string; state: StepState }[] {
  const index = STEPS.findIndex((s) => s.stage === video.stage);
  const current = index === -1 ? STEPS.length : index; // depois de "sugerindo", tudo feito
  return STEPS.map((s, i) => ({
    label: s.label,
    state:
      i < current ? "feito" : i > current ? "na fila" : video.status === "falhou" ? "falhou" : "em andamento",
  }));
}

/** O vídeo ainda está sendo processado pelo worker (vale a pena consultar de novo). */
export function isProcessing(video: Pick<Video, "stage" | "status">): boolean {
  return (video.status === "baixando" || video.status === "processando") && video.stage !== "aguardando_confirmacao";
}

export const MAX_TOPICS = 3;
