import { describe, expect, it } from "vitest";
import { ViewTracker } from "./viewTracker";

function tracker() {
  let t = 0;
  const tr = new ViewTracker(() => t);
  return { tr, advance: (ms: number) => (t += ms) };
}

describe("ViewTracker", () => {
  it("conta só o tempo tocando e a fração da primeira passada", () => {
    const { tr, advance } = tracker();
    tr.start();
    tr.play();
    advance(3000);
    tr.time(3, 10);
    tr.pause();
    advance(5000);
    expect(tr.finish()).toEqual({ watchedMs: 3000, watchPct: 0.3, replays: 0 });
  });

  it("detecta o replay quando o loop volta ao início", () => {
    const { tr, advance } = tracker();
    tr.start();
    tr.play();
    for (const s of [2, 5, 9.7, 0.2, 4, 9.8, 0.1]) {
      advance(1000);
      tr.time(s, 10);
    }
    expect(tr.finish()).toEqual({ watchedMs: 7000, watchPct: 1, replays: 2 });
  });

  it("manda um evento só por ativação", () => {
    const { tr } = tracker();
    expect(tr.finish()).toBeNull();
    tr.start();
    expect(tr.finish()).not.toBeNull();
    tr.play();
    tr.time(5, 10);
    expect(tr.finish()).toBeNull();
  });
});
