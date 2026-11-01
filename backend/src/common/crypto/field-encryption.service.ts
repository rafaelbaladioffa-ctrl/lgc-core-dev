import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * App-layer field encryption for sensitive collaborator data (CPF, RG, CTPS, PIS).
 * AES-256-GCM is non-deterministic (random IV per call), so a separate deterministic
 * hash (hashForLookup) is used where a unique/lookup index is needed (e.g. CPF).
 */
@Injectable()
export class FieldEncryptionService {
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    const hexKey = this.config.get<string>('FIELD_ENCRYPTION_KEY');
    if (!hexKey || hexKey.length !== 64) {
      throw new Error('FIELD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    }
    this.key = Buffer.from(hexKey, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(encoded: string): string {
    const raw = Buffer.from(encoded, 'base64');
    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = raw.subarray(IV_LENGTH + 16);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  }

  /** Deterministic hash for uniqueness/lookup without decrypting (e.g. CPF). */
  hashForLookup(plaintext: string): string {
    return createHash('sha256').update(this.key).update(plaintext).digest('hex');
  }
}
