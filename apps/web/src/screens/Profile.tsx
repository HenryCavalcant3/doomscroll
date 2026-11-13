import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiUrl, type FeedVideo, type Profile, type User } from "../api";
import { Avatar } from "../components/Avatar";
import { Player } from "../components/Player";
import { chatHref } from "../router";

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
  const [opening, setOpening] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);

  // Resposta que chega depois de a pessoa sair do perfil não leva mais para a conversa.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const message = () => {
    setOpening(true);
    setMessageError(null);
    api.openDirect(nickname).then(
      (c) => {
        if (mounted.current) window.location.hash = chatHref(c.id);
      },
      (err: Error) => {
        if (!mounted.current) return;
        setMessageError(err.message);
        setOpening(false);
      },
    );
  };

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
          <button className="btn btn-small" onClick={message} disabled={opening}>
            Mandar mensagem
          </button>
        )}
        {messageError && <p className="error">{messageError}</p>}
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
