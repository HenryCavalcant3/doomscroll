import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, apiUrl, ApiError, type FeedVideo } from "../api";
import { Barata } from "../components/Barata";
import { session } from "../router";
import { VideoViewer } from "./VideoViewer";
import { Voltar } from "../components/Voltar";

/** A última busca volta ao reabrir a tela (fechou o vídeo, voltou do perfil de alguém). */
const LAST_QUERY = "doomscroll.busca";

type State =
  | { kind: "vazio" }
  | { kind: "buscando"; query: string }
  | { kind: "pronto"; query: string; videos: FeedVideo[]; semantic: boolean }
  | { kind: "erro"; query: string; message: string };

/**
 * Busca (SPEC 5.2 e 7.6), aberta pela lupa do feed: poucos resultados, só os que têm as palavras ou
 * se destacam no significado. Com o campo vazio não mostra nada, para não virar galeria do acervo.
 */
export function SearchScreen() {
  const [last] = useState(() => session.get(LAST_QUERY));
  const [text, setText] = useState(last ?? "");
  const [state, setState] = useState<State>(last ? { kind: "buscando", query: last } : { kind: "vazio" });
  const [playing, setPlaying] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  /** Pede os resultados; uma resposta atrasada de uma busca anterior é ignorada. */
  const load = useCallback((query: string) => {
    const mine = ++seq.current;
    api.search(query).then(
      (res) => mine === seq.current && setState({ kind: "pronto", query, ...res }),
      (err: unknown) =>
        mine === seq.current &&
        setState({
          kind: "erro",
          query,
          message: err instanceof ApiError ? err.message : "O bunker não respondeu. Tente de novo.",
        }),
    );
  }, []);

  const run = (raw: string) => {
    const query = raw.replace(/\s+/g, " ").trim();
    if (query.length < 2) return;
    session.set(LAST_QUERY, query);
    setState({ kind: "buscando", query });
    load(query);
  };

  // Reabre com a última busca; sem ela, o campo já vem pronto para digitar.
  useEffect(() => {
    if (last) load(last);
    else input.current?.focus();
  }, [last, load]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    input.current?.blur(); // fecha o teclado para mostrar os resultados
    run(text);
  };

  const patch = useCallback((id: string, change: Partial<FeedVideo>) => {
    setState((s) => (s.kind === "pronto" ? { ...s, videos: s.videos.map((v) => (v.id === id ? { ...v, ...change } : v)) } : s));
  }, []);
  const closeViewer = useCallback(() => setPlaying(null), []);

  return (
    <main className="screen busca">
      <form className="busca-topo" onSubmit={submit} role="search">
        <Voltar href="#/feed" className="busca-voltar" />
        <input
          ref={input}
          className="input busca-campo"
          type="search"
          enterKeyHint="search"
          aria-label="Buscar vídeos"
          placeholder="Buscar vídeos"
          maxLength={100}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn btn-primary btn-small" type="submit" disabled={text.trim().length < 2}>
          Buscar
        </button>
      </form>

      {state.kind === "vazio" && (
        <div className="estado busca-estado">
          <h1>Procure por um assunto</h1>
          <p className="estado-sub">Busque por assunto, nome ou algo que alguém fala no vídeo.</p>
        </div>
      )}

      {state.kind === "buscando" && (
        <div className="estado busca-estado" role="status">
          <h1>Vasculhando as prateleiras…</h1>
        </div>
      )}

      {state.kind === "erro" && (
        <div className="busca-estado">
          <p className="error" role="alert">
            {state.message}
          </p>
          <button className="btn" onClick={() => run(state.query)}>
            Tentar de novo
          </button>
        </div>
      )}

      {state.kind === "pronto" && state.videos.length === 0 && (
        <div className="estado busca-estado">
          <Barata size={88} />
          <h1>Nem a barata achou isso</h1>
          <p className="estado-sub">Nenhum vídeo do estoque combina com “{state.query}”. Tente outras palavras.</p>
          {!state.semantic && <p className="estado-sub">A IA está fora do ar: a busca usou só as palavras.</p>}
        </div>
      )}

      {state.kind === "pronto" && state.videos.length > 0 && (
        <>
          <p className="hint busca-total" role="status">
            {state.videos.length === 1 ? "1 vídeo" : `${state.videos.length} vídeos`} para “{state.query}”
            {!state.semantic && " (a IA está fora do ar: só pelas palavras)"}
          </p>
          <ul className="liked-grid">
            {state.videos.map((v, i) => (
              <li key={v.id}>
                <button onClick={() => setPlaying(i)} aria-label={v.description ?? v.title ?? "Vídeo"}>
                  {v.thumbUrl ? <img src={apiUrl(v.thumbUrl)} alt="" loading="lazy" /> : <span />}
                </button>
              </li>
            ))}
          </ul>
          {playing !== null && (
            <VideoViewer videos={state.videos} start={playing} title={`Busca: ${state.query}`} onPatch={patch} onClose={closeViewer} />
          )}
        </>
      )}
    </main>
  );
}
