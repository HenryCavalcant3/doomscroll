import { useEffect, useState } from "react";

export type Route = "adicionar" | "perfil" | "dono";
const ROUTES: Route[] = ["adicionar", "perfil", "dono"];

function current(): Route {
  const name = window.location.hash.replace(/^#\/?/, "");
  return (ROUTES as string[]).includes(name) ? (name as Route) : "adicionar";
}

/** Rotas por hash (#/adicionar, #/perfil, #/dono): simples e funciona servido por qualquer servidor estático. */
export function useRoute(): Route {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const onChange = () => setRoute(current());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** sessionStorage pode falhar (aba privada, bloqueio); nada no app depende dele para funcionar. */
export const session = {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch {
      // sem armazenamento: segue sem lembrar
    }
  },
};
