import type { Author } from "../api";
import { profileHref } from "../router";
import { Avatar } from "./Avatar";
import { Selo } from "./Selo";

/** Lista de pessoas e personas (membros do grupo, quem reagiu): tocar abre o perfil. */
export function Pessoas({ people, note }: { people: Author[]; note?: (p: Author) => string | null }) {
  return (
    <ul className="pessoas">
      {people.map((p) => (
        <li key={p.nickname}>
          <a className="pessoa" href={profileHref(p.nickname)}>
            <Avatar who={p} size={40} />
            <span className="pessoa-texto">
              <span className="pessoa-nome">
                @{p.nickname}
                <Selo who={p} size={14} />
              </span>
              {note?.(p) && <span className="hint">{note(p)}</span>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
