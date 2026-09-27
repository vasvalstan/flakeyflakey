import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes(secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error("FLAKEY_STATE_KEY must be 32 random bytes encoded as 64 hex characters.");
  return Buffer.from(secret, "hex");
}

export function seal(value: unknown, secret: string, purpose: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(secret), nonce);
  cipher.setAAD(Buffer.from(`flakey-v1:${purpose}`));
  const plaintext = Buffer.from(JSON.stringify(value));
  if (plaintext.length > 4_000_000) throw new Error("Agent state exceeds the storage limit.");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function unseal(value: string, secret: string, purpose: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 5_400_000) throw new Error("Invalid encrypted input.");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < 29) throw new Error("Invalid encrypted input.");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(secret), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(`flakey-v1:${purpose}`));
  decipher.setAuthTag(bytes.subarray(12, 28));
  try { return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")); }
  catch { throw new Error("Encrypted input failed authentication. Check the shared state key."); }
}
