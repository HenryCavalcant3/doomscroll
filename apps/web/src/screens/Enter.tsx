import { useState, type FormEvent } from "react";
import logo from "../../../../docs/logo.svg";
import { api, auth, ApiError, type User } from "../api";

/** Tela 1 do SPEC (Entrada): apelido + PIN. Apelido novo cria a conta. */
export function Enter({ onEnter }: { onEnter(user: User): void }) {
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.enter(nickname, pin);
      auth.setToken(token);
      onEnter(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu para falar com o bunker. Confira a rede e tente de novo.");
      setBusy(false);
    }
  }

  return (
    <main className="screen enter">
      <img className="enter-logo" src={logo} alt="" width={96} height={96} />
      <div className="enter-head">
        <h1>Doomscroll</h1>
        <p className="hint">Vídeos curtos para o fim do mundo.</p>
      </div>
      <form className="enter-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="nickname">Apelido</label>
          <input
            id="nickname"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={30}
            value={nickname}
            onChange={(e) => setNickname(e.target.value.toLowerCase())}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="pin">PIN</label>
          <input
            id="pin"
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            maxLength={64}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            required
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy || !nickname || !pin}>
          Entrar
        </button>
      </form>
      <p className="hint">
        Primeira vez? Escolha um apelido (letras sem acento, números ou _) e um PIN de 4 a 6 números. A conta é
        criada na hora. O dono do bunker entra com o apelido <strong>dono</strong>.
      </p>
    </main>
  );
}
