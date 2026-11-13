import type { Route } from "../router";

/** Navegação inferior fixa. A bolinha em Mensagens indica conversas com mensagens não lidas. */
export function BottomNav({ route, unread }: { route: Route; unread: number }) {
  const active = route.name === "dono" ? "perfil" : route.name;
  return (
    <nav className="bottom-nav" aria-label="Navegação principal">
      <a href="#/feed" aria-current={active === "feed" ? "page" : undefined}>
        Feed
      </a>
      <a href="#/adicionar" aria-current={active === "adicionar" ? "page" : undefined}>
        Adicionar
      </a>
      <a href="#/mensagens" aria-current={active === "mensagens" ? "page" : undefined}>
        Mensagens
        {unread > 0 && (
          <span className="nav-dot" aria-label={`${unread} não ${unread === 1 ? "lida" : "lidas"}`}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </a>
      <a href="#/perfil" aria-current={active === "perfil" ? "page" : undefined}>
        Perfil
      </a>
    </nav>
  );
}
