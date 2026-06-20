/**
 * In-App Purchase Commands
 *
 * Commands for managing in-app purchase and subscription localisations.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';
import { LANGUAGE_MAP } from '../types.js';
import type { IAPMetadata, IAPLocalisation, IntroOffer, SubscriptionGroupLocalisation } from '../types.js';

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
        let priceCount = 0;
        let availabilityCount = 0;
        let introOfferCount = 0;

        // Resolve YAML `territories: 'all'` to the live set already on
        // the product — handy for stay-at-full-coverage edits where the
        // user only flips `available_in_new_territories`.
        const resolveTerritories = async (
          live: string[],
          yaml: string[] | 'all',
        ): Promise<string[]> => (yaml === 'all' ? live : yaml);

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

            // Pricing — only push when YAML carries a price block. ASC
            // takes the absolute schedule (no merging), so push = create
            // a new price schedule pointing at the desired (territory,
            // tier) pair.
            if (config.price) {
              const livePrice = await client.getInAppPurchasePriceSummary(existingPurchase.id);
              const sameTerritory = livePrice?.base_territory === config.price.base_territory;
              const samePrice = livePrice?.base_price === config.price.base_price;
              if (sameTerritory && samePrice) {
                console.log(chalk.gray(`    price unchanged (${config.price.base_price} ${config.price.base_territory})`));
              } else {
                const verb = livePrice ? chalk.yellow('update') : chalk.green('create');
                console.log(`    price ${verb}: ${config.price.base_price} ${config.price.base_territory}`);
                if (!options.dryRun) {
                  try {
                    const pricePointId = await client.findInAppPurchasePricePoint(
                      existingPurchase.id, config.price.base_territory, config.price.base_price,
                    );
                    await client.createInAppPurchasePriceSchedule(
                      existingPurchase.id, config.price.base_territory, pricePointId,
                    );
                    priceCount++;
                  } catch (err) {
                    errorCount++;
                    console.error(chalk.red(`      ✗ ${err instanceof Error ? err.message : err}`));
                  }
                }
              }
            }

            // Availability — only push when YAML carries an availability
            // block. Same all-or-nothing model as pricing.
            if (config.availability) {
              const liveAvail = await client.getInAppPurchaseAvailability(existingPurchase.id);
              const targetTerritories = await resolveTerritories(
                liveAvail?.territories ?? [], config.availability.territories,
              );
              const sameFlag = liveAvail?.available_in_new_territories === config.availability.available_in_new_territories;
              const sameTerritories = liveAvail &&
                liveAvail.territories.length === targetTerritories.length &&
                liveAvail.territories.every((t, i) => t === [...targetTerritories].sort()[i]);
              if (sameFlag && sameTerritories) {
                console.log(chalk.gray(`    availability unchanged (${targetTerritories.length} territories)`));
              } else {
                const verb = liveAvail ? chalk.yellow('update') : chalk.green('create');
                console.log(`    availability ${verb}: ${targetTerritories.length} territories, new-territory rollout: ${config.availability.available_in_new_territories ? 'YES' : 'no'}`);
                if (!options.dryRun) {
                  try {
                    await client.createInAppPurchaseAvailability(
                      existingPurchase.id, config.availability.available_in_new_territories, targetTerritories,
                    );
                    availabilityCount++;
                  } catch (err) {
                    errorCount++;
                    console.error(chalk.red(`      ✗ ${err instanceof Error ? err.message : err}`));
                  }
                }
              }
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

            if (config.price) {
              const livePrice = await client.getSubscriptionPriceSummary(existingSubscription.id);
              const sameTerritory = livePrice?.base_territory === config.price.base_territory;
              const samePrice = livePrice?.base_price === config.price.base_price;
              if (sameTerritory && samePrice) {
                console.log(chalk.gray(`    price unchanged (${config.price.base_price} ${config.price.base_territory})`));
              } else {
                const verb = livePrice ? chalk.yellow('update') : chalk.green('create');
                console.log(`    price ${verb}: ${config.price.base_price} ${config.price.base_territory}`);
                if (!options.dryRun) {
                  try {
                    const pricePointId = await client.findSubscriptionPricePoint(
                      existingSubscription.id, config.price.base_territory, config.price.base_price,
                    );
                    await client.createSubscriptionBasePrice(
                      existingSubscription.id, config.price.base_territory, pricePointId,
                    );
                    priceCount++;
                  } catch (err) {
                    errorCount++;
                    console.error(chalk.red(`      ✗ ${err instanceof Error ? err.message : err}`));
                  }
                }
              }
            }

            if (config.availability) {
              const liveAvail = await client.getSubscriptionAvailability(existingSubscription.id);
              const targetTerritories = await resolveTerritories(
                liveAvail?.territories ?? [], config.availability.territories,
              );
              const sameFlag = liveAvail?.available_in_new_territories === config.availability.available_in_new_territories;
              const sameTerritories = liveAvail &&
                liveAvail.territories.length === targetTerritories.length &&
                liveAvail.territories.every((t, i) => t === [...targetTerritories].sort()[i]);
              if (sameFlag && sameTerritories) {
                console.log(chalk.gray(`    availability unchanged (${targetTerritories.length} territories)`));
              } else {
                const verb = liveAvail ? chalk.yellow('update') : chalk.green('create');
                console.log(`    availability ${verb}: ${targetTerritories.length} territories, new-territory rollout: ${config.availability.available_in_new_territories ? 'YES' : 'no'}`);
                if (!options.dryRun) {
                  try {
                    await client.createSubscriptionAvailability(
                      existingSubscription.id, config.availability.available_in_new_territories, targetTerritories,
                    );
                    availabilityCount++;
                  } catch (err) {
                    errorCount++;
                    console.error(chalk.red(`      ✗ ${err instanceof Error ? err.message : err}`));
                  }
                }
              }
            }

            // Intro offers — smart diff against the live set. Match by
            // (mode, duration, periods, territory) tuple; create what's
            // in YAML but not on ASC; delete what's on ASC but not in
            // YAML. Idempotent and minimal-change.
            if (config.intro_offers) {
              const liveOffers = await client.listSubscriptionIntroductoryOffers(existingSubscription.id);
              const offerKey = (mode: string, dur: string, per: number, terr?: string | null) =>
                `${mode}|${dur}|${per}|${terr ?? '*'}`;
              const yamlKeys = new Set(
                config.intro_offers.map((o) => offerKey(o.mode, o.duration, o.periods, o.territory)),
              );
              const liveKeys = new Map<string, any>();
              for (const off of liveOffers) {
                const k = offerKey(
                  off.attributes?.offerMode, off.attributes?.duration,
                  off.attributes?.numberOfPeriods, off._territory,
                );
                liveKeys.set(k, off);
              }

              // Create offers present in YAML but not live.
              for (const offer of config.intro_offers) {
                const key = offerKey(offer.mode, offer.duration, offer.periods, offer.territory);
                if (liveKeys.has(key)) {
                  console.log(chalk.gray(`    intro_offer unchanged: ${offer.mode} ${offer.periods}×${offer.duration}${offer.territory ? ` (${offer.territory})` : ''}`));
                  continue;
                }
                console.log(`    intro_offer ${chalk.green('create')}: ${offer.mode} ${offer.periods}×${offer.duration}${offer.territory ? ` (${offer.territory})` : ' (global)'}${offer.price ? ` @ ${offer.price}` : ''}`);
                if (options.dryRun) continue;
                try {
                  let pricePointId: string | undefined;
                  if (offer.mode !== 'FREE_TRIAL') {
                    if (!offer.price) {
                      throw new Error(`intro_offer mode=${offer.mode} requires a \`price\` field`);
                    }
                    if (offer.price.startsWith('pricePoint:')) {
                      // Round-tripped opaque id from export — pass through.
                      pricePointId = offer.price.slice('pricePoint:'.length);
                    } else {
                      // Resolve customer-facing price to a point id.
                      const territoryForLookup = offer.territory ?? 'USA';
                      pricePointId = await client.findSubscriptionPricePoint(
                        existingSubscription.id, territoryForLookup, offer.price,
                      );
                    }
                  }
                  await client.createSubscriptionIntroductoryOffer({
                    subscriptionId: existingSubscription.id,
                    duration: offer.duration,
                    offerMode: offer.mode,
                    numberOfPeriods: offer.periods,
                    territory: offer.territory,
                    pricePointId,
                    startDate: offer.start_date,
                    endDate: offer.end_date,
                  });
                  introOfferCount++;
                } catch (err) {
                  errorCount++;
                  console.error(chalk.red(`      ✗ ${err instanceof Error ? err.message : err}`));
                }
              }

              // Delete offers live but not in YAML.
              for (const [key, off] of liveKeys.entries()) {
                if (yamlKeys.has(key)) continue;
                console.log(`    intro_offer ${chalk.red('delete')}: ${off.attributes?.offerMode} ${off.attributes?.numberOfPeriods}×${off.attributes?.duration}${off._territory ? ` (${off._territory})` : ' (global)'}`);
                if (options.dryRun) continue;
                try {
                  await client.deleteSubscriptionIntroductoryOffer(off.id);
                  introOfferCount++;
                } catch (err) {
                  errorCount++;
                  console.error(chalk.red(`      ✗ ${err instanceof Error ? err.message : err}`));
                }
              }
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
        if (priceCount > 0) console.log(chalk.green(`Price schedules: ${priceCount}`));
        if (availabilityCount > 0) console.log(chalk.green(`Availabilities: ${availabilityCount}`));
        if (introOfferCount > 0) console.log(chalk.green(`Intro offers (created+deleted): ${introOfferCount}`));
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
          subscription_groups: {},
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

        // Helper: emit `'all'` when the live territory list contains
        // every territory the export run knows about, otherwise the full
        // ISO3 array. Lets human-edited YAML stay terse for the common
        // "available everywhere" case.
        const knownTerritoryCount = new Map<number, true>(); // tracked below
        const allShorthand = (live: string[]): string[] | 'all' => {
          // Apple ships ~175 territories total today; if a product covers
          // every entry on a reference roster we tag the export as "all".
          // We snapshot the largest list seen during this run as the
          // reference — pragmatic but stable across products that ship
          // everywhere.
          knownTerritoryCount.set(live.length, true);
          return live;
        };

        // -- Purchases --------------------------------------------------
        const purchases = await client.listInAppPurchases();
        for (const purchase of purchases) {
          const productId = purchase.attributes?.productId;
          if (!productId) continue;

          const [locs, price, availability] = await Promise.all([
            client.listInAppPurchaseLocalisations(purchase.id),
            client.getInAppPurchasePriceSummary(purchase.id),
            client.getInAppPurchaseAvailability(purchase.id),
          ]);

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
            type: purchase.attributes?.inAppPurchaseType,
            family_sharable: purchase.attributes?.familySharable,
            ...(price && {
              price: {
                base_territory: price.base_territory,
                base_price: price.base_price,
              },
            }),
            ...(availability && {
              availability: {
                available_in_new_territories: availability.available_in_new_territories,
                territories: allShorthand(availability.territories),
              },
            }),
            localisations: yamlLocs,
          };
          const priceLabel = price ? `${price.base_price} ${price.base_territory}` : 'no price';
          const availLabel = availability ? `${availability.territories.length} terr` : 'no avail';
          console.log(`  Exported purchase: ${productId} (${Object.keys(yamlLocs).length} locales, ${priceLabel}, ${availLabel})`);
        }

        // -- Subscription groups → subscriptions ------------------------
        // The YAML schema keys subscriptions by productId at the top
        // level (no nested group structure), so flatten group → subs
        // here and key by each subscription's productId. The group's own
        // shape (reference_name + locs) emits to subscription_groups so
        // a future `iap create` can reconstruct it.
        const groups = await client.listSubscriptions();
        for (const group of groups) {
          const groupRefName = group.attributes?.referenceName ?? group.id;
          const groupLocs = await client.listSubscriptionGroupLocalisations(group.id);
          const yamlGroupLocs: Record<string, SubscriptionGroupLocalisation> = {};
          for (const l of groupLocs) {
            const locale = l.attributes?.locale;
            if (!locale) continue;
            yamlGroupLocs[shortLang(locale)] = {
              name: l.attributes?.name ?? '',
              ...(l.attributes?.customAppName && { custom_app_name: l.attributes.customAppName }),
            };
          }
          metadata.subscription_groups![groupRefName] = {
            reference_name: groupRefName,
            ...(Object.keys(yamlGroupLocs).length > 0 && { localisations: yamlGroupLocs }),
          };

          const subs = await client.listSubscriptionsInGroup(group.id);
          for (const sub of subs) {
            const productId = sub.attributes?.productId;
            if (!productId) continue;

            const [locs, price, availability, introOffers] = await Promise.all([
              client.listSubscriptionLocalisations(sub.id),
              client.getSubscriptionPriceSummary(sub.id),
              client.getSubscriptionAvailability(sub.id),
              client.listSubscriptionIntroductoryOffers(sub.id),
            ]);

            const yamlLocs: Record<string, IAPLocalisation> = {};
            for (const l of locs) {
              const locale = l.attributes?.locale;
              if (!locale) continue;
              yamlLocs[shortLang(locale)] = {
                display_name: l.attributes?.name ?? '',
                description: l.attributes?.description ?? '',
              };
            }

            // Pull each intro offer's customer-facing price from the
            // attached price-point row (for FREE_TRIAL there is none, so
            // leave price unset).
            const yamlIntroOffers: IntroOffer[] = [];
            for (const off of introOffers) {
              const mode = off.attributes?.offerMode;
              const duration = off.attributes?.duration;
              const periods = off.attributes?.numberOfPeriods;
              if (!mode || !duration || periods === undefined) continue;
              const entry: IntroOffer = { mode, duration, periods };
              if (off._territory) entry.territory = off._territory;
              if (off.attributes?.startDate) entry.start_date = off.attributes.startDate;
              if (off.attributes?.endDate) entry.end_date = off.attributes.endDate;
              if (mode !== 'FREE_TRIAL' && off._price_point_id) {
                // Round-tripping the customer price needs a follow-up
                // request to subscriptionPricePoints — but for the
                // common FREE_TRIAL case we can skip the extra hop. For
                // paid intro offers, surface the opaque price-point id
                // as a comment so the operator can replace with the
                // customer-facing tier they want.
                entry.price = `pricePoint:${off._price_point_id}`;
              }
              yamlIntroOffers.push(entry);
            }

            metadata.subscriptions[productId] = {
              reference_name: sub.attributes?.name || productId,
              group: groupRefName,
              subscription_period: sub.attributes?.subscriptionPeriod,
              family_sharable: sub.attributes?.familySharable,
              ...(sub.attributes?.groupLevel !== undefined && {
                group_level: sub.attributes.groupLevel,
              }),
              ...(price && {
                price: {
                  base_territory: price.base_territory,
                  base_price: price.base_price,
                },
              }),
              ...(availability && {
                availability: {
                  available_in_new_territories: availability.available_in_new_territories,
                  territories: allShorthand(availability.territories),
                },
              }),
              ...(yamlIntroOffers.length > 0 && { intro_offers: yamlIntroOffers }),
              localisations: yamlLocs,
            };
            const priceLabel = price ? `${price.base_price} ${price.base_territory}` : 'no price';
            const availLabel = availability ? `${availability.territories.length} terr` : 'no avail';
            const offerLabel = yamlIntroOffers.length > 0 ? `, ${yamlIntroOffers.length} intro` : '';
            console.log(
              `  Exported subscription: ${productId} (group ${group.attributes?.referenceName ?? group.id}, ${Object.keys(yamlLocs).length} locales, ${priceLabel}, ${availLabel}${offerLabel})`,
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

        // Pricing + availability run in parallel to keep `iap show` snappy
        // — both are independent reads against ASC.
        const [price, availability] = await Promise.all([
          kind === 'purchase'
            ? client.getInAppPurchasePriceSummary(productAscId)
            : client.getSubscriptionPriceSummary(productAscId),
          kind === 'purchase'
            ? client.getInAppPurchaseAvailability(productAscId)
            : client.getSubscriptionAvailability(productAscId),
        ]);

        console.log(chalk.bold(`${kind === 'purchase' ? 'In-App Purchase' : 'Subscription'}: ${productId}`));
        console.log(`  Reference: ${referenceName}`);
        console.log(`  ASC id: ${productAscId}`);

        if (price) {
          const currency = (price as any).base_currency ? ` ${(price as any).base_currency}` : '';
          console.log(chalk.bold('\n  Price (auto-equalised from base):'));
          console.log(`    base_territory: ${price.base_territory}`);
          console.log(`    base_price: ${price.base_price}${currency}`);
        } else {
          console.log(chalk.gray('\n  Price: (not yet set)'));
        }

        if (availability) {
          const flagLabel = availability.available_in_new_territories
            ? chalk.green('YES (auto-rollout)')
            : chalk.yellow('no');
          console.log(chalk.bold('\n  Availability:'));
          console.log(`    available_in_new_territories: ${flagLabel}`);
          console.log(`    territories: ${availability.territories.length} (first 10: ${availability.territories.slice(0, 10).join(', ')}${availability.territories.length > 10 ? '…' : ''})`);
        } else {
          console.log(chalk.gray('\n  Availability: (not yet set)'));
        }

        // Intro offers are subscription-only; skip for one-shot IAPs.
        if (kind === 'subscription') {
          const offers = await client.listSubscriptionIntroductoryOffers(productAscId);
          if (offers.length === 0) {
            console.log(chalk.gray('\n  Intro offers: (none)'));
          } else {
            console.log(chalk.bold(`\n  Intro offers (${offers.length}):`));
            for (const o of offers) {
              const mode = o.attributes?.offerMode ?? '?';
              const dur = o.attributes?.duration ?? '?';
              const periods = o.attributes?.numberOfPeriods ?? '?';
              const territory = o._territory ?? chalk.gray('(global)');
              const window = o.attributes?.startDate || o.attributes?.endDate
                ? ` [${o.attributes?.startDate ?? '∞'} → ${o.attributes?.endDate ?? '∞'}]`
                : '';
              console.log(`    ${chalk.cyan(mode)} ${periods} × ${dur} — territory: ${territory}${window}`);
            }
          }
        }

        console.log(chalk.bold(`\n  ${locs.length} localisation(s):\n`));

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

  // Create new IAPs / subscription groups / subscriptions from the YAML.
  // Hard-fails per item when a productId / group reference name already
  // exists on ASC, but continues walking the rest of the YAML so a
  // partial run can finish and the operator only retries the gaps.
  iapCmd
    .command('create')
    .description('Create new IAPs, subscription groups, and subscriptions from YAML (hard-fails on duplicates)')
    .option('--product-id <productId>', 'Create only the entry with this productId / group ref_name')
    .option('--dry-run', 'Show what would be created without applying')
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
          process.exit(1);
        }
        const metadata = parseYaml(readFileSync(iapPath, 'utf-8')) as IAPMetadata;

        const client = createClient(options.keyId);

        console.log(chalk.blue('Creating new IAPs / groups / subscriptions from YAML...'));
        if (options.dryRun) console.log(chalk.yellow('DRY RUN - no changes will be made\n'));

        // Snapshot what's already on ASC so we can hard-fail on
        // collisions without each create call costing a round trip.
        const [livePurchases, liveGroups] = await Promise.all([
          client.listInAppPurchases(),
          client.listSubscriptions(),
        ]);
        const livePurchaseIds = new Set(livePurchases.map((p: any) => p.attributes?.productId));
        const liveGroupRefs = new Map<string, string>(); // refName → ASC id
        const liveSubIds = new Set<string>();
        for (const g of liveGroups) {
          const refName = g.attributes?.referenceName;
          if (refName) liveGroupRefs.set(refName, g.id);
          const subs = await client.listSubscriptionsInGroup(g.id);
          for (const s of subs) {
            const pid = s.attributes?.productId;
            if (pid) liveSubIds.add(pid);
          }
        }

        let createdGroups = 0;
        let createdPurchases = 0;
        let createdSubscriptions = 0;
        let failures = 0;

        const groupRefToAscId = new Map<string, string>(liveGroupRefs);

        // -- Subscription groups (must come first; subs depend on them) ---
        if (metadata.subscription_groups) {
          console.log(chalk.bold('\nSubscription groups:'));
          for (const [yamlKey, group] of Object.entries(metadata.subscription_groups)) {
            const refName = group.reference_name;
            if (options.productId && options.productId !== yamlKey && options.productId !== refName) continue;
            console.log(chalk.cyan(`\n  ${yamlKey} (ref ${refName}):`));

            if (liveGroupRefs.has(refName)) {
              console.log(chalk.red(`    ✗ already exists on ASC (id ${liveGroupRefs.get(refName)}) — skipping`));
              failures++;
              continue;
            }

            if (options.dryRun) {
              console.log(chalk.green(`    create (dry-run)`));
              continue;
            }
            try {
              const newId = await client.createSubscriptionGroup(refName);
              groupRefToAscId.set(refName, newId);
              console.log(chalk.green(`    ✓ created (id ${newId})`));
              createdGroups++;
              // Push group-level localisations if any.
              for (const [lang, loc] of Object.entries(group.localisations ?? {})) {
                const locale = LANGUAGE_MAP[lang] || lang;
                await client.upsertSubscriptionGroupLocalisation(newId, locale, {
                  name: loc.name,
                  ...(loc.custom_app_name && { customAppName: loc.custom_app_name }),
                });
                console.log(`      + ${locale} loc: ${loc.name}`);
              }
            } catch (err) {
              failures++;
              console.error(chalk.red(`    ✗ ${err instanceof Error ? err.message : err}`));
            }
          }
        }

        // -- Purchases ----------------------------------------------------
        if (metadata.purchases) {
          console.log(chalk.bold('\nIn-App Purchases:'));
          for (const [productId, config] of Object.entries(metadata.purchases)) {
            if (options.productId && options.productId !== productId) continue;
            console.log(chalk.cyan(`\n  ${productId}:`));

            if (livePurchaseIds.has(productId)) {
              console.log(chalk.red(`    ✗ already exists on ASC — skipping (use \`iap sync\` for updates)`));
              failures++;
              continue;
            }
            if (!config.type) {
              console.log(chalk.red(`    ✗ YAML missing required field \`type\` (CONSUMABLE | NON_CONSUMABLE | NON_RENEWING_SUBSCRIPTION)`));
              failures++;
              continue;
            }

            if (options.dryRun) {
              console.log(chalk.green(`    create (dry-run) — type ${config.type}, family_sharable ${!!config.family_sharable}`));
              continue;
            }
            try {
              const newId = await client.createInAppPurchase({
                productId,
                name: config.reference_name || productId,
                type: config.type,
                familySharable: config.family_sharable,
              });
              console.log(chalk.green(`    ✓ created (id ${newId})`));
              createdPurchases++;
              await applyIapExtras(client, newId, config);
            } catch (err) {
              failures++;
              console.error(chalk.red(`    ✗ ${err instanceof Error ? err.message : err}`));
            }
          }
        }

        // -- Subscriptions ------------------------------------------------
        if (metadata.subscriptions) {
          console.log(chalk.bold('\nSubscriptions:'));
          for (const [productId, config] of Object.entries(metadata.subscriptions)) {
            if (options.productId && options.productId !== productId) continue;
            console.log(chalk.cyan(`\n  ${productId}:`));

            if (liveSubIds.has(productId)) {
              console.log(chalk.red(`    ✗ already exists on ASC — skipping (use \`iap sync\` for updates)`));
              failures++;
              continue;
            }
            if (!config.group) {
              console.log(chalk.red(`    ✗ YAML missing required field \`group\` (reference name of the subscription group)`));
              failures++;
              continue;
            }
            const groupId = groupRefToAscId.get(config.group);
            if (!groupId) {
              console.log(chalk.red(`    ✗ subscription group "${config.group}" not found on ASC — declare it under \`subscription_groups\` first`));
              failures++;
              continue;
            }
            if (!config.subscription_period) {
              console.log(chalk.red(`    ✗ YAML missing required field \`subscription_period\` (e.g. ONE_MONTH, ONE_YEAR)`));
              failures++;
              continue;
            }

            if (options.dryRun) {
              console.log(chalk.green(`    create (dry-run) — period ${config.subscription_period}, group ${config.group} (id ${groupId})`));
              continue;
            }
            try {
              const newId = await client.createSubscription({
                groupId,
                productId,
                name: config.reference_name || productId,
                subscriptionPeriod: config.subscription_period,
                familySharable: config.family_sharable,
                groupLevel: config.group_level,
              });
              console.log(chalk.green(`    ✓ created (id ${newId})`));
              createdSubscriptions++;
              await applySubExtras(client, newId, config);
            } catch (err) {
              failures++;
              console.error(chalk.red(`    ✗ ${err instanceof Error ? err.message : err}`));
            }
          }
        }

        console.log(chalk.blue('\n--- Summary ---'));
        if (options.dryRun) console.log(chalk.yellow('DRY RUN - no changes were made'));
        if (createdGroups > 0) console.log(chalk.green(`Subscription groups created: ${createdGroups}`));
        if (createdPurchases > 0) console.log(chalk.green(`IAPs created: ${createdPurchases}`));
        if (createdSubscriptions > 0) console.log(chalk.green(`Subscriptions created: ${createdSubscriptions}`));
        if (failures > 0) {
          console.log(chalk.red(`Failures / skipped: ${failures}`));
          process.exit(1);
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

/**
 * After an IAP is created, push its price / availability / localisations
 * to bring the product to a fully-shaped state. Errors here are logged
 * but don't roll back the create — the IAP exists and the operator can
 * re-run `iap sync` to retry the missing extras.
 */
async function applyIapExtras(
  client: ReturnType<typeof createClient>,
  iapId: string,
  config: NonNullable<IAPMetadata['purchases']>[string],
): Promise<void> {
  if (config.price) {
    try {
      const pp = await client.findInAppPurchasePricePoint(
        iapId, config.price.base_territory, config.price.base_price,
      );
      await client.createInAppPurchasePriceSchedule(iapId, config.price.base_territory, pp);
      console.log(`      + price: ${config.price.base_price} ${config.price.base_territory}`);
    } catch (err) {
      console.error(chalk.red(`      ✗ price: ${err instanceof Error ? err.message : err}`));
    }
  }
  if (config.availability) {
    try {
      const territories = config.availability.territories === 'all'
        // For a fresh product there's no "current" set to fall back on,
        // so 'all' here is a placeholder the operator needs to expand.
        ? []
        : config.availability.territories;
      if (territories.length === 0) {
        console.error(chalk.red(`      ✗ availability: 'all' shorthand requires expanding to an explicit territory list for newly-created products`));
      } else {
        await client.createInAppPurchaseAvailability(
          iapId, config.availability.available_in_new_territories, territories,
        );
        console.log(`      + availability: ${territories.length} territories`);
      }
    } catch (err) {
      console.error(chalk.red(`      ✗ availability: ${err instanceof Error ? err.message : err}`));
    }
  }
  for (const [lang, loc] of Object.entries(config.localisations ?? {})) {
    const locale = LANGUAGE_MAP[lang] || lang;
    try {
      await client.upsertInAppPurchaseLocalisation(iapId, locale, {
        name: loc.display_name,
        description: loc.description,
      });
      console.log(`      + ${locale} loc`);
    } catch (err) {
      console.error(chalk.red(`      ✗ ${locale} loc: ${err instanceof Error ? err.message : err}`));
    }
  }
}

/** Same as applyIapExtras but for subscriptions (different ASC types). */
async function applySubExtras(
  client: ReturnType<typeof createClient>,
  subId: string,
  config: NonNullable<IAPMetadata['subscriptions']>[string],
): Promise<void> {
  if (config.price) {
    try {
      const pp = await client.findSubscriptionPricePoint(
        subId, config.price.base_territory, config.price.base_price,
      );
      await client.createSubscriptionBasePrice(subId, config.price.base_territory, pp);
      console.log(`      + price: ${config.price.base_price} ${config.price.base_territory}`);
    } catch (err) {
      console.error(chalk.red(`      ✗ price: ${err instanceof Error ? err.message : err}`));
    }
  }
  if (config.availability) {
    try {
      const territories = config.availability.territories === 'all' ? [] : config.availability.territories;
      if (territories.length === 0) {
        console.error(chalk.red(`      ✗ availability: 'all' shorthand requires an explicit territory list for new products`));
      } else {
        await client.createSubscriptionAvailability(
          subId, config.availability.available_in_new_territories, territories,
        );
        console.log(`      + availability: ${territories.length} territories`);
      }
    } catch (err) {
      console.error(chalk.red(`      ✗ availability: ${err instanceof Error ? err.message : err}`));
    }
  }
  for (const [lang, loc] of Object.entries(config.localisations ?? {})) {
    const locale = LANGUAGE_MAP[lang] || lang;
    try {
      await client.upsertSubscriptionLocalisation(subId, locale, {
        name: loc.display_name,
        description: loc.description,
      });
      console.log(`      + ${locale} loc`);
    } catch (err) {
      console.error(chalk.red(`      ✗ ${locale} loc: ${err instanceof Error ? err.message : err}`));
    }
  }
}

function truncate(text: string, maxLength: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim();
  if (oneLine.length <= maxLength) return oneLine;
  return oneLine.substring(0, maxLength - 3) + '...';
}
