import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ENVELOPE_VERSION = 'v1';

function encryptionKey(environment: Record<string, string | undefined> = process.env) {
  const encoded = environment.MONDAY_TOKEN_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error('Monday token encryption is not configured');

  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('MONDAY_TOKEN_ENCRYPTION_KEY must be canonical base64 for 32 bytes');
  }
  return key;
}

function decodeBase64(value: string) {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw new Error('invalid base64');
  return decoded;
}

export function encryptMondaySecret(
  plaintext: string,
  aad: string,
  environment: Record<string, string | undefined> = process.env,
) {
  if (!plaintext || !aad) throw new Error('Monday secret and AAD are required');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(environment), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [ENVELOPE_VERSION, iv.toString('base64'), ciphertext.toString('base64'), cipher.getAuthTag().toString('base64')].join('.');
}

export function decryptMondaySecret(
  envelope: string,
  aad: string,
  environment: Record<string, string | undefined> = process.env,
) {
  const [version, encodedIv, encodedCiphertext, encodedTag, extra] = envelope.split('.');
  if (version !== ENVELOPE_VERSION || !encodedIv || !encodedCiphertext || !encodedTag || extra !== undefined || !aad) {
    throw new Error('Invalid Monday secret envelope');
  }

  try {
    const iv = decodeBase64(encodedIv);
    const ciphertext = decodeBase64(encodedCiphertext);
    const tag = decodeBase64(encodedTag);
    if (iv.length !== 12 || tag.length !== 16) throw new Error('invalid envelope');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(environment), iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Invalid Monday secret envelope');
  }
}
