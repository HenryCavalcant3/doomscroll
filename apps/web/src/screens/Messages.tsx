import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { api, type Conversation, type User } from "../api";
import { conversationTitle, shortTime, useRealtimeEvents } from "../chat";
import { ConversationAvatar } from "../components/ConversationAvatar";
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
    const onVisible = () => !document.hidden && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);
  // Resposta que chega depois de a pessoa sair da tela não leva mais para a conversa.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useRealtimeEvents(() => load());

  const open = (e: FormEvent) => {
    e.preventDefault();
    if (!nickname.trim() || opening) return;
    setOpening(true);
    setOpenError(null);
    api.openDirect(nickname).then(
      (c) => {
        if (mounted.current) window.location.hash = chatHref(c.id);
      },
      (err: Error) => {
        if (!mounted.current) return;
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
      <NewGroup mounted={mounted} />

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
                  <ConversationAvatar conversation={c} size={48} />
                  <span className="inbox-text">
                    <span className={`inbox-name${c.unread ? " unread" : ""}`}>{conversationTitle(c)}</span>
                    <span className="inbox-preview">
                      {last ? `${mine ? "Você: " : c.type === "group" ? `@${last.sender.nickname}: ` : ""}${last.video ? "mandou um vídeo" : (last.text ?? "")}` : c.bunker ? "Todo mundo da rede está aqui" : "Sem mensagens"}
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

/** Grupo novo: nome e apelidos de quem entra (separados por vírgula ou espaço). */
function NewGroup({ mounted }: { mounted: RefObject<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [people, setPeople] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nicknames = people.split(/[\s,]+/).map((n) => n.replace(/^@/, "")).filter(Boolean);

  if (!open) {
    return (
      <button className="btn btn-small inbox-group-btn" onClick={() => setOpen(true)}>
        Novo grupo
      </button>
    );
  }

  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || nicknames.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    api.createGroup(name, nicknames).then(
      (c) => {
        if (mounted.current) window.location.hash = chatHref(c.id);
      },
      (err: Error) => {
        if (!mounted.current) return;
        setError(err.message);
        setBusy(false);
      },
    );
  };

  return (
    <form className="card group-form" onSubmit={create}>
      <div className="field">
        <label htmlFor="grupo-nome">Nome do grupo</label>
        <input id="grupo-nome" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="grupo-pessoas">Quem entra</label>
        <input
          id="grupo-pessoas"
          className="input"
          placeholder="@ana, @bia"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={people}
          onChange={(e) => setPeople(e.target.value)}
        />
        <p className="hint">Apelidos separados por vírgula ou espaço. Você entra automaticamente.</p>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="group-actions">
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancelar
        </button>
        <button className="btn btn-primary" disabled={!name.trim() || nicknames.length === 0 || busy}>
          Criar grupo
        </button>
      </div>
    </form>
  );
}
