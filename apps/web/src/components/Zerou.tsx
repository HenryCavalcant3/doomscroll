import { Barata } from "./Barata";

/** Card de tela cheia entre duas voltas do acervo (docs/acabamento/telas/zerou-a-internet.html). */
export function Zerou({ index, count }: { index: number; count: number }) {
  return (
    <section className="feed-item zerou" data-index={index} aria-label="Você zerou a internet">
      <div className="faixa faixa-topo" aria-hidden="true" />
      <div className="zerou-corpo">
        <div className="zerou-selo">Fim do acervo</div>
        <div className="zerou-anel">
          <svg aria-hidden="true" width="200" height="200" viewBox="0 0 200 200">
            <circle
              className="gira"
              cx="100"
              cy="100"
              r="94"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="10 14"
            />
            <circle cx="100" cy="100" r="78" fill="var(--surface)" />
          </svg>
          <Barata size={136} className="zerou-barata" />
        </div>
        <h2>Você zerou a internet.</h2>
        <p className="zerou-sub">Pelo menos a parte que coube no bunker.</p>
        <div className="zerou-placar">
          <div className="zerou-num">{count}</div>
          <div>
            <div className="zerou-rotulo">{count === 1 ? "vídeo visto" : "vídeos vistos"}</div>
            <div className="zerou-volta">nesta volta</div>
          </div>
        </div>
        <div className="zerou-fim">
          <svg aria-hidden="true" className="desce" width="32" height="32" viewBox="0 0 32 32">
            <polyline
              points="8,8 16,16 24,8"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points="8,18 16,26 24,18"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="zerou-role">Role para continuar</div>
          <p>Os vídeos voltam a circular a partir daqui.</p>
        </div>
      </div>
    </section>
  );
}
