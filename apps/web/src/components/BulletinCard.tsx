import type { BulletinSummary } from "../api";
import { dateLabel, newVideosLabel, residentsLabel } from "../bulletin";
import { bulletinHref } from "../router";
import { Avatar } from "./Avatar";

/**
 * Cartão do Boletim do Bunker no topo do feed (docs/boletim/telas/boletim-feed.html): tela cheia, passa
 * rolando e não bloqueia. Só manchete, plantão e três números; nenhum vídeo (regra fixa 2).
 */
export function BulletinCard({ index, bulletin }: { index: number; bulletin: BulletinSummary }) {
  const { numeros } = bulletin;
  return (
    <section className="feed-item boletim-feed" data-index={index} aria-label="Boletim do Bunker">
      <div className="faixa faixa-topo" aria-hidden="true" />
      <div className="boletim-feed-corpo">
        <div className="boletim-feed-selo">Boletim do Bunker</div>
        <p className="boletim-data boletim-feed-data">{dateLabel(bulletin.date)}</p>
        <div className="boletim-plantao boletim-feed-plantao">
          <Avatar who={bulletin.persona} size={44} className="boletim-anel" />
          <div>
            <div className="boletim-plantao-rotulo">Plantão de hoje</div>
            <div className="boletim-plantao-nome">
              {bulletin.persona.name} <span className="boletim-ia">IA</span>
            </div>
          </div>
        </div>
        <h2 className="boletim-feed-manchete">{bulletin.headline}</h2>
        <div className="boletim-tiles boletim-feed-tiles">
          <Tile value={numeros.videosNovos} label={newVideosLabel(numeros.videosNovos)} />
          <Tile value={numeros.curtidas} label={numeros.curtidas === 1 ? "curtida" : "curtidas"} />
          <Tile value={numeros.moradores} label={residentsLabel(numeros.moradores)} />
        </div>
        <a className="btn btn-primary boletim-feed-ler" href={bulletinHref(bulletin.date)}>
          Ler o boletim
        </a>
        <div className="boletim-feed-fim">
          <svg aria-hidden="true" className="desce" width="28" height="28" viewBox="0 0 32 32">
            <polyline points="8,8 16,16 24,8" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="8,18 16,26 24,18" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p>Role para ir aos vídeos</p>
        </div>
      </div>
    </section>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="boletim-tile">
      <div className="boletim-tile-num">{value}</div>
      <div className="boletim-tile-rotulo">{label}</div>
    </div>
  );
}
