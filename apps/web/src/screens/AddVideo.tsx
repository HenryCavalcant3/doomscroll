import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Topic, type Video } from "../api";
import { TopicPicker } from "../components/TopicPicker";
import { session } from "../router";
import { isProcessing, processingSteps } from "../stages";

const POLL_MS = 2000;
const KEY = "doomscroll.videoEmAndamento";

/** Tela 3 do SPEC (docs/wireframes/adicionar). */
export function AddVideo() {
  const [link, setLink] = useState("");
  const [video, setVideo] = useState<Video | null>(null);
  const [videoId, setVideoId] = useState<string | null>(() => session.get(KEY));
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.topics().then(setTopics, () => setError("Não foi possível carregar os tópicos."));
  }, []);

  // Acompanha o vídeo até o fim do processamento.
  useEffect(() => {
    session.set(KEY, videoId);
    if (!videoId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const v = await api.video(videoId);
        if (stop) return;
        setVideo(v);
        if (isProcessing(v)) timer = setTimeout(tick, POLL_MS);
        else if (v.stage === "aguardando_confirmacao") setSelected((s) => (s.length ? s : v.topics.map((t) => t.slug)));
      } catch {
        if (!stop) timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [videoId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const v = await api.submitVideo(link);
      setVideo(v);
      setSelected([]);
      setVideoId(v.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && typeof err.body.id === "string") {
        setError("Esse vídeo já está no bunker. Mostrando o andamento dele.");
        setSelected([]);
        setVideoId(err.body.id);
      } else {
        setError(err instanceof Error ? err.message : "Deu ruim aqui no bunker. Tente de novo.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!video) return;
    setBusy(true);
    setError(null);
    try {
      setVideo(await api.confirmTopics(video.id, selected));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deu ruim aqui no bunker. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setVideo(null);
    setVideoId(null);
    setSelected([]);
    setLink("");
    setError(null);
  }

  const awaitingTopics = video?.stage === "aguardando_confirmacao";
  const finished = video && !isProcessing(video) && !awaitingTopics;

  return (
    <main className="screen">
      <h1>Adicionar vídeo</h1>

      {!video && (
        <form className="field" onSubmit={submit}>
          <label htmlFor="link">Link do vídeo</label>
          <input
            id="link"
            className="input"
            type="url"
            inputMode="url"
            placeholder="Cole o link (Shorts, TikTok)"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            required
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !link.trim()}>
            {busy ? "Enviando…" : "Baixar para o bunker"}
          </button>
        </form>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      {video && (
        <section className="card" aria-live="polite">
          <div className="section-title">Processamento</div>
          {video.title && <p className="hint">{video.title}</p>}
          {processingSteps(video).map((s) => (
            <div key={s.label} className={`row ${s.state.replace(" ", "-")}`}>
              <span>{s.label}</span>
              <span className="state">{s.state}</span>
            </div>
          ))}
          {video.status === "falhou" && video.error && <p className="error">{video.error}</p>}
        </section>
      )}

      {awaitingTopics && (
        <>
          <section className="field">
            <div className="section-title">Tópicos sugeridos pela IA</div>
            {video.description && <p className="hint">{video.description}</p>}
            <TopicPicker
              topics={topics}
              suggested={video.topics.filter((t) => t.source === "ai").map((t) => t.slug)}
              selected={selected}
              onChange={setSelected}
            />
          </section>
          <p className="hint">Depois de confirmar, o vídeo fica pendente até o dono do bunker aprovar.</p>
          <button className="btn" type="button" onClick={confirm} disabled={busy || selected.length === 0}>
            Confirmar tópicos
          </button>
        </>
      )}

      {finished && (
        <>
          <p className="hint">
            {video.status === "pendente" && "Pronto! O vídeo está esperando a aprovação do dono do bunker."}
            {video.status === "aprovado" && "Esse vídeo já foi aprovado e está no bunker."}
            {video.status === "rejeitado" && "O dono do bunker recusou esse vídeo."}
            {video.status === "falhou" && "Não deu para processar esse vídeo."}
          </p>
          <button className="btn" type="button" onClick={reset}>
            Adicionar outro vídeo
          </button>
        </>
      )}
    </main>
  );
}
