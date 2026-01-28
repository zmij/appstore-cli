/**
 * Custom Product Pages Commands
 *
 * Commands for managing App Store custom product pages.
 * Initially read-only to discover page IDs and structure.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';

export function registerPagesCommands(program: Command): void {
  const pagesCmd = program
    .command('pages')
    .description('Manage custom product pages');

  // List custom pages
  pagesCmd
    .command('list')
    .description('List all custom product pages')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);

        console.log(chalk.blue('Custom Product Pages:\n'));

        const pages = await client.listCustomProductPages();

        if (pages.length === 0) {
          console.log('  No custom product pages found.');
          return;
        }

        for (const page of pages) {
          const visibleIcon = page.visible ? chalk.green('✓') : chalk.red('✗');
          console.log(`  ${chalk.bold(page.name)} ${visibleIcon}`);
          console.log(`    ID: ${page.id}`);
          if (page.url) {
            console.log(`    URL: ${page.url}`);
          }
          console.log(`    Visible: ${page.visible ? 'Yes' : 'No'}`);
          console.log('');
        }

        console.log(chalk.gray('Use "appstore pages show --page-id <id>" for details'));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Show page details
  pagesCmd
    .command('show')
    .description('Show details for a custom product page')
    .requiredOption('--page-id <pageId>', 'Page ID to show')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);

        const page = await client.getCustomProductPage(options.pageId);

        if (!page) {
          console.log(chalk.yellow(`Page not found: ${options.pageId}`));
          return;
        }

        console.log(chalk.blue('Custom Product Page Details:\n'));
        console.log(chalk.bold('Name:'), page.name);
        console.log(chalk.bold('ID:'), page.id);
        console.log(chalk.bold('URL:'), page.url || '(none)');
        console.log(chalk.bold('Visible:'), page.visible ? 'Yes' : 'No');

        console.log(chalk.gray('\nNote: Localisation and screenshot details'));
        console.log(chalk.gray('require additional API calls not yet implemented.'));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Export custom pages structure
  pagesCmd
    .command('export')
    .description('Export custom pages structure to YAML')
    .requiredOption('--output <directory>', 'Output directory')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const { mkdirSync, writeFileSync } = await import('fs');
        const { join } = await import('path');
        const { stringify } = await import('yaml');

        const client = createClient(options.keyId);

        console.log(chalk.blue('Exporting custom pages structure...\n'));

        // Create output directory
        mkdirSync(options.output, { recursive: true });

        const pages = await client.listCustomProductPages();

        if (pages.length === 0) {
          console.log('  No custom product pages found.');
          return;
        }

        for (const page of pages) {
          // Create directory for each page
          const pageDir = join(options.output, page.id);
          mkdirSync(pageDir, { recursive: true });

          // Write config file
          const config = {
            id: page.id,
            name: page.name,
            url: page.url,
            visible: page.visible,
            exported_at: new Date().toISOString(),
          };

          writeFileSync(join(pageDir, 'config.yaml'), stringify(config));
          console.log(`  Exported: ${page.name} -> ${page.id}/`);
        }

        console.log(chalk.green(`\n✓ Export complete: ${options.output}`));
        console.log(chalk.gray('\nNote: Localised content and screenshots'));
        console.log(chalk.gray('require additional API implementation.'));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Placeholder for future update command
  pagesCmd
    .command('update')
    .description('Update custom page localisations (not yet implemented)')
    .requiredOption('--page-id <pageId>', 'Page ID to update')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async () => {
      console.log(chalk.yellow('Custom page update is not yet implemented.'));
      console.log('');
      console.log('To implement this feature, we need to:');
      console.log('  1. Fetch page versions');
      console.log('  2. Fetch page localisations for each version');
      console.log('  3. Update promotional text and screenshots');
      console.log('');
      console.log('Use "appstore pages list" to discover page IDs first.');
    });

  // Placeholder for future screenshots command
  pagesCmd
    .command('screenshots')
    .description('Manage custom page screenshots (not yet implemented)')
    .requiredOption('--page-id <pageId>', 'Page ID')
    .option('--source <directory>', 'Source directory for screenshots')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async () => {
      console.log(chalk.yellow('Custom page screenshots management is not yet implemented.'));
      console.log('');
      console.log('This feature will support:');
      console.log('  - Listing current screenshots');
      console.log('  - Uploading new screenshots');
      console.log('  - Reordering screenshots');
      console.log('');
      console.log('Use "appstore pages list" to discover page IDs first.');
    });
}
