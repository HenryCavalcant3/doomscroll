// Mantenha igual a apps/api/src/avatars.ts (a lista de itens, na mesma ordem).

/** Fotos de perfil dos moradores (public/avatares), na ordem da tela de seleção. */
export const MORADOR_AVATARS = [
  { name: "lanterna", label: "Lanterna" },
  { name: "radio", label: "Rádio" },
  { name: "vela", label: "Vela" },
  { name: "pilha", label: "Pilha" },
  { name: "fosforo", label: "Fósforo" },
  { name: "bussola", label: "Bússola" },
  { name: "papel", label: "Papel" },
  { name: "miojo", label: "Miojo" },
  { name: "capacete", label: "Capacete" },
  { name: "planta", label: "Planta" },
  { name: "fita", label: "Fita" },
  { name: "gota", label: "Gota" },
  { name: "padrao", label: "Escotilha" },
] as const;

/** A escotilha: de quem ainda não escolheu. */
export const DEFAULT_AVATAR = "padrao";

const KNOWN = new Set<string>(MORADOR_AVATARS.map((a) => a.name));

/** Endereço do SVG do item; nome desconhecido (versão nova da api, por exemplo) vira a escotilha. */
export const avatarSrc = (name: string | null | undefined) => `/avatares/${name && KNOWN.has(name) ? name : DEFAULT_AVATAR}.svg`;

export const OWNER_FRAME_SRC = "/avatares/dono/moldura.svg";
export const OWNER_KEY_SRC = "/avatares/dono/selo-chave.svg";
