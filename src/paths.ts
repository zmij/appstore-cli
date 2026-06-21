/**
 * Path conventions for the appstore-cli.
 *
 * The CLI works against two filesystem locations:
 *
 *   * secrets_dir   — where appstore-config.yaml + the .p8 auth keys
 *                     live. Defaults to `.secret-stuff/` at the
 *                     project root.
 *   * metadata_dir  — where the committed YAML metadata lives
 *                     (listings/, iap.yaml, screenshots/order.yaml).
 *                     Defaults to `l10n/metadata/apple/` at the
 *                     worktree root.
 *
 * Both can be overridden by `appstore-cli.config.yaml` at the
 * worktree root:
 *
 *   secrets_dir:  config/appstore-secrets        # relative to project root
 *   metadata_dir: store-metadata/apple           # relative to worktree root
 *
 * Or via environment variables (env wins over file, file wins over
 * defaults — so you can pin a one-off path without editing the
 * project config):
 *
 *   APPSTORE_SECRETS_DIR=...
 *   APPSTORE_METADATA_DIR=...
 *
 * The defaults match the Lazy Sudoku layout this tool was extracted
 * from; downstream projects can either adopt the same layout (no
 * config needed) or override.
 */

import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import { parse as parseYaml } from 'yaml';
import { getProjectRoot, getWorktreeRoot } from './project.js';

const DEFAULT_SECRETS_DIR = '.secret-stuff';
const DEFAULT_METADATA_DIR = 'l10n/metadata/apple';
const PROJECT_CONFIG_FILE = 'appstore-cli.config.yaml';

interface PathsConfig {
  secrets_dir?: string;
  metadata_dir?: string;
}

let cachedConfig: PathsConfig | null = null;

/** Load the project-level paths config, if any. Cached after first
 *  read. Looks at the worktree root first (so worktrees can override
 *  on a per-branch basis); falls back to project root. */
function loadPathsConfig(): PathsConfig {
  if (cachedConfig !== null) return cachedConfig;

  const candidates = [
    join(getWorktreeRoot(), PROJECT_CONFIG_FILE),
    join(getProjectRoot(), PROJECT_CONFIG_FILE),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      const parsed = parseYaml(readFileSync(path, 'utf-8')) as PathsConfig | null;
      cachedConfig = parsed ?? {};
      return cachedConfig;
    }
  }

  cachedConfig = {};
  return cachedConfig;
}

/** Resolve a path against the given root, unless it's already
 *  absolute (in which case respect the user's intent). */
function resolveRelative(root: string, value: string): string {
  return isAbsolute(value) ? value : join(root, value);
}

/** The secrets directory — where `appstore-config.yaml` + .p8 files
 *  live. Resolves against project root (not worktree) because
 *  secrets are typically shared across branches. */
export function getSecretsDir(): string {
  const fromEnv = process.env.APPSTORE_SECRETS_DIR;
  const fromConfig = loadPathsConfig().secrets_dir;
  const value = fromEnv ?? fromConfig ?? DEFAULT_SECRETS_DIR;
  return resolveRelative(getProjectRoot(), value);
}

/** The metadata directory — where committed YAML lives. Resolves
 *  against worktree root because metadata is branch-specific (you
 *  might be editing listings on a feature branch). */
export function getMetadataDir(): string {
  const fromEnv = process.env.APPSTORE_METADATA_DIR;
  const fromConfig = loadPathsConfig().metadata_dir;
  const value = fromEnv ?? fromConfig ?? DEFAULT_METADATA_DIR;
  return resolveRelative(getWorktreeRoot(), value);
}

/** Path to `{metadata_dir}/iap.yaml`. */
export function getIapYamlPath(): string {
  return join(getMetadataDir(), 'iap.yaml');
}

/** Path to `{metadata_dir}/listings/`. */
export function getListingsDir(): string {
  return join(getMetadataDir(), 'listings');
}

/** Path to a single locale's listing YAML, e.g. `en.yaml`. */
export function getListingPath(locale: string): string {
  return join(getListingsDir(), `${locale}.yaml`);
}

/** Path to `{metadata_dir}/screenshots/order.yaml`. */
export function getScreenshotsOrderPath(): string {
  return join(getMetadataDir(), 'screenshots', 'order.yaml');
}

/** Reset the cached config — useful in tests, or if the CLI is
 *  re-used in a long-lived process (e.g. the MCP server) and the
 *  file may have changed. */
export function clearPathsCache(): void {
  cachedConfig = null;
}
