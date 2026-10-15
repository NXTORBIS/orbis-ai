import type { SecureStorageState } from '../../shared/remote';

/**
 * Where connection secrets are encrypted at rest. The app uses Electron's
 * safeStorage (OS keychain / libsecret / KWallet / DPAPI); tests inject their
 * own. When `state().available` is false nothing is ever stored.
 */
export interface SecretBox {
  state(): SecureStorageState;
  encrypt(plain: string): string;
  decrypt(encoded: string): string;
}

export const NO_SECRET_STORAGE: SecretBox = {
  state: () => ({ available: false, reason: 'Secure credential storage is not available.' }),
  encrypt: () => {
    throw new Error('Secure credential storage is not available.');
  },
  decrypt: () => {
    throw new Error('Secure credential storage is not available.');
  },
};

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
  getSelectedStorageBackend?(): string;
}

/**
 * Electron safeStorage. On Linux, the "basic_text" backend (used when no
 * keyring such as GNOME Keyring or KWallet is running) encrypts with a fixed,
 * publicly known key, so it is treated as unavailable: passwords are then
 * asked for when connecting instead of being stored.
 */
export function electronSecretBox(safeStorage: SafeStorageLike, platform: NodeJS.Platform = process.platform): SecretBox {
  const state = (): SecureStorageState => {
    if (!safeStorage.isEncryptionAvailable()) return { available: false, reason: 'This system offers no secure credential storage (keychain), so passwords cannot be saved.' };
    if (platform === 'linux') {
      const backend = safeStorage.getSelectedStorageBackend?.() ?? 'unknown';
      if (backend === 'basic_text' || backend === 'unknown') return { available: false, reason: 'No keyring (GNOME Keyring, KWallet) is running, so passwords cannot be saved securely.' };
    }
    return { available: true };
  };
  return {
    state,
    encrypt: (plain) => {
      if (!state().available) throw new Error('Secure credential storage is not available.');
      return safeStorage.encryptString(plain).toString('base64');
    },
    decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64')),
  };
}
