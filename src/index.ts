#!/usr/bin/env node
/**
 * App Store Connect CLI
 *
 * Command-line tool for managing App Store Connect metadata,
 * screenshots, and in-app purchases.
 */

import { program } from 'commander';
import chalk from 'chalk';

// Import commands
import { registerListingsCommands } from './commands/listings.js';
import { registerScreenshotsCommands } from './commands/screenshots.js';
import { registerIAPCommands } from './commands/iap.js';
import { registerPagesCommands } from './commands/custom-pages.js';
import { registerReadCommands } from './commands/read.js';

program
  .name('appstore')
  .description('CLI tool for managing App Store Connect metadata and assets')
  .version('1.0.0');

// Global options
program.option('--key-id <keyId>', 'Use specific auth key from config');

// Register command groups
registerReadCommands(program);
registerListingsCommands(program);
registerScreenshotsCommands(program);
registerIAPCommands(program);
registerPagesCommands(program);

// Auth validation command
program
  .command('auth')
  .description('Validate authentication configuration')
  .action(async () => {
    try {
      const { validateAuth, loadConfig, getSecretsDir } = await import('./auth.js');

      console.log(chalk.blue('Checking authentication configuration...'));
      console.log(`Secrets directory: ${getSecretsDir()}`);

      const config = loadConfig();
      console.log(`Issuer ID: ${config.issuer_id.substring(0, 8)}...`);
      console.log(`App ID: ${config.app_id}`);
      console.log(`Available keys: ${Object.keys(config.keys).join(', ')}`);
      console.log(`Default key: ${config.default_key}`);

      validateAuth();
      console.log(chalk.green('✓ Authentication is properly configured'));
    } catch (error) {
      console.error(chalk.red('✗ Authentication error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Setup command - fetch app ID by bundle ID
program
  .command('setup')
  .description('Fetch app ID from App Store Connect by bundle ID')
  .requiredOption('--bundle-id <bundleId>', 'Bundle ID (e.g., online.lazy-sudoku.app)')
  .option('--issuer-id <issuerId>', 'Issuer ID (or set APP_STORE_CONNECT_ISSUER_ID)')
  .option('--key-id <keyId>', 'Key ID (or set APP_STORE_CONNECT_KEY_ID)')
  .option('--key-file <keyFile>', 'Path to .p8 key file (or set APP_STORE_CONNECT_KEY_FILE)')
  .action(async (options) => {
    try {
      const { readFileSync } = await import('fs');
      const { AppStoreClient } = await import('./client.js');

      const issuerId = options.issuerId || process.env.APP_STORE_CONNECT_ISSUER_ID;
      const keyId = options.keyId || process.env.APP_STORE_CONNECT_KEY_ID;
      const keyFile = options.keyFile || process.env.APP_STORE_CONNECT_KEY_FILE;

      if (!issuerId || !keyId || !keyFile) {
        console.error(chalk.red('Missing required credentials.'));
        console.log('Provide via options or environment variables:');
        console.log('  --issuer-id or APP_STORE_CONNECT_ISSUER_ID');
        console.log('  --key-id or APP_STORE_CONNECT_KEY_ID');
        console.log('  --key-file or APP_STORE_CONNECT_KEY_FILE');
        process.exit(1);
      }

      console.log(chalk.blue(`Looking up app with bundle ID: ${options.bundleId}`));

      const privateKey = readFileSync(keyFile, 'utf-8');
      const appId = await AppStoreClient.findAppIdByBundleId(
        issuerId,
        keyId,
        privateKey,
        options.bundleId
      );

      if (!appId) {
        console.error(chalk.red(`No app found with bundle ID: ${options.bundleId}`));
        process.exit(1);
      }

      console.log(chalk.green(`\n✓ Found app ID: ${appId}`));
      console.log('\nAdd this to your appstore-config.yaml:');
      console.log(chalk.cyan(`app_id: "${appId}"`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
