import { Barata } from "./Barata";

/** A api não respondeu (docs/acabamento/telas/sem-sinal.html). */
export function SemSinal({ onRetry }: { onRetry(): void }) {
  return (
    <main className="sem-sinal">
      <div className="radar">
        <svg aria-hidden="true" width="220" height="220" viewBox="0 0 220 220">
          <circle cx="110" cy="110" r="104" fill="none" stroke="var(--line)" strokeWidth="1.5" />
          <circle cx="110" cy="110" r="76" fill="none" stroke="var(--line)" strokeWidth="1.5" />
          <line x1="110" y1="2" x2="110" y2="218" stroke="var(--line)" strokeWidth="1.5" />
          <line x1="2" y1="110" x2="218" y2="110" stroke="var(--line)" strokeWidth="1.5" />
          <circle className="pulso" cx="110" cy="110" r="104" fill="none" stroke="var(--accent)" strokeWidth="2" />
          <circle className="pulso pulso-2" cx="110" cy="110" r="104" fill="none" stroke="var(--accent)" strokeWidth="2" />
          <circle cx="110" cy="110" r="48" fill="var(--surface)" />
        </svg>
        <Barata size={88} className="radar-barata" />
      </div>
      <h1>Sem sinal do bunker</h1>
      <p className="sem-sinal-texto">
        O app não encontrou o servidor. Ele pode estar desligado, ou este aparelho saiu da rede do bunker.
      </p>
      <ol className="passos">
        <li>
          <span className="passo-num" aria-hidden="true">
            1
          </span>
          <div>
            <div className="passo-titulo">Confira o Wi-Fi</div>
            <div className="passo-texto">Este aparelho precisa estar na mesma rede do computador que roda o bunker.</div>
          </div>
        </li>
        <li>
          <span className="passo-num" aria-hidden="true">
            2
          </span>
          <div>
            <div className="passo-titulo">Confira o servidor</div>
            <div className="passo-texto">Pergunte a quem cuida do bunker se ele está ligado.</div>
          </div>
        </li>
      </ol>
      <div className="sem-sinal-fim">
        <button className="btn btn-primary" onClick={onRetry}>
          Tentar de novo
        </button>
        <p>Suas curtidas e conversas continuam guardadas no bunker.</p>
      </div>
    </main>
  );
}
