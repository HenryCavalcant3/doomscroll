import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { api, apiUrl, type Comment, type Conversation, type FeedVideo } from "../api";
import { conversationTitle } from "../chat";
import { Avatar } from "../components/Avatar";
import { ConversationAvatar } from "../components/ConversationAvatar";
import { appendPage, initialFeed, needsMore, patchVideo, type FeedState } from "../feedQueue";
import { profileHref } from "../router";
import { ViewTracker } from "../viewTracker";

/** Tela 2 do SPEC (wireframe `feed`): um vídeo por tela, rolagem vertical, autoplay. */
export function Feed() {
  const [feed, setFeed] = useState<FeedState>(initialFeed);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentsFor, setCommentsFor] = useState<FeedVideo | null>(null);
  const [shareFor, setShareFor] = useState<FeedVideo | null>(null);
  const loading = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const closeComments = useCallback(() => setCommentsFor(null), []);
  const closeShare = useCallback(() => setShareFor(null), []);
  // Estável: entra nas dependências do efeito que toca o vídeo.
  const soundBlocked = useCallback(() => setMuted(true), []);
  const onCommented = useCallback((id: string, count: number) => setFeed((f) => patchVideo(f, id, { commentCount: count })), []);

  // Curtida otimista: muda na hora e corrige com a resposta (ou desfaz se der erro).
  const toggleLike = (video: FeedVideo) => {
    const liked = !video.liked;
    const before = { liked: video.liked, likeCount: video.likeCount };
    setFeed((f) => patchVideo(f, video.id, { liked, likeCount: video.likeCount + (liked ? 1 : -1) }));
    api.like(video.id, liked).then(
      (res) => setFeed((f) => patchVideo(f, video.id, res)),
      () => setFeed((f) => patchVideo(f, video.id, before)),
    );
  };

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
            onSoundBlocked={soundBlocked}
            onComments={() => setCommentsFor(entry.video)}
            onShare={() => setShareFor(entry.video)}
            onLike={() => toggleLike(entry.video)}
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
      {commentsFor && <CommentsDrawer video={commentsFor} onClose={closeComments} onCommented={onCommented} />}
      {shareFor && <ShareDrawer video={shareFor} onClose={closeShare} />}
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
  /** O navegador recusou tocar com som (sem toque recente na tela): volta ao modo mudo. */
  onSoundBlocked(): void;
  onComments(): void;
  onShare(): void;
  onLike(): void;
}

function FeedItem({ index, video, active, mounted, muted, onUnmute, onSoundBlocked, onComments, onShare, onLike }: ItemProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [tracker] = useState(() => new ViewTracker());
  // Atualizado antes da limpeza do efeito abaixo: false lá quer dizer que a pessoa rolou para outro
  // vídeo; true, que a tela do feed fechou com este vídeo ativo.
  const activeNow = useRef(active);
  useLayoutEffect(() => {
    activeNow.current = active;
  }, [active]);
  /** A pessoa pausou este vídeo de propósito (aí ele não volta a tocar sozinho). */
  const userPaused = useRef(false);

  // Tenta tocar o vídeo ativo. Uma recusa por rolagem rápida (o pedido é interrompido antes de o
  // vídeo carregar) não vira "pausado": quando o vídeo puder tocar, onCanPlay tenta de novo.
  const tryPlay = useCallback(() => {
    const el = ref.current;
    if (!el || !activeNow.current || userPaused.current) return;
    el.play().then(
      () => setPaused(false),
      (err: unknown) => {
        if (!activeNow.current || userPaused.current || !el.paused) return;
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          // Com som o navegador exige um toque recente; sem som deve tocar. Se nem assim, mostra o play.
          if (!el.muted) onSoundBlocked();
          else setPaused(true);
        }
      },
    );
  }, [onSoundBlocked]);

  // Sinais para a recomendação: uma medição por vez que o vídeo fica ativo, mandada quando ele
  // deixa de ser o ativo, quando a tela do feed fecha ou quando a aba é escondida.
  useEffect(() => {
    if (!active) return;
    tracker.start();
    if (ref.current && !ref.current.paused && !document.hidden) tracker.play();
    // Só rolar para o próximo vídeo conta como pulo rápido.
    const send = (canSkip: boolean) => {
      const view = tracker.finish({ canSkip });
      if (view) api.view(video.id, view).catch(() => {});
    };
    const onVisibility = () => document.hidden && send(false);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      send(!activeNow.current);
    };
  }, [active, tracker, video.id]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = muted;
    if (active) {
      tryPlay();
    } else {
      userPaused.current = false;
      el.pause();
      el.currentTime = 0;
    }
  }, [active, muted, mounted, tryPlay]);

  const onTap = () => {
    const el = ref.current;
    if (!el) return;
    if (muted) {
      // Liga o som e toca ainda dentro do toque: alguns navegadores (iPhone) só aceitam assim.
      userPaused.current = false;
      el.muted = false;
      onUnmute();
      if (el.paused) tryPlay();
      return;
    }
    if (el.paused) {
      userPaused.current = false;
      el.play().then(() => setPaused(false), () => setPaused(true));
    } else {
      userPaused.current = true;
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
          onCanPlay={() => ref.current?.paused && tryPlay()}
          onPlaying={() => {
            setPaused(false);
            if (active && !document.hidden) tracker.play();
          }}
          onPause={() => tracker.pause()}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (el.duration) setProgress(el.currentTime / el.duration);
            if (active && !document.hidden) tracker.time(el.currentTime, el.duration);
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
        {video.author ? (
          <a href={profileHref(video.author.nickname)} aria-label={`Perfil de @${video.author.nickname}`}>
            <Avatar who={video.author} size={48} className="feed-avatar" />
          </a>
        ) : (
          <div className="feed-avatar" aria-hidden="true" />
        )}
        <button
          className="feed-action"
          onClick={onLike}
          aria-pressed={video.liked}
          aria-label={`${video.liked ? "Descurtir" : "Curtir"} (${video.likeCount})`}
        >
          <HeartIcon filled={video.liked} />
          {video.likeCount > 0 ? video.likeCount : "curtir"}
        </button>
        <button className="feed-action" onClick={onComments} aria-label={`Comentários (${video.commentCount})`}>
          <CommentIcon />
          {video.commentCount > 0 ? video.commentCount : "comentar"}
        </button>
        <button className="feed-action" onClick={onShare} aria-label="Enviar no chat">
          <SendIcon />
          enviar
        </button>
      </div>

      <div className="feed-info">
        {video.author && (
          <a className="feed-author" href={profileHref(video.author.nickname)}>
            @{video.author.nickname}
          </a>
        )}
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

interface DrawerProps {
  video: FeedVideo;
  onClose(): void;
  onCommented(videoId: string, count: number): void;
}

function CommentsDrawer({ video, onClose, onCommented }: DrawerProps) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    close.current?.focus();
    api.comments(video.id).then(setComments, (err: Error) => setError(err.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [video.id, onClose]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const comment = await api.addComment(video.id, text);
      const next = [...(comments ?? []), comment];
      setComments(next);
      onCommented(video.id, next.length);
      setText("");
      requestAnimationFrame(() => list.current?.lastElementChild?.scrollIntoView({ block: "nearest" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não deu para comentar.");
    } finally {
      setSending(false);
    }
  }

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
        <div className="drawer-body">
          {!comments && !error && <p className="hint">Carregando…</p>}
          {comments?.length === 0 && <p className="hint">Ninguém comentou ainda. Seja o primeiro!</p>}
          <ul className="comments" ref={list}>
            {comments?.map((c) => (
              <li key={c.id}>
                <a href={profileHref(c.author.nickname)} aria-label={`Perfil de @${c.author.nickname}`}>
                  <Avatar who={c.author} size={36} />
                </a>
                <div>
                  <a className="comment-author" href={profileHref(c.author.nickname)}>
                    @{c.author.nickname}
                  </a>
                  <p>{c.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <form className="comment-form" onSubmit={send}>
          <input
            className="input"
            aria-label="Escreva um comentário"
            placeholder="Escreva um comentário…"
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn btn-primary btn-small" type="submit" disabled={sending || !text.trim()}>
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}

/** Manda o vídeo para uma das suas conversas (SPEC 5.2: compartilhar no chat). */
function ShareDrawer({ video, onClose }: { video: FeedVideo; onClose(): void }) {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, "enviando" | "enviado">>({});
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    api.conversations().then(setList, (err: Error) => setError(err.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const share = (c: Conversation) => {
    if (state[c.id]) return;
    setState((s) => ({ ...s, [c.id]: "enviando" }));
    setError(null);
    api.shareVideo(c.id, video.id).then(
      () => setState((s) => ({ ...s, [c.id]: "enviado" })),
      (err: Error) => {
        setError(err.message);
        setState((s) => {
          const next = { ...s };
          delete next[c.id];
          return next;
        });
      },
    );
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id="share-title">Enviar para</h2>
          <button ref={close} className="icon-btn" onClick={onClose} aria-label="Fechar">
            <CloseIcon />
          </button>
        </header>
        <div className="drawer-body">
          {!list && !error && <p className="hint">Carregando…</p>}
          {list?.length === 0 && (
            <p className="hint">
              Você ainda não tem conversas. Abra uma em <a href="#/mensagens">Mensagens</a>.
            </p>
          )}
          <ul className="share-list">
            {list?.map((c) => (
              <li key={c.id}>
                <button className="share-row" onClick={() => share(c)} disabled={Boolean(state[c.id])}>
                  <ConversationAvatar conversation={c} size={40} />
                  <span className="share-name">{conversationTitle(c)}</span>
                  <span className={`share-state${state[c.id] === "enviado" ? " done" : ""}`}>
                    {state[c.id] === "enviado" ? "Enviado" : state[c.id] === "enviando" ? "Enviando…" : "Enviar"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

const icon = { width: 28, height: 28, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinejoin: "round" as const, "aria-hidden": true };

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg {...icon} fill={filled ? "var(--accent)" : "none"} stroke={filled ? "var(--accent)" : "currentColor"}>
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
