import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, apiUrl, type DecisionTrigger, type Pauta, type PersonaDecision, type PersonaPanel, type Topic, type User, type Video } from "../api";
import { shortTime } from "../chat";
import { Avatar } from "../components/Avatar";
import { decisionText, reasonsText } from "../decisions";
import { profileHref } from "../router";
import { Voltar } from "../components/Voltar";

type Tab = "fila" | "topicos" | "pautas" | "personas";

/** Tela 7 do SPEC (sem wireframe; segue o padrão dos outros): fila de aprovação, tópicos, pautas do boletim e personas. */
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
      <header className="dono-topo">
        <Voltar href="#/perfil" className="dono-voltar" />
        <Avatar who={me} size={64} />
        <div>
          <h1>Painel do dono</h1>
          <div className="hint">@{me.nickname}</div>
        </div>
      </header>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "fila"} onClick={() => setTab("fila")}>
          Fila
        </button>
        <button role="tab" aria-selected={tab === "topicos"} onClick={() => setTab("topicos")}>
          Tópicos
        </button>
        <button role="tab" aria-selected={tab === "pautas"} onClick={() => setTab("pautas")}>
          Pautas
        </button>
        <button role="tab" aria-selected={tab === "personas"} onClick={() => setTab("personas")}>
          Personas
        </button>
      </div>
      {tab === "fila" ? <Queue /> : tab === "topicos" ? <Topics /> : tab === "pautas" ? <Pautas /> : <Personas />}
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
        setError(err instanceof Error ? err.message : "Deu ruim aqui no bunker. Tente de novo.");
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
      {videos.length === 0 && <p className="hint">Fila zerada. Nenhum vídeo esperando na porta.</p>}
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
  const [sensitive, setSensitive] = useState(false);

  useEffect(() => {
    call(() => api.topics()).then((t) => t && setTopics(t));
  }, [call]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const topic = await call(() => api.owner.createTopic(name, sensitive));
    if (topic) {
      setTopics((ts) => [...ts, topic].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setSensitive(false);
    }
  }

  async function toggle(t: Topic) {
    const updated = await call(() => api.owner.setSensitive(t.id, !t.sensitive));
    if (updated) setTopics((ts) => ts.map((x) => (x.id === updated.id ? updated : x)));
  }

  return (
    <>
      <p className="hint">Tópicos amplos agrupam melhor os vídeos. A IA só escolhe desta lista.</p>
      <p className="hint">
        Tópico sensível nunca vira o assunto do dia no Boletim do Bunker, e o vídeo dele não aparece lá. Vale a partir do próximo
        boletim.
      </p>
      <ul className="dono-lista">
        {topics.map((t) => (
          <li key={t.slug} className="dono-item">
            <span className="dono-item-texto">{t.name}</span>
            <label className="dono-check">
              <input type="checkbox" checked={t.sensitive} onChange={() => toggle(t)} />
              Sensível
            </label>
          </li>
        ))}
      </ul>
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
        <label className="dono-check">
          <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
          Tópico sensível
        </label>
        <button className="btn btn-small" type="submit" disabled={name.trim().length < 2}>
          Adicionar tópico
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}

const PAUTA_MAX = 200;

const usedOn = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });

/** Pautas de fofoca do boletim: entram quando o dia não teve fato curioso de verdade. */
function Pautas() {
  const { error, call } = useOwnerCall();
  const [pautas, setPautas] = useState<Pauta[] | null>(null);
  const [texto, setTexto] = useState("");
  const [editing, setEditing] = useState<{ id: string; texto: string } | null>(null);

  useEffect(() => {
    call(() => api.owner.pautas()).then((p) => p && setPautas(p));
  }, [call]);

  const replace = (p: Pauta) => setPautas((ps) => ps?.map((x) => (x.id === p.id ? p : x)) ?? null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const p = await call(() => api.owner.createPauta(texto));
    if (p) {
      setPautas((ps) => [p, ...(ps ?? [])]);
      setTexto("");
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const p = await call(() => api.owner.updatePauta(editing.id, { texto: editing.texto }));
    if (p) {
      replace(p);
      setEditing(null);
    }
  }

  async function toggle(p: Pauta) {
    const updated = await call(() => api.owner.updatePauta(p.id, { ativa: !p.ativa }));
    if (updated) replace(updated);
  }

  if (!pautas) return error ? <p className="error">{error}</p> : <p className="hint">Carregando…</p>;

  return (
    <>
      <p className="hint">
        Quando o dia não teve nada curioso de verdade, a persona de plantão sorteia uma pauta ativa que não saiu nos últimos 14
        dias e conta do jeito dela. Escreva {"{persona}"} para citar outra persona. Sem números e sem apelido de morador.
      </p>
      <form className="field" onSubmit={add}>
        <label htmlFor="pauta">Nova pauta</label>
        <textarea
          id="pauta"
          className="input dono-textarea"
          value={texto}
          maxLength={PAUTA_MAX}
          onChange={(e) => setTexto(e.target.value)}
          required
        />
        <button className="btn btn-small" type="submit" disabled={!texto.trim()}>
          Adicionar pauta
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="dono-lista">
        {pautas.map((p) =>
          editing?.id === p.id ? (
            <li key={p.id} className="dono-item dono-item-coluna">
              <form className="field" onSubmit={save}>
                <label htmlFor={`pauta-${p.id}`}>Editar pauta</label>
                <textarea
                  id={`pauta-${p.id}`}
                  className="input dono-textarea"
                  value={editing.texto}
                  maxLength={PAUTA_MAX}
                  onChange={(e) => setEditing({ id: p.id, texto: e.target.value })}
                  autoFocus
                />
                <div className="actions">
                  <button className="btn btn-primary btn-small" type="submit" disabled={!editing.texto.trim()}>
                    Salvar
                  </button>
                  <button className="btn btn-small" type="button" onClick={() => setEditing(null)}>
                    Cancelar
                  </button>
                </div>
              </form>
            </li>
          ) : (
            <li key={p.id} className={`dono-item dono-item-coluna${p.ativa ? "" : " dono-inativa"}`}>
              <span className="dono-item-texto">{p.texto}</span>
              <span className="hint">{p.ativa ? "" : "Desativada · "}{p.usadaEm ? `Saiu no boletim em ${usedOn(p.usadaEm)}` : "Ainda não saiu em nenhum boletim"}</span>
              <div className="actions">
                <button className="btn btn-small" type="button" onClick={() => setEditing({ id: p.id, texto: p.texto })}>
                  Editar
                </button>
                <button className="btn btn-small" type="button" onClick={() => toggle(p)}>
                  {p.ativa ? "Desativar" : "Ativar"}
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
    </>
  );
}

function Personas() {
  const { error, call } = useOwnerCall();
  const [panel, setPanel] = useState<PersonaPanel | null>(null);

  useEffect(() => {
    call(() => api.owner.personas()).then((p) => p && setPanel(p));
  }, [call]);

  if (!panel) return error ? <p className="error">{error}</p> : <p className="hint">Carregando…</p>;

  return (
    <>
      <p className="hint">
        Na última hora: {panel.lastHour} de {panel.rate} ações (comentários e mensagens). Acima do limite, os comentários
        esperam; as respostas no chat continuam, porque alguém está esperando. O limite é o PERSONA_RATE do .env.
      </p>
      <ul className="persona-list">
        {panel.personas.map((p) => (
          <li key={p.nickname}>
            <a className="persona-row" href={profileHref(p.nickname)}>
              <Avatar who={{ nickname: p.nickname, avatarUrl: p.avatarUrl }} size={40} />
              <span className="persona-text">
                <span className="persona-name">{p.name}</span>
                <span className="hint">
                  @{p.nickname} · atividade {Math.round(p.activity * 100)}%
                </span>
              </span>
              <span className="persona-count" aria-label={`${p.lastHour} ações na última hora`}>
                {p.lastHour}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <Decisions personas={panel.personas} />
    </>
  );
}

const TRIGGERS: { value: DecisionTrigger; label: string }[] = [
  { value: "video", label: "Vídeo aprovado" },
  { value: "mensagem", label: "Mensagens e grupo" },
  { value: "tique", label: "Puxar conversa" },
  { value: "boletim", label: "Boletim" },
];

/** Últimas decisões do JEV, filtradas por persona e por tipo, de 20 em 20. */
function Decisions({ personas }: { personas: PersonaPanel["personas"] }) {
  const { error, call } = useOwnerCall();
  const [persona, setPersona] = useState("");
  const [tipo, setTipo] = useState<DecisionTrigger | "">("");
  const [list, setList] = useState<PersonaDecision[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  // Página que chega depois de o filtro mudar é descartada.
  const latest = useRef(0);

  const fetchPage = useCallback((antes?: string) => api.owner.decisions({ persona, tipo: tipo || undefined, antes }), [persona, tipo]);

  useEffect(() => {
    const seq = ++latest.current;
    call(() => fetchPage()).then((page) => {
      if (seq !== latest.current) return;
      setLoading(false);
      if (!page) return;
      setList(page.decisions);
      setMore(page.more);
    });
  }, [call, fetchPage]);

  const loadMore = () => {
    const last = list?.[list.length - 1];
    if (!last) return;
    const seq = ++latest.current;
    setLoading(true);
    call(() => fetchPage(last.id)).then((page) => {
      if (seq !== latest.current) return;
      setLoading(false);
      if (!page) return;
      setList((cur) => [...(cur ?? []), ...page.decisions]);
      setMore(page.more);
    });
  };

  const filtered = persona !== "" || tipo !== "";
  return (
    <>
      <h2 className="section-title">Últimas decisões</h2>
      <div className="decision-filters">
        <div className="field">
          <label htmlFor="decisoes-persona">Persona</label>
          <select id="decisoes-persona" className="input" value={persona} onChange={(e) => {
              setList(null);
              setPersona(e.target.value);
            }}>
            <option value="">Todas</option>
            {personas.map((p) => (
              <option key={p.nickname} value={p.nickname}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="decisoes-tipo">Tipo</label>
          <select id="decisoes-tipo" className="input" value={tipo} onChange={(e) => {
              setList(null);
              setTipo(e.target.value as DecisionTrigger | "");
            }}>
            <option value="">Todos</option>
            {TRIGGERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {list === null ? (
        !error && <p className="hint">Carregando…</p>
      ) : list.length === 0 ? (
        <p className="hint">
          {filtered
            ? "Nenhuma decisão com esse filtro."
            : "Nenhuma decisão ainda. Elas aparecem quando um vídeo é aprovado ou alguém manda mensagem para uma persona."}
        </p>
      ) : (
        <ul className="decision-list">
          {list.map((d) => (
            <li key={d.id} className="decision">
              <span>
                <strong>{d.name}</strong> {decisionText(d)}
              </span>
              <span className="hint">
                {shortTime(d.createdAt)} · {reasonsText(d)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {more && list && (
        <button className="btn btn-small decision-more" onClick={loadMore} disabled={loading}>
          {loading ? "Carregando…" : "Carregar mais"}
        </button>
      )}
    </>
  );
}

