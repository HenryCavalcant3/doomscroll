import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, apiUrl, ApiError, type Topic, type Video } from "../api";
import { session } from "../router";

const KEY = "doomscroll.pinDono";
type Tab = "fila" | "topicos";

/** Tela 7 do SPEC (sem wireframe; segue o padrão dos outros). Personas entram no passo 8. */
export function OwnerPanel() {
  const [pin, setPin] = useState<string | null>(() => session.get(KEY));
  const [tab, setTab] = useState<Tab>("fila");

  const logout = () => {
    session.set(KEY, null);
    setPin(null);
  };

  if (!pin) {
    return (
      <PinGate
        onEnter={(p) => {
          session.set(KEY, p);
          setPin(p);
        }}
      />
    );
  }

  return (
    <main className="screen">
      <h1>Painel do dono</h1>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "fila"} onClick={() => setTab("fila")}>
          Fila de aprovação
        </button>
        <button role="tab" aria-selected={tab === "topicos"} onClick={() => setTab("topicos")}>
          Tópicos
        </button>
      </div>
      {tab === "fila" ? <Queue pin={pin} onUnauthorized={logout} /> : <Topics pin={pin} onUnauthorized={logout} />}
      <button className="btn btn-small" type="button" onClick={logout}>
        Sair do painel
      </button>
    </main>
  );
}

function PinGate({ onEnter }: { onEnter(pin: string): void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.owner.login(pin);
      onEnter(pin);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "PIN incorreto." : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <h1>Painel do dono</h1>
      <form className="field" onSubmit={submit}>
        <label htmlFor="pin">PIN do dono do bunker</label>
        <input
          id="pin"
          className="input"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          required
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !pin}>
          Entrar
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="hint">
        O PIN é o OWNER_PIN do .env. Sem ele, um PIN foi gerado na primeira subida e aparece no log da api
        (docker compose logs api).
      </p>
    </main>
  );
}

interface PanelProps {
  pin: string;
  onUnauthorized(): void;
}

function useOwnerCall({ onUnauthorized }: PanelProps) {
  const [error, setError] = useState<string | null>(null);
  const call = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setError(null);
      try {
        return await fn();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
        else setError(err instanceof Error ? err.message : "Algo deu errado.");
        return undefined;
      }
    },
    [onUnauthorized],
  );
  return { error, call };
}

function Queue(props: PanelProps) {
  const { pin } = props;
  const { error, call } = useOwnerCall(props);
  const [videos, setVideos] = useState<Video[] | null>(null);

  useEffect(() => {
    call(() => api.owner.pending(pin)).then((list) => list && setVideos(list));
  }, [call, pin]);

  async function decide(id: string, approve: boolean) {
    const done = await call(() => (approve ? api.owner.approve(pin, id) : api.owner.reject(pin, id)));
    if (done) setVideos((vs) => vs?.filter((v) => v.id !== id) ?? null);
  }

  if (!videos) return error ? <p className="error">{error}</p> : <p className="hint">Carregando…</p>;

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {videos.length === 0 && <p className="hint">Nada esperando aprovação.</p>}
      {videos.map((v) => (
        <article key={v.id} className="card review">
          {v.videoUrl && (
            <video
              src={apiUrl(v.videoUrl)}
              poster={v.thumbUrl ? apiUrl(v.thumbUrl) : undefined}
              controls
              playsInline
              preload="metadata"
            />
          )}
          <h2>{v.title ?? "Sem título"}</h2>
          {v.description && <p className="hint">{v.description}</p>}
          <div className="pills">
            {v.topics.map((t) => (
              <span key={t.slug} className="tag">
                {t.name.toLowerCase()}
              </span>
            ))}
          </div>
          <a href={v.sourceUrl} target="_blank" rel="noreferrer noopener">
            {v.sourceUrl}
          </a>
          <div className="actions">
            <button className="btn btn-primary btn-small" type="button" onClick={() => decide(v.id, true)}>
              Aprovar
            </button>
            <button className="btn btn-small" type="button" onClick={() => decide(v.id, false)}>
              Rejeitar
            </button>
          </div>
        </article>
      ))}
    </>
  );
}

function Topics(props: PanelProps) {
  const { pin } = props;
  const { error, call } = useOwnerCall(props);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    call(() => api.topics()).then((t) => t && setTopics(t));
  }, [call]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const topic = await call(() => api.owner.createTopic(pin, name));
    if (topic) {
      setTopics((ts) => [...ts, topic].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
    }
  }

  return (
    <>
      <p className="hint">Tópicos amplos agrupam melhor os vídeos. A IA só escolhe desta lista.</p>
      <div className="pills">
        {topics.map((t) => (
          <span key={t.slug} className="tag">
            {t.name.toLowerCase()}
          </span>
        ))}
      </div>
      <form className="field" onSubmit={add}>
        <label htmlFor="topic">Novo tópico</label>
        <input
          id="topic"
          className="input"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn btn-small" type="submit" disabled={name.trim().length < 2}>
          Adicionar tópico
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
