/** O que o feed manda para a api quando um vídeo deixa de ser o ativo (POST /videos/:id/view). */
export interface ViewPayload {
  watchedMs: number;
  /** Fração vista na primeira passada, de 0 a 1. */
  watchPct: number;
  replays: number;
}

/** O vídeo do feed tem `loop`, então `ended` nunca dispara: a volta ao início marca o replay. */
const LOOP_FROM = 0.8;
const LOOP_TO = 0.2;

/**
 * Mede uma passagem de um vídeo pelo feed: tempo tocando (só com a aba visível), quanto da
 * primeira passada foi visto e quantas vezes repetiu. `finish` encerra e devolve o evento.
 */
export class ViewTracker {
  private watchedMs = 0;
  private playingSince: number | null = null;
  private maxPct = 0;
  private lastPct = 0;
  private replays = 0;
  private done = true;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** O vídeo virou o ativo: começa uma medição nova. */
  start() {
    this.watchedMs = 0;
    this.playingSince = null;
    this.maxPct = 0;
    this.lastPct = 0;
    this.replays = 0;
    this.done = false;
  }

  play() {
    if (!this.done && this.playingSince === null) this.playingSince = this.now();
  }

  pause() {
    if (this.playingSince === null) return;
    this.watchedMs += this.now() - this.playingSince;
    this.playingSince = null;
  }

  time(currentTime: number, duration: number) {
    if (this.done || !duration || !Number.isFinite(duration)) return;
    const pct = Math.min(1, currentTime / duration);
    if (this.lastPct >= LOOP_FROM && pct < LOOP_TO) {
      this.replays++;
      this.maxPct = 1;
    } else if (this.replays === 0) {
      this.maxPct = Math.max(this.maxPct, pct);
    }
    this.lastPct = pct;
  }

  /** Encerra a medição; null quando não há o que mandar (nunca começou ou já foi mandada). */
  finish(): ViewPayload | null {
    if (this.done) return null;
    this.pause();
    this.done = true;
    return { watchedMs: Math.round(this.watchedMs), watchPct: this.maxPct, replays: this.replays };
  }
}
