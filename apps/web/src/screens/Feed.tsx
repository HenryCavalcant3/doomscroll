import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiUrl, type Comment, type FeedVideo } from "../api";
import { appendPage, initialFeed, needsMore, type FeedState } from "../feedQueue";

/** Tela 2 do SPEC (wireframe `feed`): um vídeo por tela, rolagem vertical, autoplay. */
export function Feed() {
  const [feed, setFeed] = useState<FeedState>(initialFeed);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentsFor, setCommentsFor] = useState<FeedVideo | null>(null);
  const loading = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const closeComments = useCallback(() => setCommentsFor(null), []);

  // Busca mais vídeos quando o usuário chega perto do fim da lista.
  useEffect(() => {
    // Depois de um erro só tenta de novo quando o usuário pede (sem repetir pedidos em laço).
    if (loading.current || error || !needsMore(feed, active)) return;
    loading.current = true;
    api
      .feed(feed.seen)
      .then((page) => {
        setFeed((f) => appendPage(f, page));
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => {
        loading.current = false;
      });
  }, [feed, active, error]);

  // O vídeo ativo é o que ocupa a maior parte da tela.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (items) => {
        for (const item of items) {
          if (item.isIntersecting) setActive(Number((item.target as HTMLElement).dataset.index));
        }
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll("[data-index]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [feed.entries.length]);

  if (feed.empty) {
    return (
      <main className="screen placeholder">
        <h1>O bunker ainda está vazio</h1>
        <p>Nenhum vídeo foi aprovado ainda. Mande o primeiro!</p>
        <a className="btn btn-primary btn-link" href="#/adicionar">
          Adicionar vídeo
        </a>
      </main>
    );
  }

  return (
    <main className="feed">
      <div className="feed-title" aria-hidden="true">
        Para você
      </div>
      <div className="feed-scroller" ref={scroller}>
        {feed.entries.map((entry, i) => (
          <FeedItem
            key={entry.key}
            index={i}
            video={entry.video}
            active={i === active}
            mounted={Math.abs(i - active) <= 1}
            muted={muted}
            onUnmute={() => setMuted(false)}
            onComments={() => setCommentsFor(entry.video)}
          />
        ))}
        {(feed.entries.length === 0 || error) && (
          <div className="feed-item feed-status" role="status">
            {error ? (
              <>
                <p className="error">Não deu para carregar o feed: {error}</p>
                <button className="btn" onClick={() => setError(null)}>
                  Tentar de novo
                </button>
              </>
            ) : (
              <p className="hint">Carregando…</p>
            )}
          </div>
        )}
      </div>
      {commentsFor && <CommentsDrawer video={commentsFor} onClose={closeComments} />}
    </main>
  );
}

interface ItemProps {
  index: number;
  video: FeedVideo;
  active: boolean;
  /** Só o vídeo ativo e os vizinhos têm elemento <video> (economiza memória e banda). */
  mounted: boolean;
  muted: boolean;
  onUnmute(): void;
  onComments(): void;
}

function FeedItem({ index, video, active, mounted, muted, onUnmute, onComments }: ItemProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = muted;
    if (active) {
      // Navegadores só deixam tocar sozinho sem som; play() pode ser recusado mesmo assim.
      el.play().then(
        () => setPaused(false),
        () => setPaused(true),
      );
    } else {
      el.pause();
      el.currentTime = 0;
    }
  }, [active, muted, mounted]);

  const onTap = () => {
    const el = ref.current;
    if (!el) return;
    if (muted) {
      onUnmute();
      if (el.paused) el.play().catch(() => setPaused(true));
      return;
    }
    if (el.paused) el.play().then(() => setPaused(false), () => setPaused(true));
    else {
      el.pause();
      setPaused(true);
    }
  };

  return (
    <section className="feed-item" data-index={index} aria-label={video.description ?? video.title ?? "Vídeo"}>
      {mounted && video.videoUrl ? (
        <video
          ref={ref}
          src={apiUrl(video.videoUrl)}
          poster={video.thumbUrl ? apiUrl(video.thumbUrl) : undefined}
          preload={active || index > 0 ? "auto" : "metadata"}
          muted
          loop
          playsInline
          disablePictureInPicture
          onClick={onTap}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (el.duration) setProgress(el.currentTime / el.duration);
          }}
        />
      ) : (
        video.thumbUrl && <img className="feed-poster" src={apiUrl(video.thumbUrl)} alt="" />
      )}

      {active && (muted || paused) && (
        <button className="feed-center" onClick={onTap} aria-label={muted ? "Ligar o som" : "Continuar o vídeo"}>
          {muted ? <SoundOffIcon /> : <PlayIcon />}
          <span>{muted ? "toque para ouvir" : "pausado"}</span>
        </button>
      )}

      <div className="feed-rail">
        <div className="feed-avatar" aria-hidden="true" />
        <button className="feed-action" aria-disabled="true" title="Curtidas chegam em breve">
          <HeartIcon />
          curtir
        </button>
        <button className="feed-action" onClick={onComments} aria-label={`Comentários (${video.commentCount})`}>
          <CommentIcon />
          {video.commentCount > 0 ? video.commentCount : "comentar"}
        </button>
        <button className="feed-action" aria-disabled="true" title="Enviar no chat chega em breve">
          <SendIcon />
          enviar
        </button>
      </div>

      <div className="feed-info">
        {/* Até o login (passo 4) os vídeos não guardam quem enviou. */}
        <div className="feed-author">@morador</div>
        {video.description && <p className="feed-desc">{video.description}</p>}
        {video.topics.length > 0 && (
          <div className="pills">
            {video.topics.map((t) => (
              <span key={t.slug} className="tag">
                {t.slug}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="feed-progress" aria-hidden="true">
        <div style={{ transform: `scaleX(${active ? progress : 0})` }} />
      </div>
    </section>
  );
}

function CommentsDrawer({ video, onClose }: { video: FeedVideo; onClose(): void }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    api.comments(video.id).then(setComments, (err: Error) => setError(err.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [video.id, onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 id="drawer-title">Comentários{comments ? ` (${comments.length})` : ""}</h2>
          <button ref={close} className="icon-btn" onClick={onClose} aria-label="Fechar comentários">
            <CloseIcon />
          </button>
        </header>
        {error && <p className="error">{error}</p>}
        {!comments && !error && <p className="hint">Carregando…</p>}
        {comments?.length === 0 && <p className="hint">Ninguém comentou ainda.</p>}
        <ul className="comments">
          {comments?.map((c) => (
            <li key={c.id}>
              {c.author.avatarUrl ? (
                <img src={apiUrl(c.author.avatarUrl)} alt="" width={36} height={36} />
              ) : (
                <span className="comment-avatar" aria-hidden="true" />
              )}
              <div>
                <strong>@{c.author.nickname}</strong>
                <p>{c.text}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="hint">Por enquanto só as personas comentam.</p>
      </div>
    </div>
  );
}

const icon = { width: 28, height: 28, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinejoin: "round" as const, "aria-hidden": true };

function HeartIcon() {
  return (
    <svg {...icon}>
      <path d="M12 21s-7-4.6-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9z" />
    </svg>
  );
}
function CommentIcon() {
  return (
    <svg {...icon}>
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg {...icon}>
      <path d="M4 12l16-8-6 16-3-7z" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg {...icon} width={56} height={56} strokeWidth={1.5}>
      <polygon points="7,4 7,20 20,12" />
    </svg>
  );
}
function SoundOffIcon() {
  return (
    <svg {...icon} width={40} height={40} strokeWidth={1.5}>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M16 9l5 6M21 9l-5 6" strokeLinecap="round" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg {...icon} width={24} height={24} strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
