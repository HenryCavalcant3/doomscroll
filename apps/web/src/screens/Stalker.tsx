import { useCallback, useEffect, useState } from "react";
import { api, apiUrl, ApiError, type Conversation, type Message, type SharedVideo } from "../api";
import { groupReactions, mergeMessages, shortTime } from "../chat";
import { Avatar } from "../components/Avatar";
import { ConversationAvatar } from "../components/ConversationAvatar";
import { Player } from "../components/Player";
import { PlayIcon } from "./Chat";
import { chatHref, profileHref, stalkerHref } from "../router";

const PAGE = 50;

/** Prévia da última mensagem: "Rato: para de me mandar isso" ou "@kelly mandou um vídeo". */
export function stalkerPreview(c: Conversation): string {
  const last = c.lastMessage;
  if (!last) return "Sem mensagens";
  return last.video ? `@${last.sender.nickname} mandou um vídeo` : `@${last.sender.nickname}: ${last.text ?? ""}`;
}

/**
 * Aba "Modo stalker" do perfil de persona (wireframe `persona`, SPEC 7.5): as conversas dela com
 * outras personas, só para ler. O Grupo do Bunker aparece como atalho para o chat normal do grupo,
 * onde a pessoa já está e pode escrever (decisão da fase 4: o stalker nunca mostra conversa com gente).
 */
export function StalkerList({ nickname, name }: { nickname: string; name: string }) {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [bunker, setBunker] = useState<Conversation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stalkerConversations(nickname).then(setList, (err: Error) => setError(err.message));
    api.conversations().then(
      (cs) => setBunker(cs.find((c) => c.bunker) ?? null),
      () => {},
    );
  }, [nickname]);

  return (
    <>
      <p className="notice">Somente leitura. Você está espiando as conversas de {name} com outras personas.</p>
      {error && <p className="error">{error}</p>}
      <ul className="inbox-list stalker-list">
        {list?.map((c) => {
          const other = c.members[0];
          return (
            <li key={c.id}>
              <a className="inbox-row" href={stalkerHref(nickname, c.id)}>
                {other ? <Avatar who={other} size={44} /> : <ConversationAvatar conversation={c} size={44} />}
                <span className="inbox-text">
                  <span className="inbox-name">
                    {name} e @{other?.nickname ?? "?"}
                  </span>
                  <span className="inbox-preview">{stalkerPreview(c)}</span>
                </span>
                {c.lastMessage && <span className="hint">{shortTime(c.lastMessage.createdAt)}</span>}
              </a>
            </li>
          );
        })}
        {bunker && (
          <li>
            <a className="inbox-row" href={chatHref(bunker.id)}>
              <ConversationAvatar conversation={bunker} size={44} />
              <span className="inbox-text">
                <span className="inbox-name">{bunker.name ?? "Grupo do Bunker"}</span>
                <span className="inbox-preview">Todas as personas · você pode entrar</span>
              </span>
            </a>
          </li>
        )}
      </ul>
      {list?.length === 0 && <p className="hint profile-empty">{name} ainda não conversou com outras personas.</p>}
    </>
  );
}

/** Conversa entre duas personas, só para ler: sem campo de mensagem e sem reagir. */
export function StalkerChat({ nickname, id }: { nickname: string; id: string }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [playing, setPlaying] = useState<SharedVideo | null>(null);
  const closePlayer = useCallback(() => setPlaying(null), []);

  // Quem espia não é membro, então não recebe avisos em tempo real: busca de novo ao voltar para a tela.
  const refresh = useCallback(
    (first: boolean) =>
      api.stalkerMessages(nickname, id).then(
        (msgs) => {
          setMessages((cur) => (first || !cur ? msgs : mergeMessages(cur, msgs)));
          if (first) setHasMore(msgs.length === PAGE);
        },
        (err: Error) => {
          if (err instanceof ApiError && err.status === 404) setNotFound(true);
          else setError(err.message);
        },
      ),
    [nickname, id],
  );

  useEffect(() => {
    refresh(true);
    const onVisible = () => !document.hidden && refresh(false);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const loadOlder = () => {
    const first = messages?.[0];
    if (!first) return;
    setLoadingOlder(true);
    api.stalkerMessages(nickname, id, first.id).then(
      (older) => {
        setMessages((cur) => [...older, ...(cur ?? [])]);
        setHasMore(older.length === PAGE);
        setLoadingOlder(false);
      },
      (err: Error) => {
        setError(err.message);
        setLoadingOlder(false);
      },
    );
  };

  if (notFound) {
    return (
      <main className="screen placeholder">
        <h1>Conversa não encontrada</h1>
        <a className="btn btn-link" href={profileHref(nickname)}>
          Voltar para o perfil
        </a>
      </main>
    );
  }

  const others = [...new Set((messages ?? []).map((m) => m.sender.nickname))].filter((n) => n !== nickname);
  return (
    <main className="chat">
      <header className="chat-head">
        <a className="icon-btn" href={profileHref(nickname)} aria-label="Voltar para o perfil">
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </a>
        <span className="chat-who-text">
          <span className="chat-title">
            @{nickname}
            {others.length ? ` e @${others.join(", @")}` : ""}
          </span>
          <span className="chat-sub">modo stalker · somente leitura</span>
        </span>
      </header>

      <div className="chat-log" role="log">
        {hasMore && (
          <button className="btn btn-small chat-older" onClick={loadOlder} disabled={loadingOlder}>
            {loadingOlder ? "Carregando…" : "Mensagens anteriores"}
          </button>
        )}
        {error && <p className="error">{error}</p>}
        {messages === null && !error && <p className="hint chat-empty">Carregando…</p>}
        {messages?.map((m, i) => {
          const showSender = messages[i - 1]?.sender.nickname !== m.sender.nickname;
          const reactions = groupReactions(m.reactions, "");
          return (
            <div key={m.id} className="msg">
              {showSender && (
                <a className="msg-sender" href={profileHref(m.sender.nickname)}>
                  @{m.sender.nickname}
                </a>
              )}
              {m.video ? (
                <div className="msg-video-wrap">
                  <button className="msg-video" onClick={() => setPlaying(m.video)} aria-label={`Ver vídeo: ${m.video.description ?? m.video.title ?? "vídeo compartilhado"}`}>
                    {m.video.thumbUrl && <img src={apiUrl(m.video.thumbUrl)} alt="" loading="lazy" />}
                    <PlayIcon />
                  </button>
                  <span className="bubble-time">{shortTime(m.createdAt)}</span>
                </div>
              ) : (
                <div className="bubble stalker-bubble">
                  {m.text}
                  <span className="bubble-time">{shortTime(m.createdAt)}</span>
                </div>
              )}
              {reactions.length > 0 && (
                <div className="reactions">
                  {reactions.map((r) => (
                    <span key={r.emoji} className="reaction" title={r.who.map((n) => `@${n}`).join(", ")}>
                      {r.emoji} {r.count > 1 && r.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {playing && <Player video={playing} onClose={closePlayer} />}
    </main>
  );
}
