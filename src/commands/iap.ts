/**
 * In-App Purchase Commands
 *
 * Commands for managing in-app purchase and subscription localisations.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';
import { LANGUAGE_MAP } from '../types.js';
import type { IAPMetadata } from '../types.js';

export function registerIAPCommands(program: Command): void {
  const iapCmd = program.command('iap').description('Manage in-app purchases and subscriptions');

  // List IAPs
  iapCmd
    .command('list')
    .description('List all in-app purchases and subscriptions')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);

        console.log(chalk.blue('In-App Purchases:\n'));

        const purchases = await client.listInAppPurchases();
        if (purchases.length === 0) {
          console.log('  No in-app purchases found.');
        } else {
          for (const purchase of purchases) {
            const name = purchase.attributes?.name || purchase.attributes?.referenceName || 'Unknown';
            const productId = purchase.attributes?.productId || 'Unknown';
            const state = purchase.attributes?.state || 'UNKNOWN';
            const stateColor = state === 'APPROVED' ? chalk.green : chalk.yellow;

            console.log(`  ${chalk.bold(name)}`);
            console.log(`    Product ID: ${productId}`);
            console.log(`    State: ${stateColor(state)}`);
            console.log(`    ID: ${purchase.id}`);
            console.log('');
          }
        }

        console.log(chalk.blue('Subscription Groups:\n'));

        const subscriptions = await client.listSubscriptions();
        if (subscriptions.length === 0) {
          console.log('  No subscription groups found.');
        } else {
          for (const group of subscriptions) {
            const name = group.attributes?.referenceName || 'Unknown';

            console.log(`  ${chalk.bold(name)}`);
            console.log(`    ID: ${group.id}`);
            console.log('');
          }
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Sync IAP localisations from YAML
  iapCmd
    .command('sync')
    .description('Sync in-app purchase localisations from YAML')
    .option('--product-id <productId>', 'Sync specific product only')
    .option('--dry-run', 'Show what would be changed without applying')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const { readFileSync, existsSync } = await import('fs');
        const { join } = await import('path');
        const { parse: parseYaml } = await import('yaml');
        const { getWorktreeRoot } = await import('../auth.js');

        const worktreeRoot = getWorktreeRoot();
        const iapPath = join(worktreeRoot, 'l10n', 'metadata', 'apple', 'iap.yaml');

        if (!existsSync(iapPath)) {
          console.error(chalk.red(`IAP metadata file not found: ${iapPath}`));
          console.log('Expected YAML file at l10n/metadata/apple/iap.yaml');
          process.exit(1);
        }

        const content = readFileSync(iapPath, 'utf-8');
        const metadata = parseYaml(content) as IAPMetadata;

        const client = createClient(options.keyId);

        console.log(chalk.blue('Syncing IAP localisations...'));
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes will be made\n'));
        }

        // Get existing IAPs
        const existingPurchases = await client.listInAppPurchases();
        const purchaseMap = new Map(
          existingPurchases.map((p: any) => [p.attributes?.productId, p])
        );

        let syncedCount = 0;
        let errorCount = 0;

        // Process purchases
        if (metadata.purchases) {
          console.log(chalk.bold('\nIn-App Purchases:'));

          for (const [productId, config] of Object.entries(metadata.purchases)) {
            if (options.productId && productId !== options.productId) continue;

            console.log(chalk.cyan(`\n  ${productId}:`));

            const existingPurchase = purchaseMap.get(productId);
            if (!existingPurchase) {
              console.log(chalk.yellow(`    Not found in App Store Connect`));
              continue;
            }

            // Process each localisation
            for (const [lang, localisation] of Object.entries(config.localisations || {})) {
              const locale = LANGUAGE_MAP[lang] || lang;
              console.log(`    ${lang} (${locale}):`);
              console.log(`      Name: ${localisation.display_name}`);
              console.log(`      Description: ${truncate(localisation.description, 50)}`);

              if (!options.dryRun) {
                // Note: The actual API call to update IAP localisation
                // would go here. The appstore-connect-sdk API for this
                // is more complex and requires fetching localisation IDs first.
                console.log(chalk.gray('      (IAP update not yet implemented)'));
              }
              syncedCount++;
            }
          }
        }

        // Process subscriptions
        if (metadata.subscriptions) {
          console.log(chalk.bold('\nSubscriptions:'));

          for (const [productId, config] of Object.entries(metadata.subscriptions)) {
            if (options.productId && productId !== options.productId) continue;

            console.log(chalk.cyan(`\n  ${productId}:`));

            // Process each localisation
            for (const [lang, localisation] of Object.entries(config.localisations || {})) {
              const locale = LANGUAGE_MAP[lang] || lang;
              console.log(`    ${lang} (${locale}):`);
              console.log(`      Name: ${localisation.display_name}`);
              console.log(`      Description: ${truncate(localisation.description, 50)}`);

              if (!options.dryRun) {
                console.log(chalk.gray('      (Subscription update not yet implemented)'));
              }
              syncedCount++;
            }
          }
        }

        // Summary
        console.log(chalk.blue('\n--- Summary ---'));
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes were made'));
        }
        console.log(`Localisations processed: ${syncedCount}`);
        if (errorCount > 0) console.log(chalk.red(`Errors: ${errorCount}`));

        console.log(
          chalk.yellow(
            '\nNote: Full IAP/subscription update requires additional API implementation.'
          )
        );
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Export current IAP metadata to YAML
  iapCmd
    .command('export')
    .description('Export current IAP metadata to YAML')
    .requiredOption('--output <file>', 'Output YAML file path')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const { writeFileSync } = await import('fs');
        const { stringify } = await import('yaml');

        const client = createClient(options.keyId);

        console.log(chalk.blue('Exporting IAP metadata...\n'));

        const metadata: IAPMetadata = {
          purchases: {},
          subscriptions: {},
        };

        // Export purchases
        const purchases = await client.listInAppPurchases();
        for (const purchase of purchases) {
          const productId = purchase.attributes?.productId;
          if (!productId) continue;

          metadata.purchases[productId] = {
            reference_name: purchase.attributes?.referenceName || '',
            localisations: {},
          };

          console.log(`  Exported purchase: ${productId}`);
        }

        // Export subscription groups
        const groups = await client.listSubscriptions();
        for (const group of groups) {
          const groupName = group.attributes?.referenceName;
          if (!groupName) continue;

          metadata.subscriptions[groupName] = {
            reference_name: groupName,
            localisations: {},
          };

          console.log(`  Exported subscription group: ${groupName}`);
        }

        // Write to file
        writeFileSync(options.output, stringify(metadata));
        console.log(chalk.green(`\n✓ Exported to: ${options.output}`));

        console.log(
          chalk.yellow(
            '\nNote: Localisation details require additional API calls to fetch.'
          )
        );
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

function truncate(text: string, maxLength: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim();
  if (oneLine.length <= maxLength) return oneLine;
  return oneLine.substring(0, maxLength - 3) + '...';
}
