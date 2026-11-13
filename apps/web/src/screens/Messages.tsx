import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type Conversation, type User } from "../api";
import { conversationTitle, shortTime, useRealtimeEvents } from "../chat";
import { Avatar } from "../components/Avatar";
import { chatHref } from "../router";

/** Tela 4 do SPEC (caixa de entrada): conversas, da mais recente para a mais antiga. */
export function Messages({ me }: { me: User }) {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api.conversations().then(
        (cs) => {
          setList(cs);
          setError(null);
        },
        (err: Error) => setError(err.message),
      ),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);
  useRealtimeEvents(() => load());

  const open = (e: FormEvent) => {
    e.preventDefault();
    if (!nickname.trim() || opening) return;
    setOpening(true);
    setOpenError(null);
    api.openDirect(nickname).then(
      (c) => {
        window.location.hash = chatHref(c.id);
      },
      (err: Error) => {
        setOpenError(err.message);
        setOpening(false);
      },
    );
  };

  return (
    <main className="screen inbox">
      <h1>Mensagens</h1>

      <form className="inbox-new" onSubmit={open}>
        <label className="sr-only" htmlFor="nova-conversa">
          Conversar com (apelido)
        </label>
        <input
          id="nova-conversa"
          className="input"
          placeholder="Conversar com @apelido"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <button className="btn btn-primary" disabled={!nickname.trim() || opening}>
          Abrir
        </button>
      </form>
      {openError && <p className="error">{openError}</p>}

      {error && <p className="error">Não deu para carregar as conversas: {error}</p>}
      {list === null ? (
        !error && <p className="hint">Carregando…</p>
      ) : list.length === 0 ? (
        <p className="hint">Nenhuma conversa ainda. Abra o perfil de alguém ou digite um apelido acima.</p>
      ) : (
        <ul className="inbox-list">
          {list.map((c) => {
            const last = c.lastMessage;
            const mine = last?.sender.nickname === me.nickname;
            return (
              <li key={c.id}>
                <a className="inbox-row" href={chatHref(c.id)}>
                  {c.members[0] ? <Avatar who={c.members[0]} size={48} /> : <span className="avatar" style={{ width: 48, height: 48 }} />}
                  <span className="inbox-text">
                    <span className={`inbox-name${c.unread ? " unread" : ""}`}>{conversationTitle(c)}</span>
                    <span className="inbox-preview">
                      {last ? `${mine ? "Você: " : ""}${last.text ?? "vídeo"}` : "Sem mensagens"}
                    </span>
                  </span>
                  <span className="inbox-meta">
                    {last && <span className="hint">{shortTime(last.createdAt)}</span>}
                    {c.unread > 0 && (
                      <span className="unread-count" aria-label={`${c.unread} não ${c.unread === 1 ? "lida" : "lidas"}`}>
                        {c.unread > 99 ? "99+" : c.unread}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
