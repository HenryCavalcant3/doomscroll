import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiUrl, type FeedVideo, type Profile, type User } from "../api";
import { Avatar } from "../components/Avatar";
import { VideoViewer } from "./VideoViewer";
import { chatHref } from "../router";
import { StalkerList } from "./Stalker";
import { Voltar } from "../components/Voltar";

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
  /** Posição na grade do curtido aberto em tela cheia. */
  const [playing, setPlaying] = useState<number | null>(null);
  const own = nickname === me.nickname;
  const patchLiked = useCallback((id: string, change: Partial<FeedVideo>) => {
    setProfile((p) => p && { ...p, liked: p.liked.map((v) => (v.id === id ? { ...v, ...change } : v)) });
  }, []);
  // Os descurtidos saem da grade só ao fechar. No perfil de outra pessoa a curtida é de quem está
  // vendo, e a lista dela não muda.
  const closePlayer = useCallback(() => {
    setPlaying(null);
    if (own) setProfile((p) => p && { ...p, liked: p.liked.filter((v) => v.liked) });
  }, [own]);
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
      {!own && <Voltar href="#/feed" className="profile-voltar" />}
      <header className="profile-head">
        <Avatar who={profile} size={88} className="profile-avatar" />
        <h1>{title}</h1>
        {profile.name && <div className="hint">@{profile.nickname}</div>}
        {profile.isAi && <span className="badge">persona de IA</span>}
        {profile.role === "owner" && <span className="badge">dono do bunker</span>}
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        {profile.isAi && <p className="aviso-ia">Persona de IA: pode errar ou inventar detalhes.</p>}
        {own ? (
          <div className="profile-actions">
            <a className="btn btn-small btn-link" href="#/perfil/foto">
              Trocar foto
            </a>
            <a className="btn btn-small btn-link" href="#/certificado">
              Instalar como app
            </a>
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
        <StalkerList nickname={profile.nickname} name={title} />
      ) : profile.liked.length === 0 ? (
        <p className="hint profile-empty">
          {own ? "Seu estoque particular começa aqui. Os vídeos que você curtir ficam guardados nesta aba." : "Nenhum vídeo curtido ainda."}
        </p>
      ) : (
        <ul className="liked-grid">
          {profile.liked.map((v, i) => (
            <li key={v.id}>
              <button onClick={() => setPlaying(i)} aria-label={v.description ?? v.title ?? "Vídeo"}>
                {v.thumbUrl ? <img src={apiUrl(v.thumbUrl)} alt="" loading="lazy" /> : <span />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {playing !== null && (
        <VideoViewer
          videos={profile.liked}
          start={playing}
          title={own ? "Curtidos" : `Curtidos de ${title}`}
          onPatch={patchLiked}
          onClose={closePlayer}
        />
      )}
    </main>
  );
}
