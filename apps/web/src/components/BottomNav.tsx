import type { Route } from "../router";

/** Feed e Mensagens chegam nos passos 3 e 7 do SPEC; por enquanto ficam visíveis, mas inativos. */
export function BottomNav({ route }: { route: Route }) {
  const active = route === "dono" ? "perfil" : route;
  return (
    <nav className="bottom-nav" aria-label="Navegação principal">
      <span aria-disabled="true" title="O feed chega em breve">
        Feed
      </span>
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
