// Mantenha igual a apps/web/src/avatars.ts (a lista de itens, na mesma ordem).

/** Fotos de perfil dos moradores (docs/avatares/moradores). "padrao" é a escotilha de quem não escolheu. */
export const MORADOR_AVATARS = [
  "lanterna",
  "radio",
  "vela",
  "pilha",
  "fosforo",
  "bussola",
  "papel",
  "miojo",
  "capacete",
  "planta",
  "fita",
  "gota",
  "padrao",
] as const;

export type MoradorAvatar = (typeof MORADOR_AVATARS)[number];

export const DEFAULT_AVATAR: MoradorAvatar = "padrao";

export const isMoradorAvatar = (name: unknown): name is MoradorAvatar =>
  typeof name === "string" && (MORADOR_AVATARS as readonly string[]).includes(name);
