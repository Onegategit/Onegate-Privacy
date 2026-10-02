const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAGIC = encoder.encode('ONEGATE1');
export const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ITERATIONS = 600000;

async function derive(password, salt, usage) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024)
    throw Error('Use a passphrase between 12 and 1024 characters');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
export async function sealFile(bytes, name, type, password) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_FILE_SIZE) throw Error('Choose a file no larger than 20 MB');
  const metadata = encoder.encode(JSON.stringify({ name: String(name).slice(0, 240), type: String(type).slice(0, 200) }));
  const plaintext = new Uint8Array(4 + metadata.length + bytes.length);
  new DataView(plaintext.buffer).setUint32(0, metadata.length);
  plaintext.set(metadata, 4); plaintext.set(bytes, 4 + metadata.length);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const key = await derive(password, salt, 'encrypt');
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: MAGIC, tagLength: 128 }, key, plaintext));
    const output = new Uint8Array(36 + ciphertext.length);
    output.set(MAGIC); output.set(salt, 8); output.set(iv, 24); output.set(ciphertext, 36);
    return output;
  } finally { plaintext.fill(0); }
}
export async function openFile(bytes, password) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 56 || bytes.length > MAX_FILE_SIZE + 8192 || !MAGIC.every((v, i) => bytes[i] === v))
    throw Error('This is not a supported Onegate encrypted file');
  const key = await derive(password, bytes.slice(8, 24), 'decrypt');
  let plaintext;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(24, 36), additionalData: MAGIC, tagLength: 128 }, key, bytes.slice(36)));
  } catch { throw Error('Unable to decrypt: incorrect passphrase or damaged file'); }
  try {
    const length = new DataView(plaintext.buffer).getUint32(0);
    if (length > 4096 || length + 4 > plaintext.length) throw Error('Invalid encrypted file metadata');
    const meta = JSON.parse(decoder.decode(plaintext.slice(4, 4 + length)));
    if (typeof meta.name !== 'string' || typeof meta.type !== 'string') throw Error('Invalid encrypted file metadata');
    const name = meta.name.replace(/[\\/\x00-\x1f]/g, '_').replace(/^\.+/, '') || 'decrypted-file';
    return { bytes: plaintext.slice(4 + length), name, type: meta.type };
  } finally { plaintext.fill(0); }
}
