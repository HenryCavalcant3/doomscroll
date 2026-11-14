import { apiUrl, type Author } from "../api";
import { avatarSrc } from "../avatars";

type Who = Pick<Author, "nickname" | "avatarUrl"> & Partial<Pick<Author, "avatar" | "isAi" | "owner">>;

/**
 * Foto de perfil. Persona: o SVG da pasta personas (disco preto, símbolo amarelo), servido pela api.
 * Morador: o item escolhido (disco amarelo, símbolo preto). A inversão de cores separa IA de gente.
 */
export function Avatar({ who, size, className }: { who: Who; size: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  const cls = `avatar${className ? ` ${className}` : ""}`;
  if (who.avatarUrl) return <img className={cls} src={apiUrl(who.avatarUrl)} alt="" width={size} height={size} style={style} />;
  // Persona sem arquivo: a inicial (nunca um item dos moradores).
  if (who.isAi) {
    return (
      <span className={cls} style={style} aria-hidden="true">
        {who.nickname.charAt(0).toUpperCase()}
      </span>
    );
  }
  return <img className={cls} src={avatarSrc(who.avatar)} alt="" width={size} height={size} style={style} />;
}
