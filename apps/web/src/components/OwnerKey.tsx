import type { Author } from "../api";
import { OWNER_KEY_SRC } from "../avatars";

/**
 * Selo da chave logo depois do apelido do dono do bunker, como um "verificado". Aparece onde o avatar
 * é pequeno demais para levar o selo (feed, comentários, chat, caixa de entrada).
 */
export function OwnerKey({ who, size = 16 }: { who: Pick<Author, "owner"> | undefined; size?: number }) {
  if (!who?.owner) return null;
  return <img className="owner-key" src={OWNER_KEY_SRC} alt="dono do bunker" title="Dono do bunker" width={size} height={size} />;
}
