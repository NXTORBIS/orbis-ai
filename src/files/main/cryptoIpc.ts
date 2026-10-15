import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../shared/ipc';
import { makeError, OrbisError, toOrbisError } from '../shared/errors';
import { ENCRYPT_PASSWORD_MIN } from '../shared/crypto';
import { requireAbsolute } from './fs/paths';
import type { Services } from './services';

/**
 * IPC handlers for file encryption (AES-256-GCM) and decryption.
 *
 * File format: [magic 'ORBENC\x01\x00' 8b][salt 32b][iv 12b]
 *              [original-name-length 2b BE][original-name UTF-8]
 *              [auth-tag 16b][encrypted-data]
 *
 * Key derivation: PBKDF2 with SHA-512, 600 000 iterations, 32-byte key from salt + password.
 */

type Channels = 'crypto:encrypt' | 'crypto:decrypt';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>) => unknown };

const MAGIC = Buffer.from('ORBENC\x01\x00', 'binary');
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_DIGEST = 'sha512';
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT_LEN = 32;
const TAG_LEN = 16;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(Buffer.from(password, 'utf8'), salt, PBKDF2_ITERATIONS, KEY_LEN, PBKDF2_DIGEST, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export function cryptoHandlers(s: Services): Handlers {
  return {
    'crypto:encrypt': async (p) => {
      const filePath = requireAbsolute(p.path, 'crypto.encrypt');
      if (p.password.length < ENCRYPT_PASSWORD_MIN) {
        throw makeError('validation', 'crypto.encrypt', { message: `Password must be at least ${ENCRYPT_PASSWORD_MIN} characters.` });
      }
      const st = await fsp.stat(filePath).catch((err) => { throw new OrbisError(toOrbisError(err, 'crypto.encrypt', filePath, 'no')); });
      if (!st.isFile()) throw makeError('validation', 'crypto.encrypt', { target: filePath, message: 'Only files can be encrypted.' });

      const salt = crypto.randomBytes(SALT_LEN);
      const iv = crypto.randomBytes(IV_LEN);
      const key = await deriveKey(p.password, salt);
      const originalName = Buffer.from(path.basename(filePath), 'utf8');
      if (originalName.length > 65535) throw makeError('validation', 'crypto.encrypt', { message: 'File name is too long.' });

      const nameLen = Buffer.alloc(2);
      nameLen.writeUInt16BE(originalName.length);

      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

      const encryptedPath = filePath + '.enc';
      const tmpPath = encryptedPath + '.tmp';

      const inputStream = fs.createReadStream(filePath);
      const outputStream = fs.createWriteStream(tmpPath);

      // Write header: magic + salt + iv + name-length + name
      const header = Buffer.concat([MAGIC, salt, iv, nameLen, originalName]);
      outputStream.write(header);

      // Encrypt
      await pipeline(inputStream, cipher, outputStream);

      // Append auth tag
      const tag = cipher.getAuthTag();
      await fsp.appendFile(tmpPath, tag);

      // Atomic rename
      await fsp.rename(tmpPath, encryptedPath);
      s.log.info('crypto.encrypted', { source: filePath, destination: encryptedPath });
      return { encryptedPath };
    },

    'crypto:decrypt': async (p) => {
      const filePath = requireAbsolute(p.path, 'crypto.decrypt');
      const st = await fsp.stat(filePath).catch((err) => { throw new OrbisError(toOrbisError(err, 'crypto.decrypt', filePath, 'no')); });
      if (!st.isFile()) throw makeError('validation', 'crypto.decrypt', { target: filePath, message: 'Only files can be decrypted.' });

      const fd = await fsp.open(filePath, 'r');
      try {
        // Read magic
        const magicBuf = Buffer.alloc(MAGIC.length);
        await fd.read(magicBuf, 0, MAGIC.length, 0);
        if (!magicBuf.equals(MAGIC)) throw makeError('validation', 'crypto.decrypt', { message: 'This is not an Orbis encrypted file.' });

        // Read salt, iv, name-length
        const headerBuf = Buffer.alloc(SALT_LEN + IV_LEN + 2);
        await fd.read(headerBuf, 0, headerBuf.length, MAGIC.length);
        const salt = headerBuf.subarray(0, SALT_LEN);
        const iv = headerBuf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
        const nameLen = headerBuf.readUInt16BE(SALT_LEN + IV_LEN);

        // Read original name
        const nameBuf = Buffer.alloc(nameLen);
        await fd.read(nameBuf, 0, nameLen, MAGIC.length + headerBuf.length);
        const originalName = nameBuf.toString('utf8');

        const dataOffset = MAGIC.length + SALT_LEN + IV_LEN + 2 + nameLen;
        // Auth tag is the last 16 bytes of the file
        const dataLen = st.size - dataOffset - TAG_LEN;
        if (dataLen < 0) throw makeError('validation', 'crypto.decrypt', { message: 'The encrypted file is corrupted (too small).' });

        // Read auth tag
        const tagBuf = Buffer.alloc(TAG_LEN);
        await fd.read(tagBuf, 0, TAG_LEN, st.size - TAG_LEN);

        // Derive key
        const key = await deriveKey(p.password, salt);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tagBuf);

        // Decrypt
        const dir = path.dirname(filePath);
        const decryptedPath = path.join(dir, originalName);
        const tmpPath = decryptedPath + '.tmp';

        const inputStream = fs.createReadStream(filePath, { start: dataOffset, end: dataOffset + dataLen - 1 });
        const outputStream = fs.createWriteStream(tmpPath);

        try {
          await pipeline(inputStream, decipher, outputStream);
        } catch (err) {
          await fsp.unlink(tmpPath).catch(() => undefined);
          if ((err as Error).message?.includes('Unsupported state') || (err as NodeJS.ErrnoException).code === 'ERR_OSSL_EVP_BAD_DECRYPT') {
            throw makeError('validation', 'crypto.decrypt', { message: 'Wrong password, or the file is corrupted.' });
          }
          throw err;
        }

        await fsp.rename(tmpPath, decryptedPath);
        s.log.info('crypto.decrypted', { source: filePath, destination: decryptedPath });
        return { decryptedPath };
      } finally {
        await fd.close();
      }
    },
  };
}
