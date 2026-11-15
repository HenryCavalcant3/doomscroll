import { useState, type FormEvent } from "react";
import { api, ApiError, type User } from "../api";
import { avatarSrc, DEFAULT_AVATAR, MORADOR_AVATARS } from "../avatars";
import { Avatar } from "../components/Avatar";
import { Voltar } from "../components/Voltar";

interface Props {
  me: User;
  /** Texto do botão: "Salvar" no perfil, "Entrar no bunker" no segundo passo da criação de conta. */
  submitLabel: string;
  /** Link do voltar (só no perfil; na criação de conta não há para onde voltar). */
  backHref?: string;
  onSaved(user: User): void;
}

/** Escolha da foto de perfil (docs/avatares/selecao.html): a prévia do cartão acompanha o item marcado. */
export function AvatarPicker({ me, submitLabel, backHref, onSaved }: Props) {
  const [choice, setChoice] = useState(me.avatar ?? DEFAULT_AVATAR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(choice === me.avatar ? me : await api.setAvatar(choice));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "O bunker não respondeu. Tente de novo.");
      setBusy(false);
    }
  }

  return (
    <div className="foto">
      <header className="foto-topo">
        {backHref && (
          <Voltar href={backHref} />
        )}
        <div className="foto-topo-titulo">Foto de perfil</div>
      </header>
      <form className="foto-form" onSubmit={submit}>
        <h1>O que você trouxe para o bunker?</h1>
        <p className="foto-sub">Escolha um item para ser a sua foto de perfil.</p>

        <div className="foto-previa">
          <Avatar who={{ ...me, avatar: choice }} size={64} />
          <div>
            <div className="foto-apelido">@{me.nickname}</div>
            <div className="foto-previa-sub">É assim que você aparece no bunker.</div>
          </div>
        </div>

        <fieldset className="foto-itens">
          <legend className="sr-only">Itens disponíveis</legend>
          <div className="foto-grade">
            {MORADOR_AVATARS.map((a) => (
              <label key={a.name} className="foto-op">
                <input type="radio" name="avatar" value={a.name} checked={choice === a.name} onChange={() => setChoice(a.name)} />
                <img src={avatarSrc(a.name)} alt="" width={60} height={60} />
                <span>{a.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="foto-espaco" />
        <button className="btn btn-primary foto-salvar" type="submit" disabled={busy}>
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
