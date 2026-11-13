import type { Route } from "../router";

/** Mensagens chega no passo 7 do SPEC; por enquanto fica visível, mas inativo. */
export function BottomNav({ route }: { route: Route }) {
  const active = route.name === "dono" ? "perfil" : route.name;
  return (
    <nav className="bottom-nav" aria-label="Navegação principal">
      <a href="#/feed" aria-current={active === "feed" ? "page" : undefined}>
        Feed
      </a>
      <a href="#/adicionar" aria-current={active === "adicionar" ? "page" : undefined}>
        Adicionar
      </a>
      <span aria-disabled="true" title="As mensagens chegam em breve">
        Mensagens
      </span>
      <a href="#/perfil" aria-current={active === "perfil" ? "page" : undefined}>
        Perfil
      </a>
    </nav>
  );
}
