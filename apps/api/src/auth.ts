import { createHash, randomBytes } from "node:crypto";

/** Mesma regra dos apelidos das personas (personas/*.json). */
export const NICKNAME = /^[a-z0-9_]{3,30}$/;
/** PIN de conta nova: 4 a 6 dígitos. */
export const NEW_PIN = /^\d{4,6}$/;

export const normalizeNickname = (s: string) => s.trim().replace(/^@/, "").toLowerCase();

/** Token opaco entregue ao navegador. */
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Lê o token do cabeçalho `Authorization: Bearer <token>`. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(header ?? "");
  return match ? match[1]! : null;
}

interface Bucket {
  failures: number;
  resetAt: number;
}

/**
 * Limite de PIN errado, em memória (um processo de api só). Conta falhas por chave (o apelido)
 * numa janela fixa; um acerto zera a chave.
 */
export class LoginLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private bucket(key: string): Bucket | undefined {
    const b = this.buckets.get(key);
    if (b && b.resetAt <= this.now()) {
      this.buckets.delete(key);
      return undefined;
    }
    return b;
  }

  /** Segundos até poder tentar de novo, ou 0 se pode tentar agora. */
  blockedFor(key: string): number {
    const b = this.bucket(key);
    return b && b.failures >= this.maxFailures ? Math.ceil((b.resetAt - this.now()) / 1000) : 0;
  }

  fail(key: string) {
    const b = this.bucket(key);
    if (b) b.failures++;
    else this.buckets.set(key, { failures: 1, resetAt: this.now() + this.windowMs });
    // Evita crescer sem limite com muitos apelidos diferentes.
    if (this.buckets.size > 10_000) {
      for (const [k] of this.buckets) if (!this.bucket(k)) this.buckets.delete(k);
    }
  }

  reset(key: string) {
    this.buckets.delete(key);
  }
}
