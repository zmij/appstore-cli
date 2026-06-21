/**
 * Authentication module for App Store Connect API
 *
 * Loads config from the configured secrets directory (default
 * `.secret-stuff/`, override via `appstore-cli.config.yaml` or
 * `APPSTORE_SECRETS_DIR`) and provides JWT generation for API
 * calls.
 *
 * Path discovery (git roots, config-file lookup) lives in
 * `./project.ts` and `./paths.ts` to avoid circular imports.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { AppStoreConfig, AuthKey } from './types.js';
import { getSecretsDir as resolveSecretsDir } from './paths.js';

// Re-export for back-compat — auth.ts was the original public source.
export { getProjectRoot, getWorktreeRoot } from './project.js';

const CONFIG_FILE = 'appstore-config.yaml';

/**
 * Get the path to the secrets directory.
 *
 * Re-exported from paths.ts. Configurable via
 * `appstore-cli.config.yaml` (`secrets_dir: ...`) at the project
 * root, or the `APPSTORE_SECRETS_DIR` env var. Default
 * `.secret-stuff/` at the project root.
 */
export function getSecretsDir(): string {
  return resolveSecretsDir();
}

/**
 * Load the App Store Connect configuration
 */
export function loadConfig(): AppStoreConfig {
  const secretsDir = getSecretsDir();
  const configPath = join(secretsDir, CONFIG_FILE);

  if (!existsSync(configPath)) {
    throw new Error(
      `App Store Connect config not found at ${configPath}\n` +
      `Please create ${CONFIG_FILE} in ${secretsDir}/ with the following structure:\n\n` +
      `issuer_id: "your-issuer-id"\n` +
      `app_id: "your-app-id"\n` +
      `keys:\n` +
      `  app_manager:\n` +
      `    key_id: "YOUR_KEY_ID"\n` +
      `    key_file: "AuthKey_YOUR_KEY_ID.p8"\n` +
      `default_key: "app_manager"\n`
    );
  }

  const content = readFileSync(configPath, 'utf-8');
  const config = parseYaml(content) as AppStoreConfig;

  // Validate required fields
  if (!config.issuer_id) {
    throw new Error('Config missing required field: issuer_id');
  }
  if (!config.app_id) {
    throw new Error('Config missing required field: app_id');
  }
  if (!config.keys || Object.keys(config.keys).length === 0) {
    throw new Error('Config missing required field: keys');
  }
  if (!config.default_key) {
    throw new Error('Config missing required field: default_key');
  }
  if (!config.keys[config.default_key]) {
    throw new Error(`Default key "${config.default_key}" not found in keys`);
  }

  return config;
}

/**
 * Get the auth key to use, following the priority order:
 * 1. Explicit key ID parameter
 * 2. APPSTORE_KEY_ID environment variable
 * 3. Config file default_key
 */
export function resolveKeyId(explicitKeyId?: string): string {
  if (explicitKeyId) {
    return explicitKeyId;
  }

  const envKeyId = process.env.APPSTORE_KEY_ID;
  if (envKeyId) {
    return envKeyId;
  }

  const config = loadConfig();
  return config.default_key;
}

/**
 * Get the auth key configuration
 */
export function getAuthKey(keyName?: string): AuthKey {
  const config = loadConfig();
  const keyId = keyName || config.default_key;

  const key = config.keys[keyId];
  if (!key) {
    const availableKeys = Object.keys(config.keys).join(', ');
    throw new Error(
      `Key "${keyId}" not found in config. Available keys: ${availableKeys}`
    );
  }

  return key;
}

/**
 * Get the full path to a key file
 */
export function getKeyPath(keyFile: string): string {
  const secretsDir = getSecretsDir();
  const keyPath = join(secretsDir, keyFile);

  if (!existsSync(keyPath)) {
    throw new Error(`Key file not found: ${keyPath}`);
  }

  return keyPath;
}

/**
 * Read the private key content
 */
export function readPrivateKey(keyFile: string): string {
  const keyPath = getKeyPath(keyFile);
  return readFileSync(keyPath, 'utf-8');
}

/**
 * Authentication context containing all required credentials
 */
export interface AuthContext {
  issuerId: string;
  keyId: string;
  privateKey: string;
  appId: string;
}

/**
 * Get a complete authentication context
 */
export function getAuthContext(keyName?: string): AuthContext {
  const config = loadConfig();
  const resolvedKeyName = resolveKeyId(keyName);
  const authKey = getAuthKey(resolvedKeyName);
  const privateKey = readPrivateKey(authKey.key_file);

  return {
    issuerId: config.issuer_id,
    keyId: authKey.key_id,
    privateKey,
    appId: config.app_id,
  };
}

/**
 * Validate that authentication is properly configured
 */
export function validateAuth(keyName?: string): void {
  try {
    getAuthContext(keyName);
    console.log('Authentication configured successfully.');
  } catch (error) {
    if (error instanceof Error) {
      console.error('Authentication validation failed:', error.message);
    }
    throw error;
  }
}
