import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "../screens/Feed";

/** Gaveta que sobe do pé da tela (comentários, membros, quem reagiu). Fecha pelo ×, tocando fora ou com Esc. */
export function Gaveta({ id, title, onClose, children }: { id: string; title: ReactNode; onClose(): void; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id={id}>{title}</h2>
          <button ref={close} className="icon-btn" onClick={onClose} aria-label="Fechar">
            <CloseIcon />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}
