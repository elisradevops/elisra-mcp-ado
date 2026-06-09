/**
 * AES-256-GCM authenticated encryption for ADO PATs at rest.
 *
 * Design:
 * - Each PAT is encrypted with a random 96-bit IV (NIST recommended for GCM).
 * - The resulting ciphertext, IV, 128-bit authTag, key ID, and algorithm are stored together.
 * - Decryption fails if the ciphertext OR authTag is modified (authenticated encryption).
 * - The master key is never logged and never returned from any public function.
 * - Key rotation: increment PAT_ENCRYPTION_KEY_ID; old records retain their keyId for decryption.
 *   On next PAT update, the record is re-encrypted under the new key.
 *
 * Bootstrap requirement:
 * - PAT_ENCRYPTION_KEY_B64: base64-encoded 32-byte key (256 bits).
 * - Generate: openssl rand -base64 32
 * - Supply via Kubernetes Secret — never as a plain env var in production YAML.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_BYTES = 12;   // 96-bit IV — NIST SP 800-38D recommended for GCM
const TAG_BYTES = 16;  // 128-bit auth tag

export interface EncryptedPat {
  ciphertext: string;   // hex-encoded
  iv: string;           // hex-encoded, 96-bit
  authTag: string;      // hex-encoded, 128-bit
  keyId: string;        // version label for key rotation
  algorithm: 'aes-256-gcm';
}

function validateKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `PAT encryption key must be exactly 32 bytes (256 bits). Got ${key.length} bytes. ` +
      'Generate with: openssl rand -base64 32'
    );
  }
  return key;
}

/**
 * Encrypt a PAT string. Returns the EncryptedPat envelope — store this, not the raw PAT.
 * The raw PAT is zeroed from memory after encryption.
 */
export function encryptPat(rawPat: string, keyB64: string, keyId: string): EncryptedPat {
  if (!rawPat || rawPat.trim().length === 0) {
    throw new Error('PAT must not be empty');
  }

  const key = validateKey(keyB64);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const patBuf = Buffer.from(rawPat, 'utf8');
  const encrypted = Buffer.concat([cipher.update(patBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Zero sensitive buffers before GC
  patBuf.fill(0);
  key.fill(0);

  return {
    ciphertext: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    keyId,
    algorithm: ALGORITHM,
  };
}

/**
 * Decrypt a stored EncryptedPat envelope. Returns the raw PAT as a Buffer.
 * Caller is responsible for zeroing the buffer after use.
 * Throws if keyId doesn't match, ciphertext is tampered, or authTag is invalid.
 */
export function decryptPat(envelope: EncryptedPat, keyB64: string, keyId: string): Buffer {
  if (envelope.algorithm !== ALGORITHM) {
    throw new Error(`Unsupported encryption algorithm: ${envelope.algorithm}`);
  }
  if (envelope.keyId !== keyId) {
    throw new Error(
      `Key ID mismatch: stored record uses keyId "${envelope.keyId}", current key is "${keyId}". ` +
      'Re-encrypt the credential or supply the correct key for this keyId.'
    );
  }

  const key = validateKey(keyB64);
  const iv = Buffer.from(envelope.iv, 'hex');
  const ciphertext = Buffer.from(envelope.ciphertext, 'hex');
  const authTag = Buffer.from(envelope.authTag, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    key.fill(0);
    return decrypted;
  } catch {
    key.fill(0);
    throw new Error('PAT decryption failed — ciphertext may be tampered or key is incorrect');
  }
}

/**
 * Decrypt and return as string. Zeros the intermediate buffer.
 * Use only immediately before making the ADO call — do not store the returned string.
 */
export function decryptPatAsString(envelope: EncryptedPat, keyB64: string, keyId: string): string {
  const buf = decryptPat(envelope, keyB64, keyId);
  const str = buf.toString('utf8');
  buf.fill(0);
  return str;
}
