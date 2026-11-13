import { describe, expect, it } from "vitest";
import type { Message } from "./api";
import { applyReactions, conversationTitle, groupReactions, mergeMessages, shortTime } from "./chat";

const msg = (id: string, createdAt: string, text = id): Message => ({
  id,
  conversationId: "c1",
  type: "text",
  text,
  video: null,
  reactions: [],
  createdAt,
  sender: { nickname: "ana", avatarUrl: null, isAi: false },
});

describe("mergeMessages", () => {
  it("junta sem repetir e em ordem de envio", () => {
    const a = msg("a", "2026-11-13T10:00:00.000Z");
    const b = msg("b", "2026-11-13T10:01:00.000Z");
    const c = msg("c", "2026-11-13T10:02:00.000Z");
    expect(mergeMessages([a, c], [b, c]).map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(mergeMessages([], [c, a]).map((m) => m.id)).toEqual(["a", "c"]);
  });
});

describe("conversationTitle", () => {
  it("usa o nome do grupo ou o apelido do outro lado", () => {
    const base = { id: "c1", type: "direct" as const, bunker: false, lastMessage: null, unread: 0 };
    expect(conversationTitle({ ...base, name: null, members: [{ nickname: "bia", avatarUrl: null, isAi: false }] })).toBe("bia");
    expect(conversationTitle({ ...base, type: "group", name: "Bunker", members: [] })).toBe("Bunker");
  });
});

describe("shortTime", () => {
  it("mostra a hora hoje, 'ontem' e o dia nos outros casos", () => {
    const now = new Date(2026, 10, 13, 15, 0);
    expect(shortTime(new Date(2026, 10, 13, 9, 5).toISOString(), now)).toBe("09:05");
    expect(shortTime(new Date(2026, 10, 12, 23, 0).toISOString(), now)).toBe("ontem");
    expect(shortTime(new Date(2026, 10, 2, 8, 0).toISOString(), now)).toBe("02/11");
  });
});

describe("reações", () => {
  it("troca as reações de uma mensagem só", () => {
    const a = msg("a", "2026-11-13T10:00:00.000Z");
    const b = msg("b", "2026-11-13T10:01:00.000Z");
    const out = applyReactions([a, b], "b", [{ emoji: "🔥", nickname: "bia" }]);
    expect(out[0]).toBe(a);
    expect(out[1]!.reactions).toEqual([{ emoji: "🔥", nickname: "bia" }]);
  });

  it("agrupa por emoji e marca a sua", () => {
    const groups = groupReactions(
      [
        { emoji: "😂", nickname: "bia" },
        { emoji: "🔥", nickname: "ana" },
        { emoji: "😂", nickname: "eve" },
      ],
      "ana",
    );
    expect(groups).toEqual([
      { emoji: "😂", count: 2, mine: false, who: ["bia", "eve"] },
      { emoji: "🔥", count: 1, mine: true, who: ["ana"] },
    ]);
  });
});
