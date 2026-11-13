import { apiUrl, type Author } from "../api";

/** Avatar da persona (SVG servido pela api) ou, para pessoas, a inicial do apelido num círculo. */
export function Avatar({ who, size, className }: { who: Pick<Author, "nickname" | "avatarUrl">; size: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  const cls = `avatar${className ? ` ${className}` : ""}`;
  if (who.avatarUrl) return <img className={cls} src={apiUrl(who.avatarUrl)} alt="" width={size} height={size} style={style} />;
  return (
    <span className={cls} style={style} aria-hidden="true">
      {who.nickname.charAt(0).toUpperCase()}
    </span>
  );
}
