import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type Conversation, type Message, type User } from "../api";
import { conversationTitle, mergeMessages, shortTime, useRealtimeEvents } from "../chat";
import { Avatar } from "../components/Avatar";
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
    if (e.type === "ready") refresh(false);
    else if (e.type === "message" && e.message.conversationId === id) {
      setMessages((cur) => mergeMessages(cur, [e.message]));
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
  }, [messages]);

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

  const other = conv?.members[0];
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
            {other ? <Avatar who={other} size={40} /> : <span className="avatar" style={{ width: 40, height: 40 }} />}
            <span className="chat-who-text">
              <span className="chat-title">{conversationTitle(conv)}</span>
              {other?.isAi && <span className="chat-sub">persona de IA</span>}
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
        {messages.map((m) => {
          const mine = m.sender.nickname === me.nickname;
          return (
            <div key={m.id} className={`bubble${mine ? " mine" : ""}`} title={shortTime(m.createdAt)}>
              {m.text}
              <span className="bubble-time">{shortTime(m.createdAt)}</span>
            </div>
          );
        })}
      </div>

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
