import { useState, type FormEvent } from "react";
import logo from "../../../docs/logo.svg";
import { askModel, type AiTestResult } from "./api";

export function App() {
  const [prompt, setPrompt] = useState("Dê bom dia aos sobreviventes do bunker.");
  const [result, setResult] = useState<AiTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await askModel(prompt));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <img src={logo} alt="" width={96} height={96} />
      <h1>Doomscroll</h1>
      <p className="tagline">Vídeos curtos para o fim do mundo.</p>

      <form onSubmit={onSubmit}>
        <label htmlFor="prompt">Teste da IA do bunker</label>
        <textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={2000} />
        <button type="submit" disabled={loading || !prompt.trim()}>
          {loading ? "Pensando…" : "Enviar"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {result && (
        <section className="answer">
          <p>{result.response}</p>
          <small>
            {result.model} · {(result.durationMs / 1000).toFixed(1)} s
          </small>
        </section>
      )}
    </main>
  );
}
