import { useCallback, useEffect, useState } from "react";
import { api, apiUrl, ApiError, type Bulletin, type FeedVideo } from "../api";
import { dateLabel, newVideosLabel, residentsLabel, rollTime, shortDate, splitLabel } from "../bulletin";
import { Avatar } from "../components/Avatar";
import { Barata } from "../components/Barata";
import { chatHref } from "../router";
import { VideoViewer } from "./VideoViewer";

type State = { state: "loading" } | { state: "missing" } | { state: "error" } | { state: "ok"; bulletin: Bulletin };

/**
 * Tela completa do Boletim do Bunker (docs/boletim/telas/boletim.html). Regra fixa 2: o único vídeo é
 * o mais curtido do dia, e ele abre sozinho, sem continuidade para o resto do acervo.
 */
export function BulletinScreen({ date }: { date: string }) {
  const [s, setS] = useState<State>({ state: "loading" });
  const [playing, setPlaying] = useState(false);

  const fetchBulletin = useCallback(
    () =>
      api.bulletin(date).then(
        (bulletin) => setS({ state: "ok", bulletin }),
        (err) => setS(err instanceof ApiError && err.status === 404 ? { state: "missing" } : { state: "error" }),
      ),
    [date],
  );
  useEffect(() => {
    fetchBulletin();
  }, [fetchBulletin]);
  const load = () => {
    setS({ state: "loading" });
    fetchBulletin();
  };

  const patch = useCallback((id: string, change: Partial<FeedVideo>) => {
    setS((cur) => {
      if (cur.state !== "ok" || cur.bulletin.maisCurtido?.id !== id) return cur;
      return { state: "ok", bulletin: { ...cur.bulletin, maisCurtido: { ...cur.bulletin.maisCurtido, ...change } } };
    });
  }, []);
  const close = useCallback(() => setPlaying(false), []);

  return (
    <div className="boletim">
      <header className="foto-topo">
        <a className="icon-btn" href="#/feed" aria-label="Voltar ao feed">
          <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="15,5 8,12 15,19" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        <div className="foto-topo-titulo">Boletim do Bunker</div>
      </header>

      {s.state === "loading" && (
        <main className="estado" aria-busy="true">
          <Barata size={88} className="boletim-barata" />
          <h1 className="boletim-estado-titulo">Destrancando o arquivo do plantão</h1>
          <p className="estado-sub">Carregando o boletim de {shortDate(date)}.</p>
        </main>
      )}
      {s.state === "missing" && (
        <main className="estado">
          <Barata size={88} className="boletim-barata" />
          <h1 className="boletim-estado-titulo">Essa edição não saiu do bunker</h1>
          <p className="estado-sub">
            Não há boletim de {shortDate(date)}. O servidor pode ter ficado desligado nesse dia, ou o boletim ainda não ficou pronto.
          </p>
          <a className="btn btn-primary boletim-estado-btn" href="#/feed">
            Voltar ao feed
          </a>
        </main>
      )}
      {s.state === "error" && (
        <main className="estado">
          <Barata size={88} className="boletim-barata" />
          <h1 className="boletim-estado-titulo">O rádio chiou no meio do boletim</h1>
          <p className="estado-sub">Não foi possível carregar o boletim. Confira a conexão com o bunker e tente de novo.</p>
          <button className="btn btn-primary boletim-estado-btn" onClick={load}>
            Tentar de novo
          </button>
        </main>
      )}
      {s.state === "ok" && <BulletinBody b={s.bulletin} onPlay={() => setPlaying(true)} />}

      {s.state === "ok" && playing && s.bulletin.maisCurtido && (
        <VideoViewer videos={[s.bulletin.maisCurtido]} start={0} title="Mais curtido do dia" onPatch={patch} onClose={close} />
      )}
    </div>
  );
}

function BulletinBody({ b, onPlay }: { b: Bulletin; onPlay(): void }) {
  const { estoque, movimento, seuDia } = b;
  const top = b.maisCurtido;
  return (
    <main className="boletim-main">
      <p className="boletim-data">{dateLabel(b.date)}</p>
      <div className="boletim-plantao">
        <Avatar who={b.persona} size={44} className="boletim-anel" />
        <div>
          <div className="boletim-plantao-rotulo">Plantão de hoje</div>
          <div className="boletim-plantao-nome">
            {b.persona.name} <span className="boletim-ia">IA</span>
          </div>
        </div>
      </div>
      <h1 className="boletim-manchete">{b.headline}</h1>

      <h2 className="boletim-secao">Estoque</h2>
      <section className="boletim-cartao">
        {estoque.novos > 0 ? (
          <div className="boletim-grande">
            <span className="boletim-grande-num">{estoque.novos}</span>
            <span className="boletim-grande-rotulo">{newVideosLabel(estoque.novos)}</span>
          </div>
        ) : (
          <p className="boletim-vazio">Nada entrou no estoque ontem.</p>
        )}
        {estoque.topicos.length > 0 && (
          <ul className="boletim-chips">
            {estoque.topicos.map((t) => (
              <li key={t.name}>
                {t.name} <strong>{t.count}</strong>
              </li>
            ))}
          </ul>
        )}
        <dl className="boletim-dl">
          {estoque.abastecedores.length > 0 && (
            <div>
              <dt>Quem abasteceu</dt>
              <dd>{estoque.abastecedores.map((n) => `@${n}`).join(", ")}</dd>
            </div>
          )}
          {estoque.inaugurados.length > 0 && (
            <div>
              <dt>{estoque.inaugurados.length === 1 ? "Tema inaugurado" : "Temas inaugurados"}</dt>
              <dd>{estoque.inaugurados.join(", ")}</dd>
            </div>
          )}
          <div>
            <dt>Autonomia do estoque</dt>
            <dd>{rollTime(estoque.autonomiaSegundos)}</dd>
          </div>
        </dl>
      </section>

      <h2 className="boletim-secao">Movimento</h2>
      <div className="boletim-tiles">
        <Tile value={movimento.curtidas.total} label="curtidas" />
        <Tile value={movimento.comentarios.total} label="comentários" />
        <Tile value={movimento.moradores} label={residentsLabel(movimento.moradores)} />
      </div>
      {movimento.curtidas.total + movimento.comentarios.total > 0 && (
        <dl className="boletim-dl boletim-divisao">
          <div>
            <dt>Curtidas</dt>
            <dd>{splitLabel(movimento.curtidas)}</dd>
          </div>
          <div>
            <dt>Comentários</dt>
            <dd>{splitLabel(movimento.comentarios)}</dd>
          </div>
        </dl>
      )}

      {b.assunto && (
        <>
          <h2 className="boletim-secao">Assunto do dia</h2>
          <section className="boletim-cartao">
            <div className="boletim-assunto">{b.assunto.name}</div>
            <p className="boletim-sub">O tema com mais curtidas e comentários.</p>
            {top && (
              <>
                <div className="boletim-video">
                  <button className="boletim-thumb" onClick={onPlay} aria-label="Assistir o mais curtido do dia">
                    {top.thumbUrl && <img src={apiUrl(top.thumbUrl)} alt="" />}
                    <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
                      <polygon points="7,4 7,20 20,12" fill="var(--accent)" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
                    </svg>
                  </button>
                  <div className="boletim-video-info">
                    <div className="boletim-video-rotulo">Mais curtido do dia</div>
                    {(top.description ?? top.title) && <p className="boletim-video-desc">{top.description ?? top.title}</p>}
                    <button className="btn btn-small boletim-btn" onClick={onPlay}>
                      Assistir
                    </button>
                  </div>
                </div>
                <p className="boletim-nota">Abre só este vídeo. O resto continua no feed.</p>
              </>
            )}
          </section>
        </>
      )}

      {b.status !== "curto" && b.gossip && (
        <>
          <h2 className="boletim-secao">Fofoca do plantão</h2>
          <section className="boletim-cartao">
            <svg width={34} height={26} viewBox="0 0 34 26" aria-hidden="true" className="boletim-aspas">
              <path d="M0 26V15C0 6 5 1 13 0v6c-4 1-6 3-6 7h6v13zM19 26V15c0-9 5-14 13-15v6c-4 1-6 3-6 7h6v13z" fill="var(--accent)" />
            </svg>
            <p className="boletim-fofoca">{b.gossip}</p>
            <div className="boletim-assinatura">
              <Avatar who={b.persona} size={24} className="boletim-anel" />
              {b.persona.name}, de plantão
            </div>
            {b.grupoId && (
              <a className="btn btn-small boletim-btn boletim-grupo" href={chatHref(b.grupoId)}>
                Ver a conversa no Grupo do Bunker
              </a>
            )}
          </section>
        </>
      )}

      <h2 className="boletim-secao">Seu dia</h2>
      <section className="boletim-cartao">
        <div className="boletim-privado">
          <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="7" width="11" height="7.5" rx="2" fill="currentColor" />
            <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth={1.8} />
          </svg>
          Só você vê esta parte.
        </div>
        <div className="boletim-tiles boletim-tiles-dentro">
          <Tile value={seuDia.videosVistos} label="vídeos vistos" />
          <Tile value={seuDia.curtidas} label="curtidas suas" />
          <Tile value={seuDia.tema ?? "nenhum"} label="seu tema" text />
        </div>
      </section>
    </main>
  );
}

function Tile({ value, label, text }: { value: number | string; label: string; text?: boolean }) {
  return (
    <div className="boletim-tile">
      <div className={text ? "boletim-tile-num boletim-tile-texto" : "boletim-tile-num"}>{value}</div>
      <div className="boletim-tile-rotulo">{label}</div>
    </div>
  );
}
