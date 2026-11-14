import { useEffect, useState, type FormEvent } from "react";
import { api, auth, ApiError, type User } from "../api";
import { Barata } from "../components/Barata";
import { PIN_LENGTH, PinBoxes } from "../components/PinBoxes";

/** Tela 1 do SPEC (Entrada): apelido + PIN de 6 números. Apelido novo cria a conta (docs/acabamento/telas/entrada.html). */
export function Enter({ onEnter }: { onEnter(user: User): void }) {
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // O selo "Bunker no ar" só aparece quando a api respondeu de verdade.
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let alive = true;
    api.health().then((ok) => alive && setOnline(ok));
    return () => {
      alive = false;
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.enter(nickname, pin);
      auth.setToken(token);
      onEnter(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "O bunker não respondeu. Confira se este aparelho está na rede dele e tente de novo.");
      setPin("");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="faixa faixa-topo" aria-hidden="true" />
      <main className="entrada">
        <Barata size={112} className="entrada-barata" />
        <div className="entrada-marca">doomscroll</div>
        <p className="entrada-slogan">Vídeos curtos para o fim do mundo.</p>
        {online && (
          <div className="entrada-selo">
            <span className="entrada-luz pisca" aria-hidden="true" />
            Bunker no ar
          </div>
        )}
        <form className="entrada-porta" onSubmit={submit}>
          <span className="parafuso" aria-hidden="true" />
          <span className="parafuso" aria-hidden="true" />
          <span className="parafuso" aria-hidden="true" />
          <span className="parafuso" aria-hidden="true" />
          <h1>Quem vem lá?</h1>
          <label htmlFor="nickname">Apelido</label>
          <input
            id="nickname"
            className="entrada-campo"
            placeholder="Como te chamam por aqui"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={30}
            value={nickname}
            onChange={(e) => setNickname(e.target.value.toLowerCase())}
            required
          />
          <fieldset>
            <legend>PIN de {PIN_LENGTH} números</legend>
            <PinBoxes value={pin} onChange={setPin} disabled={busy} />
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy || !nickname || pin.length !== PIN_LENGTH}>
            Entrar
          </button>
        </form>
        <p className="entrada-rodape">
          Primeira vez por aqui? Escolha um apelido e um PIN. Sua vaga no bunker é criada na hora.
        </p>
      </main>
    </>
  );
}
