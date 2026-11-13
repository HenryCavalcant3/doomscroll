import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, apiUrl, type Topic, type User, type Video } from "../api";

type Tab = "fila" | "topicos";

/** Tela 7 do SPEC (sem wireframe; segue o padrão dos outros). Personas entram no passo 8. */
export function OwnerPanel({ me }: { me: User }) {
  const [tab, setTab] = useState<Tab>("fila");

  if (me.role !== "owner") {
    return (
      <main className="screen placeholder">
        <h1>Painel do dono</h1>
        <p>Só o dono do bunker entra aqui. Ele usa o apelido dono e o PIN do .env.</p>
      </main>
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
      {tab === "fila" ? <Queue /> : <Topics />}
    </main>
  );
}

function useOwnerCall() {
  const [error, setError] = useState<string | null>(null);
  const call = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setError(null);
      try {
        return await fn();
      } catch (err) {
        // 401 já leva para a tela de entrada (api.ts).
        setError(err instanceof Error ? err.message : "Algo deu errado.");
        return undefined;
      }
    },
    [],
  );
  return { error, call };
}

function Queue() {
  const { error, call } = useOwnerCall();
  const [videos, setVideos] = useState<Video[] | null>(null);

  useEffect(() => {
    call(() => api.owner.pending()).then((list) => list && setVideos(list));
  }, [call]);

  async function decide(id: string, approve: boolean) {
    const done = await call(() => (approve ? api.owner.approve(id) : api.owner.reject(id)));
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

function Topics() {
  const { error, call } = useOwnerCall();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    call(() => api.topics()).then((t) => t && setTopics(t));
  }, [call]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const topic = await call(() => api.owner.createTopic(name));
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
