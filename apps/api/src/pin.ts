import { randomInt, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pwd: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEYLEN = 32;

/** Gera o hash de um PIN no formato `scrypt$<salt>$<hash>` (base64). */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, KEYLEN);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(pin, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
