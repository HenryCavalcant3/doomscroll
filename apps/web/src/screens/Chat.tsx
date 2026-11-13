import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { api, apiUrl, ApiError, REACTIONS, type Conversation, type Message, type SharedVideo, type User } from "../api";
import { applyReactions, conversationTitle, groupReactions, mergeMessages, nextPersonaReply, shortTime, useRealtimeEvents, type PersonaReply } from "../chat";
import { ConversationAvatar } from "../components/ConversationAvatar";
import { Player } from "../components/Player";
import { profileHref } from "../router";

const PAGE = 50;
/** Distância do fim (px) em que a conversa continua grudada nas mensagens novas. */
const STICK_PX = 80;

interface Props {
  id: string;
  me: User;
  /** Chamado depois de marcar mensagens como lidas (atualiza a bolinha da navegação). */
  onRead(): void;
}

/** Tela 5 do SPEC (wireframe `chat`): mensagens da conversa e campo para escrever. */
export function ChatScreen({ id, me, onRead }: Props) {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  /** Altura da conversa antes de carregar as antigas, para não pular de lugar. */
  const restoreFrom = useRef<number | null>(null);
  const lastRead = useRef<string | null>(null);
  const [playing, setPlaying] = useState<SharedVideo | null>(null);
  /** Mensagem com a escolha de reação aberta. */
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const closePlayer = useCallback(() => setPlaying(null), []);
  /** Persona escrevendo a resposta (ou que não conseguiu responder). */
  const [personaReply, setPersonaReply] = useState<PersonaReply>(null);

  // A escolha de reação abre embaixo da mensagem: na última, ficaria fora da tela.
  useEffect(() => {
    if (pickerFor) log.current?.querySelector(".react-picker")?.scrollIntoView({ block: "nearest" });
  }, [pickerFor]);

  // Última página: na abertura e a cada reconexão (traz o que chegou com a conexão caída).
  const refresh = useCallback(
    (first: boolean) =>
      Promise.all([api.conversation(id), api.messages(id)]).then(
        ([c, msgs]) => {
          setConv(c);
          setMessages((cur) => (first ? msgs : mergeMessages(cur, msgs)));
          if (first) setHasMore(msgs.length === PAGE);
          setError(null);
        },
        (err: Error) => {
          if (err instanceof ApiError && err.status === 404) setNotFound(true);
          else setError(err.message);
        },
      ),
    [id],
  );

  useEffect(() => {
    refresh(true);
    // Celular voltando da tela apagada: a conexão pode ter morrido sem avisar; busca o que chegou.
    const onVisible = () => !document.hidden && refresh(false);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  useRealtimeEvents((e) => {
    setPersonaReply((cur) => nextPersonaReply(cur, e, id));
    if (e.type === "ready") refresh(false);
    else if (e.type === "message" && e.message.conversationId === id) {
      setMessages((cur) => mergeMessages(cur, [e.message]));
    } else if (e.type === "reaction" && e.conversationId === id) {
      setMessages((cur) => applyReactions(cur, e.messageId, e.reactions));
    }
  });

  // Marca como lido até a última mensagem que está na tela (só com a tela visível).
  const markRead = useCallback(() => {
    const last = messages.at(-1);
    if (!last || document.hidden || last.id === lastRead.current) return;
    lastRead.current = last.id;
    if (last.sender.nickname === me.nickname) return;
    api.markRead(id, last.id).then(onRead, () => {
      lastRead.current = null;
    });
  }, [messages, id, me.nickname, onRead]);

  useEffect(() => {
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [markRead]);

  // Rolagem: segue as mensagens novas se a pessoa está no fim; mantém o lugar ao carregar antigas.
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    if (restoreFrom.current !== null) {
      el.scrollTop += el.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, personaReply]);

  const onScroll = () => {
    const el = log.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
  };

  const loadOlder = () => {
    const first = messages[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    api.messages(id, first.id).then(
      (older) => {
        restoreFrom.current = log.current?.scrollHeight ?? null;
        setMessages((cur) => mergeMessages(cur, older));
        setHasMore(older.length === PAGE);
        setLoadingOlder(false);
      },
      (err: Error) => {
        setError(err.message);
        setLoadingOlder(false);
      },
    );
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    setPersonaReply((cur) => (cur?.failed ? null : cur));
    api.sendMessage(id, body).then(
      (m) => {
        stick.current = true;
        setMessages((cur) => mergeMessages(cur, [m]));
        setText("");
        setSending(false);
      },
      (err: Error) => {
        setSendError(err.message);
        setSending(false);
      },
    );
  };

  // Uma reação por pessoa: escolher a mesma de novo tira.
  const react = (m: Message, emoji: string) => {
    setPickerFor(null);
    const current = m.reactions.find((r) => r.nickname === me.nickname)?.emoji;
    api.react(id, m.id, current === emoji ? null : emoji).then(
      (res) => setMessages((cur) => applyReactions(cur, m.id, res.reactions)),
      (err: Error) => setError(err.message),
    );
  };

  if (notFound) {
    return (
      <main className="screen placeholder">
        <h1>Conversa não encontrada</h1>
        <a className="btn btn-link" href="#/mensagens">
          Voltar para as mensagens
        </a>
      </main>
    );
  }

  const other = conv?.type === "direct" ? conv.members[0] : undefined;
  const group = conv?.type === "group";
  // O "+ reagir" fica à vista só na última mensagem dos outros (como no wireframe); nas outras, toque no balão.
  const lastOtherId = [...messages].reverse().find((m) => m.sender.nickname !== me.nickname)?.id;
  return (
    <main className="chat">
      <header className="chat-head">
        <a className="icon-btn" href="#/mensagens" aria-label="Voltar para as mensagens">
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </a>
        {conv && (
          <a className="chat-who" href={other ? profileHref(other.nickname) : undefined}>
            <ConversationAvatar conversation={conv} size={40} />
            <span className="chat-who-text">
              <span className="chat-title">{conversationTitle(conv)}</span>
              {other?.isAi && <span className="chat-sub">persona de IA</span>}
              {group && <span className="chat-sub">{conv.members.length + 1} pessoas</span>}
            </span>
          </a>
        )}
      </header>

      <div className="chat-log" ref={log} onScroll={onScroll} role="log" aria-live="polite">
        {hasMore && (
          <button className="btn btn-small chat-older" onClick={loadOlder} disabled={loadingOlder}>
            {loadingOlder ? "Carregando…" : "Mensagens anteriores"}
          </button>
        )}
        {error && <p className="error">{error}</p>}
        {conv && messages.length === 0 && <p className="hint chat-empty">Mande a primeira mensagem.</p>}
        {messages.map((m, i) => {
          const mine = m.sender.nickname === me.nickname;
          // No grupo, o apelido aparece no começo de cada sequência de mensagens da mesma pessoa.
          const showSender = group && !mine && messages[i - 1]?.sender.nickname !== m.sender.nickname;
          const reactions = groupReactions(m.reactions, me.nickname);
          const label = `Reagir à mensagem de ${mine ? "você" : `@${m.sender.nickname}`}`;
          return (
            <div key={m.id} className={`msg${mine ? " mine" : ""}`}>
              {showSender && (
                <a className="msg-sender" href={profileHref(m.sender.nickname)}>
                  @{m.sender.nickname}
                </a>
              )}
              {m.video ? (
                <div className="msg-video-wrap">
                  <button
                    className="msg-video"
                    onClick={() => setPlaying(m.video)}
                    aria-label={`Ver vídeo: ${m.video.description ?? m.video.title ?? "vídeo compartilhado"}`}
                  >
                    {m.video.thumbUrl && <img src={apiUrl(m.video.thumbUrl)} alt="" loading="lazy" />}
                    <PlayIcon />
                  </button>
                  <button className="msg-react-btn" onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)} aria-label={label}>
                    <span className="bubble-time">{shortTime(m.createdAt)}</span>
                  </button>
                </div>
              ) : (
                // div, não button: no celular dá para segurar e copiar o texto. Tocar abre as reações.
                <div
                  className={`bubble${mine ? " mine" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => window.getSelection()?.isCollapsed !== false && setPickerFor(pickerFor === m.id ? null : m.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPickerFor(pickerFor === m.id ? null : m.id);
                    }
                  }}
                  aria-label={`${m.text ?? ""}. ${label}`}
                  aria-expanded={pickerFor === m.id}
                >
                  {m.text}
                  <span className="bubble-time">{shortTime(m.createdAt)}</span>
                </div>
              )}
              {pickerFor === m.id ? (
                <div className="react-picker" role="group" aria-label="Escolha uma reação">
                  {REACTIONS.map((emoji) => {
                    const chosen = m.reactions.some((r) => r.nickname === me.nickname && r.emoji === emoji);
                    return (
                      <button key={emoji} aria-pressed={chosen} onClick={() => react(m, emoji)} aria-label={chosen ? `Tirar ${emoji}` : `Reagir com ${emoji}`}>
                        {emoji}
                      </button>
                    );
                  })}
                </div>
              ) : (
                (reactions.length > 0 || m.id === lastOtherId) && (
                  <div className="reactions">
                    {reactions.map((r) => (
                      <button
                        key={r.emoji}
                        className={`reaction${r.mine ? " mine" : ""}`}
                        onClick={() => react(m, r.emoji)}
                        title={r.who.map((n) => `@${n}`).join(", ")}
                        aria-label={`${r.emoji} ${r.count}: ${r.who.join(", ")}${r.mine ? " (toque para tirar a sua)" : ""}`}
                      >
                        {r.emoji} {r.count > 1 && r.count}
                      </button>
                    ))}
                    <button className="reaction reaction-add" onClick={() => setPickerFor(m.id)} aria-label={label}>
                      {reactions.length ? "+" : "+ reagir"}
                    </button>
                  </div>
                )
              )}
            </div>
          );
        })}
        {personaReply && !personaReply.failed && (
          <div className="msg">
            <div className={`bubble${personaReply.text ? "" : " typing"}`} aria-live="polite">
              {personaReply.text ?? <span aria-label={`@${personaReply.nickname} está digitando`}>digitando…</span>}
            </div>
          </div>
        )}
        {personaReply?.failed && <p className="hint chat-failed">@{personaReply.nickname} não conseguiu responder agora. Tente mandar de novo.</p>}
      </div>

      {playing && <Player video={playing} onClose={closePlayer} />}
      {sendError && <p className="error chat-send-error">{sendError}</p>}
      <form className="chat-compose" onSubmit={send}>
        <label className="sr-only" htmlFor="mensagem">
          Mensagem
        </label>
        <input
          id="mensagem"
          className="input"
          placeholder="Mensagem"
          autoComplete="off"
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!conv}
        />
        <button className="btn btn-primary" disabled={!text.trim() || sending || !conv}>
          Enviar
        </button>
      </form>
    </main>
  );
}

function PlayIcon() {
  return (
    <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden="true">
      <path d="M8 5l11 7-11 7z" />
    </svg>
  );
}
