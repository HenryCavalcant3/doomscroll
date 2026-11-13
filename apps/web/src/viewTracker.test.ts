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
    expect(tr.finish({ canSkip: true })).toEqual({ watchedMs: 3000, watchPct: 0.3, replays: 0 });
  });

  it("detecta o replay quando o loop volta ao início", () => {
    const { tr, advance } = tracker();
    tr.start();
    tr.play();
    for (const s of [2, 5, 9.7, 0.2, 4, 9.8, 0.1]) {
      advance(1000);
      tr.time(s, 10);
    }
    expect(tr.finish({ canSkip: true })).toEqual({ watchedMs: 7000, watchPct: 1, replays: 2 });
  });

  it("manda um evento só por ativação", () => {
    const { tr } = tracker();
    expect(tr.finish({ canSkip: true })).toBeNull();
    tr.start();
    expect(tr.finish({ canSkip: true })).not.toBeNull();
    tr.play();
    tr.time(5, 10);
    expect(tr.finish({ canSkip: true })).toBeNull();
  });

  it("sair do feed ou esconder a aba não conta como pulo rápido", () => {
    const { tr, advance } = tracker();
    tr.start();
    tr.play();
    advance(500);
    tr.time(0.5, 10);
    expect(tr.finish({ canSkip: false })).toBeNull();

    tr.start();
    tr.play();
    advance(9500);
    tr.time(9.5, 10);
    expect(tr.finish({ canSkip: false })).toEqual({ watchedMs: 9500, watchPct: 0.95, replays: 0 });
  });

  it("limita os valores aos do schema da api", () => {
    const { tr, advance } = tracker();
    tr.start();
    tr.play();
    for (let i = 0; i < 150; i++) {
      tr.time(9.9, 10);
      tr.time(0.1, 10);
    }
    advance(5_000_000);
    expect(tr.finish({ canSkip: true })).toEqual({ watchedMs: 3_600_000, watchPct: 1, replays: 100 });
  });
});
