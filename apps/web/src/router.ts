import { useEffect, useState } from "react";

export type Route =
  | { name: "feed" | "adicionar" | "mensagens" | "perfil" | "dono" }
  /** Conversa: #/chat/<id>. */
  | { name: "chat"; id: string }
  /** Perfil de outra pessoa ou persona: #/u/<apelido>. */
  | { name: "usuario"; nickname: string };

const SIMPLE = ["feed", "adicionar", "mensagens", "perfil", "dono"] as const;

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const user = /^u\/([^/]+)$/.exec(path);
  if (user) return { name: "usuario", nickname: decodeURIComponent(user[1]!) };
  const chat = /^chat\/([0-9a-f-]{36})$/i.exec(path);
  if (chat) return { name: "chat", id: chat[1]! };
  return (SIMPLE as readonly string[]).includes(path) ? { name: path as (typeof SIMPLE)[number] } : { name: "feed" };
}

export const chatHref = (id: string) => `#/chat/${id}`;
export const profileHref = (nickname: string) => `#/u/${encodeURIComponent(nickname)}`;

/** Rotas por hash (#/feed, #/u/apelido...): simples e funciona servido por qualquer servidor estático. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** Armazenamento do navegador pode falhar (aba privada, bloqueio); nada no app depende dele para funcionar. */
function safeStorage(get: () => Storage) {
  return {
    get(key: string): string | null {
      try {
        return get().getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string | null) {
      try {
        if (value === null) get().removeItem(key);
        else get().setItem(key, value);
      } catch {
        // sem armazenamento: segue sem lembrar
      }
    },
  };
}

/** Some ao fechar a aba. */
export const session = safeStorage(() => sessionStorage);
/** Fica entre visitas (sessão de login). */
export const stored = safeStorage(() => localStorage);
