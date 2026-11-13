import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BAD_SESSION, Realtime, type RealtimeEvent } from "./realtime";

/** WebSocket de mentira: guarda as instâncias e deixa o teste abrir, mandar e fechar. */
class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code: number) {
    this.closedWith = code;
    this.onclose?.({ code });
  }
  // Lado do servidor
  open() {
    this.onopen?.();
  }
  receive(event: RealtimeEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
}

const last = () => FakeSocket.all.at(-1)!;

function setup() {
  const onBadSession = vi.fn();
  const rt = new Realtime({ url: () => "ws://bunker/api/ws", WebSocketImpl: FakeSocket as unknown as typeof WebSocket, onBadSession });
  const events: RealtimeEvent[] = [];
  rt.subscribe((e) => events.push(e));
  return { rt, events, onBadSession };
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("Realtime", () => {
  it("manda o token como primeira mensagem e repassa os avisos", () => {
    const { rt, events } = setup();
    rt.start("token-123");
    expect(last().url).toBe("ws://bunker/api/ws");
    last().open();
    expect(last().sent).toEqual(['{"type":"auth","token":"token-123"}']);
    last().receive({ type: "ready" });
    expect(events).toEqual([{ type: "ready" }]);
  });

  it("reconecta com espera crescente quando a conexão cai", () => {
    const { rt } = setup();
    rt.start("t");
    last().drop();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    last().drop();
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
    // Conectou de verdade: a espera volta a 1 s.
    last().open();
    last().receive({ type: "ready" });
    last().drop();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(4);
  });

  it("não reconecta com sessão recusada nem depois de parar", () => {
    const { rt, onBadSession } = setup();
    rt.start("t");
    last().drop(BAD_SESSION);
    expect(onBadSession).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);

    rt.start("t2");
    rt.stop();
    expect(last().closedWith).toBe(1000);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("wake reconecta na hora quando está esperando", () => {
    const { rt } = setup();
    rt.start("t");
    last().drop();
    rt.wake();
    expect(FakeSocket.all).toHaveLength(2);
    rt.wake();
    expect(FakeSocket.all).toHaveLength(2);
  });
});
