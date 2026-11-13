import type { Conversation } from "../api";
import { Avatar } from "./Avatar";

/** Conversa direta: avatar da outra pessoa. Grupo: a inicial do nome (o Grupo do Bunker tem contorno amarelo). */
export function ConversationAvatar({ conversation: c, size }: { conversation: Conversation; size: number }) {
  if (c.type === "direct" && c.members[0]) return <Avatar who={c.members[0]} size={size} />;
  const initial = (c.name ?? "G").trim().charAt(0).toUpperCase() || "G";
  return (
    <span
      className={`avatar avatar-group${c.bunker ? " bunker" : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
