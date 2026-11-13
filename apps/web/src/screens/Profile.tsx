import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiUrl, type FeedVideo, type Profile, type User } from "../api";
import { Avatar } from "../components/Avatar";

type Tab = "curtidos" | "stalker";

interface Props {
  nickname: string;
  me: User;
  onLogout(): void;
}

/** Tela 6 do SPEC (wireframe `persona`): perfil de pessoa ou de persona, com os vídeos curtidos. */
export function ProfileScreen({ nickname, me, onLogout }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("curtidos");
  const [playing, setPlaying] = useState<FeedVideo | null>(null);
  const own = nickname === me.nickname;
  const closePlayer = useCallback(() => setPlaying(null), []);

  useEffect(() => {
    api.profile(nickname).then(setProfile, (err: Error) => setError(err.message));
  }, [nickname]);

  if (!profile) {
    return (
      <main className="screen placeholder">
        {error ? <p className="error">{error}</p> : <p>Carregando…</p>}
      </main>
    );
  }

  const title = profile.name ?? profile.nickname;
  return (
    <main className="screen profile">
      <header className="profile-head">
        <Avatar who={profile} size={88} className="profile-avatar" />
        <h1>{title}</h1>
        {profile.name && <div className="hint">@{profile.nickname}</div>}
        {profile.isAi && <span className="badge">persona de IA</span>}
        {profile.role === "owner" && <span className="badge">dono do bunker</span>}
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        {own ? (
          <div className="profile-actions">
            {me.role === "owner" && (
              <a className="btn btn-small btn-link" href="#/dono">
                Painel do dono
              </a>
            )}
            <button className="btn btn-small" onClick={onLogout}>
              Sair
            </button>
          </div>
        ) : (
          <button className="btn btn-small" aria-disabled="true" title="As mensagens chegam em breve">
            Mandar mensagem
          </button>
        )}
      </header>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "curtidos"} onClick={() => setTab("curtidos")}>
          Curtidos
        </button>
        {profile.isAi && (
          <button role="tab" aria-selected={tab === "stalker"} onClick={() => setTab("stalker")}>
            Modo stalker
          </button>
        )}
      </div>

      {tab === "stalker" ? (
        <p className="notice">
          Em breve você vai poder espiar, só lendo, as conversas de {title} com outras personas.
        </p>
      ) : profile.liked.length === 0 ? (
        <p className="hint profile-empty">
          {own ? "Os vídeos que você curtir aparecem aqui." : "Nenhum vídeo curtido ainda."}
        </p>
      ) : (
        <ul className="liked-grid">
          {profile.liked.map((v) => (
            <li key={v.id}>
              <button onClick={() => setPlaying(v)} aria-label={v.description ?? v.title ?? "Vídeo"}>
                {v.thumbUrl ? <img src={apiUrl(v.thumbUrl)} alt="" loading="lazy" /> : <span />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {playing && <Player video={playing} onClose={closePlayer} />}
    </main>
  );
}

/** Vídeo curtido em tela cheia, com os controles do navegador. */
function Player({ video, onClose }: { video: FeedVideo; onClose(): void }) {
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="player" role="dialog" aria-modal="true" aria-label={video.description ?? video.title ?? "Vídeo"}>
      {video.videoUrl && (
        <video
          src={apiUrl(video.videoUrl)}
          poster={video.thumbUrl ? apiUrl(video.thumbUrl) : undefined}
          autoPlay
          controls
          loop
          playsInline
        />
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
