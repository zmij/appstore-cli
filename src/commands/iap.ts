/**
 * In-App Purchase Commands
 *
 * Commands for managing in-app purchase and subscription localisations.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';
import { LANGUAGE_MAP } from '../types.js';
import type { IAPMetadata, IAPLocalisation } from '../types.js';

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

        // Build (productId → ASC object) lookups for every IAP and every
        // subscription under every group, so the per-locale loop just maps
        // productId → ASC id without re-listing on every step.
        const existingPurchases = await client.listInAppPurchases();
        const purchaseMap = new Map<string, any>(
          existingPurchases.map((p: any) => [p.attributes?.productId, p]),
        );

        const subscriptionGroups = await client.listSubscriptions();
        const subscriptionMap = new Map<string, any>();
        for (const group of subscriptionGroups) {
          const subs = await client.listSubscriptionsInGroup(group.id);
          for (const sub of subs) {
            const pid = sub.attributes?.productId;
            if (pid) subscriptionMap.set(pid, sub);
          }
        }

        let syncedCount = 0;
        let createdCount = 0;
        let errorCount = 0;

        // -- Purchases ----------------------------------------------------
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

            // Fetch the current locs once per product so we can report
            // create-vs-update accurately in the dry-run output. The client
            // upsert refetches internally, but that's a single extra call
            // on the live path — negligible compared to network RTT.
            const liveLocs = await client.listInAppPurchaseLocalisations(existingPurchase.id);
            const liveLocMap = new Map<string, any>(
              liveLocs.map((l: any) => [l.attributes?.locale, l]),
            );

            for (const [lang, localisation] of Object.entries(config.localisations || {})) {
              const locale = LANGUAGE_MAP[lang] || lang;
              const exists = liveLocMap.has(locale);
              const verb = exists ? chalk.yellow('update') : chalk.green('create');
              console.log(`    ${lang} (${locale}) ${verb}:`);
              console.log(`      Name: ${localisation.display_name}`);
              console.log(`      Description: ${truncate(localisation.description, 50)}`);

              if (!options.dryRun) {
                try {
                  await client.upsertInAppPurchaseLocalisation(
                    existingPurchase.id, locale,
                    { name: localisation.display_name, description: localisation.description },
                  );
                  if (!exists) createdCount++;
                } catch (err) {
                  errorCount++;
                  console.error(chalk.red(`      ✗ ${err instanceof Error ? err.message : err}`));
                  continue;
                }
              }
              syncedCount++;
            }
          }
        }

        // -- Subscriptions ------------------------------------------------
        if (metadata.subscriptions) {
          console.log(chalk.bold('\nSubscriptions:'));

          for (const [productId, config] of Object.entries(metadata.subscriptions)) {
            if (options.productId && productId !== options.productId) continue;

            console.log(chalk.cyan(`\n  ${productId}:`));

            const existingSubscription = subscriptionMap.get(productId);
            if (!existingSubscription) {
              console.log(chalk.yellow(`    Not found in any subscription group`));
              continue;
            }

            const liveLocs = await client.listSubscriptionLocalisations(existingSubscription.id);
            const liveLocMap = new Map<string, any>(
              liveLocs.map((l: any) => [l.attributes?.locale, l]),
            );

            for (const [lang, localisation] of Object.entries(config.localisations || {})) {
              const locale = LANGUAGE_MAP[lang] || lang;
              const exists = liveLocMap.has(locale);
              const verb = exists ? chalk.yellow('update') : chalk.green('create');
              console.log(`    ${lang} (${locale}) ${verb}:`);
              console.log(`      Name: ${localisation.display_name}`);
              console.log(`      Description: ${truncate(localisation.description, 50)}`);

              if (!options.dryRun) {
                try {
                  await client.upsertSubscriptionLocalisation(
                    existingSubscription.id, locale,
                    { name: localisation.display_name, description: localisation.description },
                  );
                  if (!exists) createdCount++;
                } catch (err) {
                  errorCount++;
                  console.error(chalk.red(`      ✗ ${err instanceof Error ? err.message : err}`));
                  continue;
                }
              }
              syncedCount++;
            }
          }
        }

        // -- Summary ------------------------------------------------------
        console.log(chalk.blue('\n--- Summary ---'));
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes were made'));
        }
        console.log(`Localisations processed: ${syncedCount}`);
        if (createdCount > 0) console.log(chalk.green(`  new: ${createdCount}`));
        if (errorCount > 0) console.log(chalk.red(`  errors: ${errorCount}`));
        if (errorCount > 0) process.exit(1);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Export current IAP metadata to YAML (round-trips localisations).
  iapCmd
    .command('export')
    .description('Export current IAP metadata + localisations to YAML')
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

        // Reverse map: ASC locale ("en-US", "de-DE") → short YAML lang
        // ("en", "de"). Multiple short tags may share a long form; first
        // wins. Falls back to the long form when no mapping is known.
        const reverseLocaleMap = new Map<string, string>();
        for (const [shortLang, longLocale] of Object.entries(LANGUAGE_MAP)) {
          if (!reverseLocaleMap.has(longLocale)) {
            reverseLocaleMap.set(longLocale, shortLang);
          }
        }
        const shortLang = (loc: string): string => reverseLocaleMap.get(loc) ?? loc;

        // -- Purchases --------------------------------------------------
        const purchases = await client.listInAppPurchases();
        for (const purchase of purchases) {
          const productId = purchase.attributes?.productId;
          if (!productId) continue;

          const locs = await client.listInAppPurchaseLocalisations(purchase.id);
          const yamlLocs: Record<string, IAPLocalisation> = {};
          for (const l of locs) {
            const locale = l.attributes?.locale;
            if (!locale) continue;
            yamlLocs[shortLang(locale)] = {
              display_name: l.attributes?.name ?? '',
              description: l.attributes?.description ?? '',
            };
          }

          metadata.purchases[productId] = {
            reference_name: purchase.attributes?.referenceName || '',
            localisations: yamlLocs,
          };
          console.log(`  Exported purchase: ${productId} (${Object.keys(yamlLocs).length} locales)`);
        }

        // -- Subscription groups → subscriptions ------------------------
        // The YAML schema keys subscriptions by productId at the top
        // level (no nested group structure), so flatten group → subs
        // here and key by each subscription's productId.
        const groups = await client.listSubscriptions();
        for (const group of groups) {
          const subs = await client.listSubscriptionsInGroup(group.id);
          for (const sub of subs) {
            const productId = sub.attributes?.productId;
            if (!productId) continue;

            const locs = await client.listSubscriptionLocalisations(sub.id);
            const yamlLocs: Record<string, IAPLocalisation> = {};
            for (const l of locs) {
              const locale = l.attributes?.locale;
              if (!locale) continue;
              yamlLocs[shortLang(locale)] = {
                display_name: l.attributes?.name ?? '',
                description: l.attributes?.description ?? '',
              };
            }

            metadata.subscriptions[productId] = {
              reference_name: sub.attributes?.name || productId,
              localisations: yamlLocs,
            };
            console.log(
              `  Exported subscription: ${productId} (group ${group.attributes?.referenceName ?? group.id}, ${Object.keys(yamlLocs).length} locales)`,
            );
          }
        }

        writeFileSync(options.output, stringify(metadata));
        console.log(chalk.green(`\n✓ Exported to: ${options.output}`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Show all localisations for one product (IAP or subscription) — quick
  // visual diff against the YAML before/after a sync.
  iapCmd
    .command('show <productId>')
    .description('Show every localisation on one IAP or subscription product')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (productId, options) => {
      try {
        const client = createClient(options.keyId);

        // Try IAPs first, then walk subscription groups.
        const purchases = await client.listInAppPurchases();
        const purchaseMatch = purchases.find((p: any) => p.attributes?.productId === productId);

        let kind: 'purchase' | 'subscription' | null = null;
        let productAscId: string | null = null;
        let referenceName = '';

        if (purchaseMatch) {
          kind = 'purchase';
          productAscId = purchaseMatch.id;
          referenceName = purchaseMatch.attributes?.referenceName ?? '';
        } else {
          const groups = await client.listSubscriptions();
          for (const group of groups) {
            const subs = await client.listSubscriptionsInGroup(group.id);
            const match = subs.find((s: any) => s.attributes?.productId === productId);
            if (match) {
              kind = 'subscription';
              productAscId = match.id;
              referenceName = match.attributes?.name ?? '';
              break;
            }
          }
        }

        if (!kind || !productAscId) {
          console.error(chalk.red(`No IAP or subscription found with productId "${productId}".`));
          process.exit(1);
        }

        const locs = kind === 'purchase'
          ? await client.listInAppPurchaseLocalisations(productAscId)
          : await client.listSubscriptionLocalisations(productAscId);

        console.log(chalk.bold(`${kind === 'purchase' ? 'In-App Purchase' : 'Subscription'}: ${productId}`));
        console.log(`  Reference: ${referenceName}`);
        console.log(`  ASC id: ${productAscId}`);
        console.log(`  ${locs.length} localisation(s):\n`);

        // Stable display order — sort by locale string.
        const sorted = locs.slice().sort((a: any, b: any) => {
          const la = a.attributes?.locale ?? '';
          const lb = b.attributes?.locale ?? '';
          return la.localeCompare(lb);
        });

        for (const l of sorted) {
          const locale = l.attributes?.locale ?? '?';
          const name = l.attributes?.name ?? '';
          const description = l.attributes?.description ?? '';
          console.log(chalk.cyan(`  ${locale}`));
          console.log(`    name: ${name}`);
          console.log(`    description: ${truncate(description, 80)}`);
        }
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
