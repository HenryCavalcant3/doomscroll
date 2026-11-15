import type { Author } from "../api";
import { OWNER_KEY_SRC, PERSONA_ROBOT_SRC } from "../avatars";

/**
 * Selo logo depois do apelido, como um "verificado": a chave do dono do bunker e o robô das personas
 * (as cores invertidas, como nos avatares). Aparece onde o avatar é pequeno demais para levar o selo
 * (feed, comentários, chat, caixa de entrada).
 */
export function Selo({ who, size = 16 }: { who: Partial<Pick<Author, "owner" | "isAi">> | undefined; size?: number }) {
  if (who?.owner) return <img className="selo" src={OWNER_KEY_SRC} alt="dono do bunker" title="Dono do bunker" width={size} height={size} />;
  if (who?.isAi) return <img className="selo" src={PERSONA_ROBOT_SRC} alt="persona de IA" title="Persona de IA" width={size} height={size} />;
  return null;
}
