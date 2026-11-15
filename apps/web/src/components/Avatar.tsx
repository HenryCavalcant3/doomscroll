import { apiUrl, type Author } from "../api";
import { avatarSrc, OWNER_FRAME_SRC, OWNER_KEY_SRC, PERSONA_ROBOT_SRC } from "../avatars";

/** O selo (chave do dono, robô da persona) só entra a partir deste tamanho (perfil e painel do dono); abaixo, ele vai ao lado do apelido. */
const KEY_MIN_SIZE = 64;

type Who = Pick<Author, "nickname" | "avatarUrl"> & Partial<Pick<Author, "avatar" | "isAi" | "owner">>;

/**
 * Foto de perfil. Persona: o SVG da pasta personas (disco preto, símbolo amarelo), servido pela api.
 * Morador: o item escolhido (disco amarelo, símbolo preto). A inversão de cores separa IA de gente.
 * Dono do bunker: o mesmo avatar de morador dentro da moldura tracejada, com o selo da chave a partir de 64 px.
 * O tamanho total não muda com a moldura: o item encolhe por dentro dela (docs/avatares/dono/exemplo.svg).
 * Persona: o selo do robô no mesmo canto, também a partir de 64 px.
 */
export function Avatar({ who, size, className }: { who: Who; size: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  const cls = `avatar${className ? ` ${className}` : ""}`;
  if (who.avatarUrl) {
    const img = <img className={cls} src={apiUrl(who.avatarUrl)} alt="" width={size} height={size} style={style} />;
    if (!who.isAi || size < KEY_MIN_SIZE) return img;
    return (
      <span className="avatar-com-selo" style={{ width: size, height: size }} aria-hidden="true">
        {img}
        <img className="avatar-dono-selo" src={PERSONA_ROBOT_SRC} alt="" />
      </span>
    );
  }
  // Persona sem arquivo: a inicial (nunca um item dos moradores).
  if (who.isAi) {
    return (
      <span className={cls} style={style} aria-hidden="true">
        {who.nickname.charAt(0).toUpperCase()}
      </span>
    );
  }
  if (!who.owner) return <img className={cls} src={avatarSrc(who.avatar)} alt="" width={size} height={size} style={style} />;
  return (
    <span className={`${cls} avatar-dono`} style={{ width: size, height: size }} aria-hidden="true">
      <img className="avatar-dono-item" src={avatarSrc(who.avatar)} alt="" />
      <img className="avatar-dono-moldura" src={OWNER_FRAME_SRC} alt="" />
      {size >= KEY_MIN_SIZE && <img className="avatar-dono-selo" src={OWNER_KEY_SRC} alt="" />}
    </span>
  );
}
