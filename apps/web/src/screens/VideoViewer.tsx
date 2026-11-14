import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FeedVideo } from "../api";
import { CloseIcon, CommentsDrawer, FeedItem, likeVideo, ShareDrawer, usePrefetchNext } from "./Feed";

interface Props {
  /** Os vídeos da grade (curtidos do perfil, resultados da busca), na ordem dela. */
  videos: FeedVideo[];
  /** Posição do vídeo tocado na grade. */
  start: number;
  title: string;
  /** Muda um vídeo na lista de quem abriu (curtida, contagem de comentários). */
  onPatch(id: string, change: Partial<FeedVideo>): void;
  onClose(): void;
}

/**
 * Uma grade de vídeos em tela cheia, com o mesmo vídeo do feed: rola pelos outros a partir do tocado.
 * Usada pelos curtidos do perfil e pela busca. Quem fecha decide o que sai da grade (no perfil, os
 * descurtidos só somem depois, para nada sumir debaixo do dedo).
 */
export function VideoViewer({ videos, start, title, onPatch, onClose }: Props) {
  const [active, setActive] = useState(start);
  // Tocar na miniatura conta como toque na tela: dá para começar com som (se o navegador recusar,
  // aquele vídeo toca mudo, com o aviso "toque para ouvir").
  const [muted, setMuted] = useState(false);
  const [nextReady, onStarted] = usePrefetchNext(active);
  const [commentsFor, setCommentsFor] = useState<FeedVideo | null>(null);
  const [shareFor, setShareFor] = useState<FeedVideo | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const drawerOpen = useRef(false);
  useLayoutEffect(() => {
    drawerOpen.current = Boolean(commentsFor || shareFor);
  }, [commentsFor, shareFor]);
  const closeComments = useCallback(() => setCommentsFor(null), []);
  const closeShare = useCallback(() => setShareFor(null), []);
  const onCommented = useCallback((id: string, count: number) => onPatch(id, { commentCount: count }), [onPatch]);

  // Abre já no vídeo tocado, sem animação de rolagem.
  useLayoutEffect(() => {
    const root = scroller.current;
    if (root) root.scrollTop = start * root.clientHeight;
  }, [start]);

  useEffect(() => {
    close.current?.focus();
    // Com uma gaveta aberta, o Esc fecha só a gaveta.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !drawerOpen.current && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
  }, [videos.length]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="feed-title" aria-hidden="true">
        {title}
      </div>
      <button ref={close} className="icon-btn viewer-close" onClick={onClose} aria-label="Fechar">
        <CloseIcon />
      </button>
      <div className="feed-scroller" ref={scroller}>
        {videos.map((video, i) => (
          <FeedItem
            key={video.id}
            index={i}
            video={video}
            active={i === active}
            mounted={i === active || (i === active + 1 && nextReady)}
            muted={muted}
            onUnmute={() => setMuted(false)}
            onStarted={onStarted}
            onComments={() => setCommentsFor(video)}
            onShare={() => setShareFor(video)}
            onLike={() => likeVideo(video, onPatch)}
          />
        ))}
      </div>
      {commentsFor && <CommentsDrawer video={commentsFor} onClose={closeComments} onCommented={onCommented} />}
      {shareFor && <ShareDrawer video={shareFor} onClose={closeShare} />}
    </div>
  );
}
