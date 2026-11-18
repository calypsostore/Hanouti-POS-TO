const PREFIX = 'pbkdf2-sha256';
const ITERATIONS = 210_000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function derive(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derive(secret, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${toHex(salt)}$${toHex(digest)}`;
}

export async function verifySecret(stored: string | undefined, candidate: string): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!stored?.startsWith(`${PREFIX}$`)) return { valid: stored === candidate, needsRehash: stored === candidate };
  const [, iterationValue, saltValue, expectedValue] = stored.split('$');
  const iterations = Number(iterationValue);
  if (!Number.isInteger(iterations) || iterations < 1 || !saltValue || !expectedValue) throw new Error('Stored credential hash is invalid.');
  const digest = await derive(candidate, fromHex(saltValue), iterations);
  const expected = fromHex(expectedValue);
  if (digest.length !== expected.length) return { valid: false, needsRehash: false };
  let mismatch = 0;
  for (let index = 0; index < digest.length; index += 1) mismatch |= digest[index] ^ expected[index];
  return { valid: mismatch === 0, needsRehash: false };
}
