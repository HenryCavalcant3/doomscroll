import type { MouseEvent } from "react";
import { canGoBack } from "../router";

/**
 * Ícone de voltar, redundância do gesto. Volta no histórico quando a tela anterior é do app; aberta
 * direto (link, atalho, recarga), vai para `href`, a tela de onde ela costuma ser aberta.
 */
export function Voltar({ href, label = "Voltar", className }: { href: string; label?: string; className?: string }) {
  const onClick = (e: MouseEvent) => {
    if (!canGoBack()) return;
    e.preventDefault();
    window.history.back();
  };
  return (
    <a className={`icon-btn${className ? ` ${className}` : ""}`} href={href} onClick={onClick} aria-label={label}>
      <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" />
      </svg>
    </a>
  );
}
