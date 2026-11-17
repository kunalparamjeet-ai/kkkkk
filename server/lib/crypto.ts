import crypto from 'node:crypto';

const MASTER_SECRET =
  process.env.SESSION_SECRET ||
  process.env.ENCRYPTION_KEY ||
  'vektor-dev-ephemeral-secret-change-in-production';

function getEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(MASTER_SECRET).digest();
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

export function generateRandomToken(prefix = ''): string {
  return `${prefix}${crypto.randomBytes(24).toString('hex')}`;
}

export function generateSecureApiKey(): string {
  return `vk_live_${crypto.randomBytes(24).toString('base64url')}`;
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null): boolean {
  if (!storedHash || !storedHash.startsWith('scrypt:')) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const [, salt, originalHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted secret format');
  const [ivHex, tagHex, dataHex] = parts;
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

export function verifyHmacSha256Hex(payload: string, signatureHex: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHex, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function maskSecret(value: string | null | undefined): string {
  if (!value) return 'Not configured';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
