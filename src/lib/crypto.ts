// AES-GCM encryption for secrets stored in D1.
// Master key is a base64-encoded 32-byte random value stored as a Workers Secret.

const ALGORITHM = { name: 'AES-GCM', length: 256 };

async function importKey(masterKeyB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(masterKeyB64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, ALGORITHM, false, ['encrypt', 'decrypt']);
}

export async function encrypt(plaintext: string, masterKeyB64: string): Promise<string> {
  const key = await importKey(masterKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  // Store as: base64(iv):base64(ciphertext)
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  return `${ivB64}:${ctB64}`;
}

export async function decrypt(blob: string, masterKeyB64: string): Promise<string> {
  const [ivB64, ctB64] = blob.split(':');
  if (!ivB64 || !ctB64) throw new Error('Invalid encrypted blob format');
  const key = await importKey(masterKeyB64);
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

export function generateMasterKey(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}
