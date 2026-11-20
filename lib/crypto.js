// Cairn encryption core. Runs only in the browser (or in Node for tests), using
// the built-in Web Crypto API. The passphrase, the recovery key and the vault
// key never leave the device: the server stores only the sealed results.
//
//   vault key (random AES-256-GCM)  -- encrypts every entry
//   passphrase  --PBKDF2-->  key A  -- seals copy 1 of the vault key
//   recovery key --PBKDF2--> key B  -- seals copy 2 of the vault key
//
// Sealed text format: "v1.<iv base64>.<ciphertext base64>"

const enc = new TextEncoder();
const dec = new TextDecoder();
const VERSION = 'v1';
export const PBKDF2_ITERATIONS = 600000;

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function unb64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function deriveKey(secret, saltB64, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return `${VERSION}.${b64(iv)}.${b64(out)}`;
}

async function open(key, text) {
  const parts = String(text).split('.');
  // Accept the original two-part format as well, in case anything was saved with it.
  const [iv, data] = parts.length === 3 && parts[0] === VERSION ? parts.slice(1) : parts;
  if (!iv || !data) throw new Error('Unreadable sealed data');
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(data));
}

export function newSalt() {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

// 24 characters from a 32-letter alphabet (no 0/O/1/I) = 120 bits of randomness.
// 256 is a multiple of 32, so taking each byte modulo 32 has no bias.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRecoveryKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const chars = Array.from(bytes, (n) => ALPHABET[n % ALPHABET.length]).join('');
  return chars.match(/.{4}/g).join('-');
}

// People will type the key back in by hand, so be forgiving about spaces,
// dashes and lower case. (The alphabet has no 0, O, 1 or I, so those can only
// ever be typing mistakes; looksLikeRecoveryKey flags them.)
export function normalizeRecoveryKey(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function looksLikeRecoveryKey(input) {
  const clean = normalizeRecoveryKey(input);
  return clean.length === 24 && [...clean].every((c) => ALPHABET.includes(c));
}

// The canonical form fed to PBKDF2 is the 24 characters, upper case, no dashes.
function recoverySecret(recoveryKey) {
  return normalizeRecoveryKey(recoveryKey);
}

async function importVaultKey(raw) {
  // Non-extractable: once unlocked, the key can encrypt and decrypt but its
  // bytes cannot be read back out of the browser's key store.
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function createVaultKeys(passphrase) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const recoveryKey = newRecoveryKey();
  const passphrase_salt = newSalt();
  const recovery_salt = newSalt();
  const wrapped_key_passphrase = await seal(await deriveKey(passphrase, passphrase_salt), raw);
  const wrapped_key_recovery = await seal(await deriveKey(recoverySecret(recoveryKey), recovery_salt), raw);
  const vaultKey = await importVaultKey(raw);
  raw.fill(0);
  return { vaultKey, recoveryKey, passphrase_salt, recovery_salt, wrapped_key_passphrase, wrapped_key_recovery };
}

async function rawWithPassphrase(vault, passphrase) {
  return new Uint8Array(await open(await deriveKey(passphrase, vault.passphrase_salt), vault.wrapped_key_passphrase));
}

export async function unlockWithPassphrase(vault, passphrase) {
  const raw = await rawWithPassphrase(vault, passphrase);
  try { return await importVaultKey(raw); } finally { raw.fill(0); }
}

export async function unlockWithRecoveryKey(vault, recoveryKey) {
  const key = await deriveKey(recoverySecret(recoveryKey), vault.recovery_salt);
  const raw = new Uint8Array(await open(key, vault.wrapped_key_recovery));
  try { return await importVaultKey(raw); } finally { raw.fill(0); }
}

// Re-lock the same vault key under a new passphrase. The planner proves they
// know the current one; entries do not need re-encrypting.
export async function changePassphrase(vault, currentPassphrase, newPassphrase) {
  const raw = await rawWithPassphrase(vault, currentPassphrase);
  try {
    const passphrase_salt = newSalt();
    const wrapped_key_passphrase = await seal(await deriveKey(newPassphrase, passphrase_salt), raw);
    return { passphrase_salt, wrapped_key_passphrase };
  } finally { raw.fill(0); }
}

// Issue a fresh recovery key. The old one stops working as soon as this is saved.
export async function replaceRecoveryKey(vault, currentPassphrase) {
  const raw = await rawWithPassphrase(vault, currentPassphrase);
  try {
    const recoveryKey = newRecoveryKey();
    const recovery_salt = newSalt();
    const wrapped_key_recovery = await seal(await deriveKey(recoverySecret(recoveryKey), recovery_salt), raw);
    return { recoveryKey, recovery_salt, wrapped_key_recovery };
  } finally { raw.fill(0); }
}

export async function encryptEntry(vaultKey, obj) {
  return seal(vaultKey, enc.encode(JSON.stringify(obj)));
}

export async function decryptEntry(vaultKey, text) {
  return JSON.parse(dec.decode(await open(vaultKey, text)));
}

// Decrypt a list of rows; a row that cannot be read is reported, not fatal.
export async function decryptRows(vaultKey, rows) {
  return Promise.all(
    (rows || []).map(async (row) => {
      try {
        return { id: row.id, created_at: row.created_at, updated_at: row.updated_at, ...(await decryptEntry(vaultKey, row.payload)) };
      } catch {
        return { id: row.id, unreadable: true, name: 'An entry that could not be read' };
      }
    })
  );
}

// A rough guide to passphrase strength, shown as a gentle hint, not a gate.
export function passphraseStrength(p) {
  if (!p) return 0;
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/[0-9]/.test(p)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(p)) pool += 20;
  const words = p.trim().split(/\s+/).length;
  const bits = Math.max(p.length * Math.log2(pool || 1), words >= 4 ? words * 11 : 0);
  if (bits >= 80) return 3;
  if (bits >= 60) return 2;
  return 1;
}
