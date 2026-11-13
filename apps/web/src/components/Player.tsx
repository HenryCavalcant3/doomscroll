import { useEffect, useRef } from "react";
import { apiUrl } from "../api";

interface Props {
  video: { videoUrl: string | null; thumbUrl: string | null; title: string | null; description: string | null };
  onClose(): void;
}

/** Vídeo em tela cheia, com os controles do navegador (curtidos do perfil e vídeos do chat). */
export function Player({ video, onClose }: Props) {
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="player" role="dialog" aria-modal="true" aria-label={video.description ?? video.title ?? "Vídeo"}>
      {video.videoUrl ? (
        <video
          src={apiUrl(video.videoUrl)}
          poster={video.thumbUrl ? apiUrl(video.thumbUrl) : undefined}
          autoPlay
          controls
          loop
          playsInline
        />
      ) : (
        <p className="hint">Esse vídeo não está mais no bunker.</p>
      )}
      <button ref={close} className="icon-btn player-close" onClick={onClose} aria-label="Fechar vídeo">
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      {video.description && <p className="player-desc">{video.description}</p>}
    </div>
  );
}
