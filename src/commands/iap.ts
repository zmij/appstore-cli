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
    .option(
      '--fix',
      'Auto-heal review_screenshot files that fail local validation ' +
        '(resize to nearest accepted dim, flatten alpha, convert to ' +
        'sRGB + 72 dpi). Modifies the source file in place.',
    )
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const { readFileSync, existsSync } = await import('fs');
        const { parse: parseYaml } = await import('yaml');
        const { getIapYamlPath } = await import('../paths.js');

        const iapPath = getIapYamlPath();

        if (!existsSync(iapPath)) {
          console.error(chalk.red(`IAP metadata file not found: ${iapPath}`));
          console.log('Expected YAML at the configured metadata_dir (default `l10n/metadata/apple/iap.yaml`).');
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
        let reviewScreenshotCount = 0;
        let reviewNoteCount = 0;

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

            // Review screenshot — Apple allows one per product, so the
            // sync deletes any existing one and uploads the local file.
            // No diff (we'd need a checksum the API doesn't expose);
            // re-runs always re-upload. Cheap enough — files are small.
            if (config.review_screenshot) {
              const liveShot = await client.getInAppPurchaseReviewScreenshot(existingPurchase.id);
              console.log(`    review_screenshot ${liveShot ? chalk.yellow('replace') : chalk.green('upload')}: ${config.review_screenshot}`);
              if (!options.dryRun) {
                try {
                  if (liveShot?.id) await client.deleteInAppPurchaseReviewScreenshot(liveShot.id);
                  await uploadReviewScreenshotBytes(
                    client, 'purchase', existingPurchase.id, config.review_screenshot,
                    { fix: !!options.fix },
                  );
                  reviewScreenshotCount++;
                } catch (err) {
                  errorCount++;
                  console.error(chalk.red(`      ✗ ${err instanceof Error ? err.message : err}`));
                }
              }
            }

            // Review note — short free-text instruction for Apple Review.
            // Diffed against the live attribute; pushed via PATCH when
            // they differ. Treats empty-string YAML as "clear the note"
            // (Apple stores it as null), so YAML→ASC is fully round-trip.
            if (config.review_note !== undefined) {
              const liveNote = (existingPurchase as any).attributes?.reviewNote ?? '';
              const desiredNote = config.review_note;
              if (liveNote === desiredNote) {
                console.log(chalk.gray(`    review_note unchanged`));
              } else {
                const verb = liveNote ? chalk.yellow('update') : chalk.green('set');
                console.log(`    review_note ${verb}: ${truncate(desiredNote, 60)}`);
                if (!options.dryRun) {
                  try {
                    await client.updateInAppPurchase({
                      iapId: existingPurchase.id,
                      reviewNote: desiredNote,
                    });
                    reviewNoteCount++;
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

            // Review screenshot (subscription side).
            if (config.review_screenshot) {
              const liveShot = await client.getSubscriptionReviewScreenshot(existingSubscription.id);
              console.log(`    review_screenshot ${liveShot ? chalk.yellow('replace') : chalk.green('upload')}: ${config.review_screenshot}`);
              if (!options.dryRun) {
                try {
                  if (liveShot?.id) await client.deleteSubscriptionReviewScreenshot(liveShot.id);
                  await uploadReviewScreenshotBytes(
                    client, 'subscription', existingSubscription.id, config.review_screenshot,
                    { fix: !!options.fix },
                  );
                  reviewScreenshotCount++;
                } catch (err) {
                  errorCount++;
                  console.error(chalk.red(`      ✗ ${err instanceof Error ? err.message : err}`));
                }
              }
            }

            // Review note (subscription side) — mirrors the IAP branch.
            if (config.review_note !== undefined) {
              const liveNote = (existingSubscription as any).attributes?.reviewNote ?? '';
              const desiredNote = config.review_note;
              if (liveNote === desiredNote) {
                console.log(chalk.gray(`    review_note unchanged`));
              } else {
                const verb = liveNote ? chalk.yellow('update') : chalk.green('set');
                console.log(`    review_note ${verb}: ${truncate(desiredNote, 60)}`);
                if (!options.dryRun) {
                  try {
                    await client.updateSubscription({
                      subId: existingSubscription.id,
                      reviewNote: desiredNote,
                    });
                    reviewNoteCount++;
                  } catch (err) {
                    errorCount++;
                    console.error(chalk.red(`      ✗ ${err instanceof Error ? err.message : err}`));
                  }
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
        if (reviewScreenshotCount > 0) console.log(chalk.green(`Review screenshots uploaded: ${reviewScreenshotCount}`));
        if (reviewNoteCount > 0) console.log(chalk.green(`Review notes updated: ${reviewNoteCount}`));
        if (errorCount > 0) console.log(chalk.red(`  errors: ${errorCount}`));
        if (errorCount > 0) process.exit(1);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Export current IAP metadata to YAML (round-trips localisations).
  // OVERWRITE semantics — for surgical updates use `iap pull` instead.
  iapCmd
    .command('export')
    .description('Export the live ASC catalogue to a YAML file (OVERWRITES the target — use `iap pull` for additive merge)')
    .requiredOption('--output <file>', 'Output YAML file path')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const { writeFileSync } = await import('fs');
        const { stringify } = await import('yaml');

        const client = createClient(options.keyId);
        console.log(chalk.blue('Exporting IAP metadata...\n'));

        const metadata = await fetchLiveIapState(client, true /* log progress */);
        writeFileSync(options.output, stringify(metadata));
        console.log(chalk.green(`\n✓ Exported to: ${options.output}`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Surgical merge: pull live ASC state into the committed YAML,
  // preserving comments + key order + local-only fields. The opposite
  // direction of `iap sync` — call when you've changed something on ASC
  // by hand (or someone else has) and want the YAML to catch up without
  // losing your local edits.
  iapCmd
    .command('pull')
    .description('Pull live ASC state into the committed YAML — additive merge, preserves comments + local-only fields')
    .option('--product-id <productId>', 'Pull a single product / group only')
    .option('--dry-run', 'Show what would be added/updated without writing')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const { readFileSync, writeFileSync, existsSync } = await import('fs');
        const { parseDocument } = await import('yaml');
        const { getIapYamlPath } = await import('../paths.js');

        const iapPath = getIapYamlPath();
        if (!existsSync(iapPath)) {
          console.error(chalk.red(`IAP metadata file not found: ${iapPath}`));
          console.error(chalk.yellow(`First-time setup? Run \`appstore iap export --output ${iapPath}\` to seed it.`));
          process.exit(1);
        }

        const client = createClient(options.keyId);
        console.log(chalk.blue('Pulling live ASC state...'));
        const live = await fetchLiveIapState(client, false);

        const doc = parseDocument(readFileSync(iapPath, 'utf-8'));
        const summary = mergeLiveIntoDocument(doc, live, options.productId, options.dryRun ?? false);

        if (!options.dryRun) {
          writeFileSync(iapPath, String(doc));
          console.log(chalk.green(`\n✓ Merged into ${iapPath}`));
        } else {
          console.log(chalk.yellow('\nDRY RUN — no file written.'));
        }
        console.log(`Products added: ${summary.added}`);
        console.log(`Products updated (gap-filled): ${summary.updated}`);
        console.log(`Locale slots filled: ${summary.localesAdded}`);
        console.log(chalk.gray('(existing YAML values are never overwritten; use `iap export` for a full overwrite.)'));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Show YAML ↔ live ASC divergence per product. No writes; pure
  // diagnostic — useful as a pre-flight before `iap sync` or `iap pull`.
  iapCmd
    .command('diff')
    .description('Show per-product divergence between the committed YAML and live ASC (read-only)')
    .option('--product-id <productId>', 'Diff a single product only')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const { readFileSync, existsSync } = await import('fs');
        const { parse: parseYaml } = await import('yaml');
        const { getIapYamlPath } = await import('../paths.js');

        const iapPath = getIapYamlPath();
        if (!existsSync(iapPath)) {
          console.error(chalk.red(`IAP metadata file not found: ${iapPath}`));
          process.exit(1);
        }

        const yamlState = parseYaml(readFileSync(iapPath, 'utf-8')) as IAPMetadata;
        const client = createClient(options.keyId);
        console.log(chalk.blue('Diffing YAML vs live ASC...\n'));
        const live = await fetchLiveIapState(client, false);

        diffIapMetadata(yamlState, live, options.productId);
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
        // Hold the matched product object so downstream blocks (review_note,
        // future fields) can read its attributes without re-walking the list.
        let productMatch: any = null;

        if (purchaseMatch) {
          kind = 'purchase';
          productAscId = purchaseMatch.id;
          referenceName = purchaseMatch.attributes?.referenceName ?? '';
          productMatch = purchaseMatch;
        } else {
          const groups = await client.listSubscriptions();
          for (const group of groups) {
            const subs = await client.listSubscriptionsInGroup(group.id);
            const match = subs.find((s: any) => s.attributes?.productId === productId);
            if (match) {
              kind = 'subscription';
              productAscId = match.id;
              referenceName = match.attributes?.name ?? '';
              productMatch = match;
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

        // Review screenshot — both flavours, one per product.
        const reviewScreenshot = kind === 'purchase'
          ? await client.getInAppPurchaseReviewScreenshot(productAscId)
          : await client.getSubscriptionReviewScreenshot(productAscId);
        if (reviewScreenshot) {
          const name = reviewScreenshot.attributes?.fileName ?? '(unnamed)';
          const size = reviewScreenshot.attributes?.fileSize ?? 0;
          const deliveryState = reviewScreenshot.attributes?.assetDeliveryState;
          const rawState = deliveryState?.state ?? 'UPLOADED';
          // Colour the state by outcome so a FAILED asset jumps out —
          // pre-#2456 the same word was uncoloured next to a successful
          // file size, so operators routinely missed it.
          const stateLabel =
            rawState === 'COMPLETE' ? chalk.green(rawState)
            : rawState === 'FAILED' ? chalk.red(rawState)
            : chalk.yellow(rawState);
          console.log(chalk.bold('\n  Review screenshot:'));
          console.log(`    file: ${name} (${(size / 1024).toFixed(1)} KiB) — ${stateLabel}`);
          // Surface Apple's per-asset error / warning payload. The
          // shape is `errors: [{ code, description }]` — both fields
          // are strings, but `description` is sometimes just a code
          // alias (e.g. "IMAGE_INCORRECT_DIMENSIONS"). Print both.
          const errors = (deliveryState?.errors ?? []) as Array<{ code?: string; description?: string }>;
          for (const e of errors) {
            const tag = e.code ?? '(no-code)';
            const detail = e.description && e.description !== e.code ? `: ${e.description}` : '';
            console.log(`      ${chalk.red('✗')} ${tag}${detail}`);
          }
          const warnings = (deliveryState?.warnings ?? []) as Array<{ code?: string; description?: string }>;
          for (const w of warnings) {
            const tag = w.code ?? '(no-code)';
            const detail = w.description && w.description !== w.code ? `: ${w.description}` : '';
            console.log(`      ${chalk.yellow('⚠')} ${tag}${detail}`);
          }
        } else {
          console.log(chalk.gray('\n  Review screenshot: (none — required before submission)'));
        }

        // Review note — same shape on both product flavours; read off
        // the cached match. Apple stores empty as null.
        const reviewNote = productMatch?.attributes?.reviewNote;
        if (reviewNote) {
          console.log(chalk.bold('\n  Review note:'));
          console.log(`    ${reviewNote.replace(/\n/g, '\n    ')}`);
        } else {
          console.log(chalk.gray('\n  Review note: (none)'));
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
        const { parse: parseYaml } = await import('yaml');
        const { getIapYamlPath } = await import('../paths.js');

        const iapPath = getIapYamlPath();
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
                reviewNote: config.review_note,
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
                reviewNote: config.review_note,
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

  // ---- migrate-prices ---------------------------------------------------
  //
  // Apple parity with `playstore iap migrate-prices`. The mechanics
  // are quite different:
  //
  //   * Apple: subscriptionPrices are per-territory; each carries a
  //     `preserveCurrentPrice` flag. `iap sync` writes the anchor
  //     (USA) price with `preserveCurrentPrice = true` so new
  //     subscribers see the new price but existing cohorts keep
  //     theirs. This command re-broadcasts the SAME price point with
  //     `preserveCurrentPrice = false`, the Apple signal to migrate
  //     existing subscribers in that territory.
  //
  //   * Per-territory: the migration only affects the subscription's
  //     anchor territory by default (USA, matching the YAML's
  //     base_territory). Apple's auto-equalised tier system means
  //     other territories have independent schedules — they're NOT
  //     migrated by the anchor call. The CLI scope is deliberately
  //     anchor-only; if you want to migrate non-anchor territories
  //     too, run the command per territory.
  //
  //   * Apple picks the customer-facing policy from the price delta:
  //     decreases auto-apply at next billing; increases trigger
  //     Apple's standard customer notification + consent flow.
  //
  // Single-purpose by design (matches `playstore iap migrate-prices`)
  // — scope is ONE subscription per invocation. No --product-id=all
  // because price migrations have user impact and the operator
  // should be picking each plan deliberately.
  //
  // The command DOES NOT fire without `--confirm`. Dry-run is the
  // default to avoid accidental migrations from a typo.

  iapCmd
    .command('migrate-prices')
    .description('Migrate existing subscribers on a subscription to its current price (Apple anchor-territory)')
    .requiredOption('--product-id <productId>', 'Subscription product ID')
    .option('--territory <iso3>', 'ISO-3 territory to migrate (defaults to the subscription\'s anchor — usually USA)')
    .option('--confirm', 'Actually fire the call (required; defaults to dry-run)')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);
        const productId = options.productId as string;

        // Subscriptions are scoped per group on ASC. Walk groups to
        // find the one with our productId.
        const groups = await client.listSubscriptions();
        let foundSubId: string | undefined;
        let foundGroupId: string | undefined;
        for (const g of groups) {
          const subs = await client.listSubscriptionsInGroup(g.id);
          const match = subs.find((s: any) => s.attributes?.productId === productId);
          if (match) {
            foundSubId = match.id;
            foundGroupId = g.id;
            break;
          }
        }
        if (!foundSubId) {
          console.error(chalk.red(`Subscription not found on ASC: ${productId}`));
          process.exit(1);
        }

        // Pull the current "active for new" price summary. This is
        // the price we'll re-broadcast with preserveCurrentPrice=false.
        const priceSummary = await client.getSubscriptionPriceSummary(foundSubId);
        if (!priceSummary || !priceSummary.price_point_id) {
          console.error(chalk.red(`${productId} has no current price configured on ASC.`));
          process.exit(1);
        }

        // Default the territory to the subscription's anchor.
        const territoryId = (options.territory as string | undefined) ?? priceSummary.base_territory;
        if (!territoryId) {
          console.error(chalk.red('Could not resolve a territory — pass --territory <ISO3>.'));
          process.exit(1);
        }

        // If the caller asked for a non-anchor territory, the price
        // point id from the summary won't match — that's the anchor's
        // point id. We'd need to look up the territory-specific point.
        // For Phase 1 of migrate-prices, refuse non-anchor scopes with
        // a clear error rather than silently using the wrong point.
        if (territoryId !== priceSummary.base_territory) {
          console.error(chalk.red(`Non-anchor territory migration not supported yet — anchor is ${priceSummary.base_territory}, you asked for ${territoryId}.`));
          console.error(chalk.gray('Run without --territory to migrate the anchor, or open a follow-up issue for per-territory support.'));
          process.exit(1);
        }

        console.log(chalk.bold(`\nMigration plan:`));
        console.log(`  subscription:   ${chalk.cyan(productId)} (ASC id ${foundSubId})`);
        console.log(`  group:          ${foundGroupId}`);
        console.log(`  anchor:         ${territoryId}`);
        console.log(`  target price:   ${priceSummary.base_price} ${territoryId} (point id ${priceSummary.price_point_id})`);
        console.log(chalk.gray(`  semantics:      re-broadcasts the current price with preserveCurrentPrice=false`));
        console.log(chalk.gray(`                  → Apple migrates existing ${territoryId} subscribers at next billing`));
        console.log(chalk.gray(`                  → increases trigger Apple's customer-consent flow; decreases auto-apply`));

        if (!options.confirm) {
          console.log(chalk.yellow('\n[dry-run] no API call fired. Pass --confirm to actually migrate.'));
          return;
        }

        const newPriceId = await client.migrateSubscriptionBasePrice(foundSubId, territoryId, priceSummary.price_point_id);
        console.log(chalk.green(`\n✓ Migration triggered (new subscriptionPrice id: ${newPriceId}). Apple handles customer notification + billing-cycle transition.`));
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
/**
 * Pull every IAP / subscription group / subscription from ASC into the
 * same shape the YAML uses. Single source of truth used by `iap export`
 * (overwrite-the-file mode), `iap pull` (additive-merge mode), and
 * `iap diff` (read-only comparison).
 *
 * Set `logProgress` true to emit per-product "Exported …" lines
 * (matches the historical `iap export` UX); pull + diff pass false.
 */
async function fetchLiveIapState(
  client: ReturnType<typeof createClient>,
  logProgress: boolean,
): Promise<IAPMetadata> {
  const metadata: IAPMetadata = {
    subscription_groups: {},
    purchases: {},
    subscriptions: {},
  };

  // Reverse map: ASC locale ("en-US", "de-DE") → short YAML lang ("en",
  // "de"). Multiple short tags may share a long form; first wins.
  const reverseLocaleMap = new Map<string, string>();
  for (const [shortLang, longLocale] of Object.entries(LANGUAGE_MAP)) {
    if (!reverseLocaleMap.has(longLocale)) {
      reverseLocaleMap.set(longLocale, shortLang);
    }
  }
  const shortLang = (loc: string): string => reverseLocaleMap.get(loc) ?? loc;

  // -- Purchases ----------------------------------------------------
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
      reference_name: purchase.attributes?.name || productId,
      type: purchase.attributes?.inAppPurchaseType,
      family_sharable: purchase.attributes?.familySharable,
      ...(price && {
        price: { base_territory: price.base_territory, base_price: price.base_price },
      }),
      ...(availability && {
        availability: {
          available_in_new_territories: availability.available_in_new_territories,
          territories: availability.territories,
        },
      }),
      ...(purchase.attributes?.reviewNote && { review_note: purchase.attributes.reviewNote }),
      localisations: yamlLocs,
    };
    if (logProgress) {
      const priceLabel = price ? `${price.base_price} ${price.base_territory}` : 'no price';
      const availLabel = availability ? `${availability.territories.length} terr` : 'no avail';
      console.log(`  Exported purchase: ${productId} (${Object.keys(yamlLocs).length} locales, ${priceLabel}, ${availLabel})`);
    }
  }

  // -- Subscription groups → subscriptions --------------------------
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
          entry.price = `pricePoint:${off._price_point_id}`;
        }
        yamlIntroOffers.push(entry);
      }

      metadata.subscriptions[productId] = {
        reference_name: sub.attributes?.name || productId,
        group: groupRefName,
        subscription_period: sub.attributes?.subscriptionPeriod,
        family_sharable: sub.attributes?.familySharable,
        ...(sub.attributes?.groupLevel !== undefined && { group_level: sub.attributes.groupLevel }),
        ...(price && {
          price: { base_territory: price.base_territory, base_price: price.base_price },
        }),
        ...(availability && {
          availability: {
            available_in_new_territories: availability.available_in_new_territories,
            territories: availability.territories,
          },
        }),
        ...(yamlIntroOffers.length > 0 && { intro_offers: yamlIntroOffers }),
        ...(sub.attributes?.reviewNote && { review_note: sub.attributes.reviewNote }),
        localisations: yamlLocs,
      };
      if (logProgress) {
        const priceLabel = price ? `${price.base_price} ${price.base_territory}` : 'no price';
        const availLabel = availability ? `${availability.territories.length} terr` : 'no avail';
        const offerLabel = yamlIntroOffers.length > 0 ? `, ${yamlIntroOffers.length} intro` : '';
        console.log(
          `  Exported subscription: ${productId} (group ${groupRefName}, ${Object.keys(yamlLocs).length} locales, ${priceLabel}, ${availLabel}${offerLabel})`,
        );
      }
    }
  }

  return metadata;
}

/**
 * Merge live ASC state into a yaml Document AST, preserving comments,
 * key order, and any local-only fields. Strict additive semantics:
 *
 *   - A product/group present in `live` but missing from YAML is added.
 *   - A product/group present in both has its MISSING fields filled
 *     in from live; existing fields are left untouched.
 *   - Locales present in live but missing from a product's YAML
 *     localisations are added.
 *
 * Never deletes or overwrites — that's `iap export`'s job. Returns a
 * tally of what changed so the caller can report (or detect no-op).
 */
function mergeLiveIntoDocument(
  doc: any,                // yaml.Document
  live: IAPMetadata,
  scopedProductId: string | undefined,
  dryRun: boolean,
): { added: number; updated: number; localesAdded: number } {
  let added = 0;
  let updated = 0;
  let localesAdded = 0;

  const matchesScope = (id: string) => !scopedProductId || scopedProductId === id;

  // yaml v2: doc.get(key) returns the JS value; doc.get(key, true) returns
  // the YAMLMap node we need to call .has()/.set()/.get() on. Always pass
  // `true` here so we operate on nodes, not value snapshots.
  for (const top of ['subscription_groups', 'purchases', 'subscriptions']) {
    if (!doc.has(top)) doc.set(top, doc.createNode({}));
  }

  // -- Subscription groups -----------------------------------------
  const groupsNode = doc.get('subscription_groups', true);
  for (const [groupKey, groupLive] of Object.entries(live.subscription_groups ?? {})) {
    if (!matchesScope(groupKey)) continue;
    if (!groupsNode.has(groupKey)) {
      console.log(chalk.green(`+ subscription_group: ${groupKey}`));
      if (!dryRun) groupsNode.set(groupKey, doc.createNode(groupLive));
      added++;
    } else {
      // Fill localisation gaps only.
      const liveLocs = groupLive.localisations ?? {};
      const yamlGroup = groupsNode.get(groupKey, true);
      let yamlLocs = yamlGroup.get('localisations', true);
      for (const [lang, loc] of Object.entries(liveLocs)) {
        if (!yamlLocs) {
          console.log(chalk.green(`+ subscription_group/${groupKey}/localisations`));
          if (!dryRun) {
            yamlGroup.set('localisations', doc.createNode({ [lang]: loc }));
            yamlLocs = yamlGroup.get('localisations', true);
          }
          localesAdded++;
          updated++;
          continue;
        }
        if (!yamlLocs.has(lang)) {
          console.log(chalk.green(`+ subscription_group/${groupKey}/localisations/${lang}`));
          if (!dryRun) yamlLocs.set(lang, doc.createNode(loc));
          localesAdded++;
        }
      }
    }
  }

  // -- Purchases ----------------------------------------------------
  const purchasesNode = doc.get('purchases', true);
  for (const [productId, livePurchase] of Object.entries(live.purchases)) {
    if (!matchesScope(productId)) continue;
    if (!purchasesNode.has(productId)) {
      console.log(chalk.green(`+ purchase: ${productId}`));
      if (!dryRun) purchasesNode.set(productId, doc.createNode(livePurchase));
      added++;
    } else {
      const yamlEntry = purchasesNode.get(productId, true);
      const before = { added, localesAdded };
      mergeYamlEntryFields(doc, yamlEntry, livePurchase, ['type', 'family_sharable', 'price', 'availability', 'review_note'], dryRun, `purchases/${productId}`);
      mergeYamlLocalisations(doc, yamlEntry, livePurchase.localisations, dryRun, `purchases/${productId}`, (n) => { localesAdded += n; });
      if (added !== before.added || localesAdded !== before.localesAdded) updated++;
    }
  }

  // -- Subscriptions ------------------------------------------------
  const subsNode = doc.get('subscriptions', true);
  for (const [productId, liveSub] of Object.entries(live.subscriptions)) {
    if (!matchesScope(productId)) continue;
    if (!subsNode.has(productId)) {
      console.log(chalk.green(`+ subscription: ${productId}`));
      if (!dryRun) subsNode.set(productId, doc.createNode(liveSub));
      added++;
    } else {
      const yamlEntry = subsNode.get(productId, true);
      const before = { added, localesAdded };
      mergeYamlEntryFields(
        doc, yamlEntry, liveSub,
        ['group', 'subscription_period', 'family_sharable', 'group_level', 'price', 'availability', 'intro_offers', 'review_note'],
        dryRun, `subscriptions/${productId}`,
      );
      mergeYamlLocalisations(doc, yamlEntry, liveSub.localisations, dryRun, `subscriptions/${productId}`, (n) => { localesAdded += n; });
      if (added !== before.added || localesAdded !== before.localesAdded) updated++;
    }
  }

  return { added, updated, localesAdded };
}

/** Fill missing top-level fields on a yaml Map node from a live entry. */
function mergeYamlEntryFields(
  doc: any,                 // yaml.Document — needed for createNode
  yamlEntry: any,           // yaml.YAMLMap
  liveEntry: Record<string, any>,
  fields: string[],
  dryRun: boolean,
  pathLabel: string,
): void {
  for (const field of fields) {
    const liveVal = (liveEntry as any)[field];
    if (liveVal === undefined) continue;
    if (yamlEntry.has(field)) continue;
    console.log(chalk.green(`+ ${pathLabel}/${field}`));
    if (!dryRun) yamlEntry.set(field, doc.createNode(liveVal));
  }
}

/** Union a live localisations map into a yaml entry — additive only. */
function mergeYamlLocalisations(
  doc: any,
  yamlEntry: any,
  liveLocs: Record<string, any> | undefined,
  dryRun: boolean,
  pathLabel: string,
  onAdded: (count: number) => void,
): void {
  if (!liveLocs) return;
  let yamlLocs = yamlEntry.get('localisations', true);
  for (const [lang, loc] of Object.entries(liveLocs)) {
    if (!yamlLocs) {
      console.log(chalk.green(`+ ${pathLabel}/localisations`));
      if (!dryRun) {
        yamlEntry.set('localisations', doc.createNode({ [lang]: loc }));
        yamlLocs = yamlEntry.get('localisations', true);
      }
      onAdded(1);
      continue;
    }
    if (!yamlLocs.has(lang)) {
      console.log(chalk.green(`+ ${pathLabel}/localisations/${lang}`));
      if (!dryRun) yamlLocs.set(lang, doc.createNode(loc));
      onAdded(1);
    }
  }
}

/**
 * Print per-product divergence between the committed YAML and live ASC.
 * Read-only; used as a pre-flight before sync (push) or pull (merge).
 *
 * Recursive walker — finds leaf-level mismatches (`localisations/en-GB/
 * description`, `price/base_price`, `intro_offers/FREE_TRIAL+ONE_WEEK+...`,
 * `availability/territories[added]/CHN`) so a single typo in a long
 * territory list doesn't produce a 200-character JSON-blob row.
 *
 * Categories:
 *   `local-only` — in YAML, missing from ASC (sync would create)
 *   `live-only`  — on ASC, missing from YAML (pull would add)
 *   `mismatch`   — present in both with different values
 */

/**
 * Path-segment → id-field lookup for array elements. Unknown arrays
 * fall back to a positional walk (no Apple arrays use that path
 * today; territories[] short-circuits to set-diff, intro_offers[]
 * uses the tuple key below).
 */
const APPLE_ARRAY_ID_FIELDS: Record<string, string> = {
  // No array-of-objects in Apple's schema needs id matching beyond
  // intro_offers (which is keyed by tuple, see introOfferKey).
};

/** intro_offers items are uniquely identified by (mode, duration,
 *  periods, territory). `territory` is optional — global offers have
 *  it undefined; we collapse to '__global' for keying. */
function introOfferKey(o: any): string {
  if (!o || typeof o !== 'object') return '';
  return [
    o.mode ?? '?',
    o.duration ?? '?',
    o.periods ?? '?',
    o.territory ?? '__global',
  ].join('+');
}

type DiffCategory = 'local-only' | 'live-only' | 'mismatch';
interface AppleDiffRow {
  category: DiffCategory;
  path: string;
  yaml?: any;
  live?: any;
}

function formatScalarForDiff(v: any): string {
  if (v === undefined) return chalk.gray('(missing)');
  if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
  return String(v);
}

function deepDiff(yamlVal: any, liveVal: any, path: string, segName: string, out: AppleDiffRow[]): void {
  // Treat null and undefined as the same "missing" — the wire omits
  // null fields; YAML may carry either.
  const yMissing = yamlVal === undefined || yamlVal === null;
  const lMissing = liveVal === undefined || liveVal === null;
  if (yMissing && lMissing) return;
  if (yMissing) {
    out.push({ category: 'live-only', path, live: liveVal });
    return;
  }
  if (lMissing) {
    out.push({ category: 'local-only', path, yaml: yamlVal });
    return;
  }

  const yArr = Array.isArray(yamlVal);
  const lArr = Array.isArray(liveVal);
  if (yArr !== lArr) {
    out.push({ category: 'mismatch', path, yaml: yamlVal, live: liveVal });
    return;
  }

  if (yArr && lArr) {
    // Special case: territories[] is a primitive string list of ~170
    // entries — set-based diff is the only useful output.
    if (segName === 'territories') {
      const ySet = new Set(yamlVal as string[]);
      const lSet = new Set(liveVal as string[]);
      const added = [...lSet].filter((t) => !ySet.has(t)).sort();
      const removed = [...ySet].filter((t) => !lSet.has(t)).sort();
      for (const t of added) out.push({ category: 'live-only', path: `${path}/${t}` });
      for (const t of removed) out.push({ category: 'local-only', path: `${path}/${t}` });
      return;
    }
    // intro_offers[] — match by composite tuple key, recurse per match.
    if (segName === 'intro_offers') {
      const yMap = new Map<string, any>();
      const lMap = new Map<string, any>();
      for (const it of yamlVal as any[]) yMap.set(introOfferKey(it), it);
      for (const it of liveVal as any[]) lMap.set(introOfferKey(it), it);
      const keys = new Set([...yMap.keys(), ...lMap.keys()]);
      for (const k of [...keys].sort()) {
        deepDiff(yMap.get(k), lMap.get(k), `${path}/${k}`, 'intro_offer', out);
      }
      return;
    }
    // Generic array path: id-matched if we know the field, else positional.
    const idField = APPLE_ARRAY_ID_FIELDS[segName];
    if (idField) {
      const yMap = new Map<string, any>();
      const lMap = new Map<string, any>();
      for (const item of yamlVal as any[]) {
        const k = item?.[idField];
        if (k != null) yMap.set(String(k), item);
      }
      for (const item of liveVal as any[]) {
        const k = item?.[idField];
        if (k != null) lMap.set(String(k), item);
      }
      const ids = new Set([...yMap.keys(), ...lMap.keys()]);
      for (const id of [...ids].sort()) {
        deepDiff(yMap.get(id), lMap.get(id), `${path}/${id}`, idField, out);
      }
    } else {
      const max = Math.max(yamlVal.length, liveVal.length);
      for (let i = 0; i < max; i++) {
        deepDiff(yamlVal[i], liveVal[i], `${path}[${i}]`, `${segName}[]`, out);
      }
    }
    return;
  }

  const yObj = typeof yamlVal === 'object';
  const lObj = typeof liveVal === 'object';
  if (yObj !== lObj) {
    out.push({ category: 'mismatch', path, yaml: yamlVal, live: liveVal });
    return;
  }
  if (yObj && lObj) {
    const keys = new Set([...Object.keys(yamlVal), ...Object.keys(liveVal)]);
    for (const k of [...keys].sort()) {
      deepDiff(yamlVal[k], liveVal[k], `${path}/${k}`, k, out);
    }
    return;
  }

  if (yamlVal !== liveVal) {
    out.push({ category: 'mismatch', path, yaml: yamlVal, live: liveVal });
  }
}

function diffIapMetadata(
  yamlState: IAPMetadata,
  live: IAPMetadata,
  scopedProductId?: string,
): void {
  const matchesScope = (id: string) => !scopedProductId || scopedProductId === id;
  const rows: AppleDiffRow[] = [];

  // Subscription groups (Apple-only; no Play equivalent).
  const yamlGroups = yamlState.subscription_groups ?? {};
  const liveGroups = live.subscription_groups ?? {};
  const groupIds = new Set([...Object.keys(yamlGroups), ...Object.keys(liveGroups)]);
  for (const id of groupIds) {
    if (!matchesScope(id)) continue;
    deepDiff(yamlGroups[id], liveGroups[id], `subscription_groups/${id}`, 'group', rows);
  }

  const yamlPurchases = yamlState.purchases ?? {};
  const livePurchases = live.purchases ?? {};
  const purchaseIds = new Set([...Object.keys(yamlPurchases), ...Object.keys(livePurchases)]);
  for (const id of purchaseIds) {
    if (!matchesScope(id)) continue;
    deepDiff(yamlPurchases[id], livePurchases[id], `purchases/${id}`, 'purchase', rows);
  }

  const yamlSubs = yamlState.subscriptions ?? {};
  const liveSubs = live.subscriptions ?? {};
  const subIds = new Set([...Object.keys(yamlSubs), ...Object.keys(liveSubs)]);
  for (const id of subIds) {
    if (!matchesScope(id)) continue;
    deepDiff(yamlSubs[id], liveSubs[id], `subscriptions/${id}`, 'subscription', rows);
  }

  if (rows.length === 0) {
    console.log(chalk.green('No divergence detected — YAML and live ASC match.'));
    return;
  }

  rows.sort((a, b) => a.path.localeCompare(b.path));
  for (const row of rows) {
    const colour = row.category === 'local-only' ? chalk.cyan
      : row.category === 'live-only' ? chalk.green
        : chalk.yellow;
    if (row.category === 'mismatch') {
      console.log(`  ${colour(row.category.padEnd(11))} ${row.path}`);
      console.log(`              ${chalk.gray('yaml:')} ${formatScalarForDiff(row.yaml)}`);
      console.log(`              ${chalk.gray('live:')} ${formatScalarForDiff(row.live)}`);
    } else {
      console.log(`  ${colour(row.category.padEnd(11))} ${row.path}`);
    }
  }
  console.log(chalk.bold(`\n${rows.length} divergence(s).`));
  console.log(chalk.gray(`  • local-only → run \`iap sync\` (or \`iap create\` if the whole entry is new) to push it`));
  console.log(chalk.gray(`  • live-only  → run \`iap pull\` to absorb it`));
  console.log(chalk.gray(`  • mismatch   → decide manually: \`iap sync\` overwrites live, \`iap pull\` does not overwrite local`));
}

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

/**
 * Push a local image file as the review screenshot for one IAP or
 * subscription. Mirrors the reserve → PUT chunks → commit pattern used
 * by the app-listings screenshot flow. When a screenshot already
 * exists the caller deletes it first — Apple allows only one per
 * product.
 *
 * `kind` chooses which of the two ASC types we're working against;
 * the body of the upload (presigned URLs + chunking + MD5 commit) is
 * identical otherwise.
 */
async function uploadReviewScreenshotBytes(
  client: ReturnType<typeof createClient>,
  kind: 'purchase' | 'subscription',
  productAscId: string,
  filePath: string,
  options: { fix?: boolean } = {},
): Promise<void> {
  const { readFileSync, statSync, existsSync } = await import('fs');
  const { createHash } = await import('crypto');
  const { basename } = await import('path');
  const {
    validateIapReviewScreenshot,
    formatValidationFailures,
    healIapReviewScreenshot,
  } = await import('../imageValidation.js');

  if (!existsSync(filePath)) {
    throw new Error(`review_screenshot file not found: ${filePath}`);
  }

  // Pre-upload validation. Apple's post-process silently flips
  // mismatched assets to FAILED hours after the commit; surface every
  // failed rule at once and (if --fix is set) auto-heal the file in
  // place via the proven sharp recipe before re-validating.
  let validation = await validateIapReviewScreenshot(filePath);
  if (!validation.valid && options.fix) {
    console.log(chalk.yellow(`      ⚠ validation failed; healing in place:`));
    console.log(formatValidationFailures(validation.failures));
    const { before, after, upscaled } = await healIapReviewScreenshot(filePath);
    const upscaleNote = upscaled ? chalk.yellow(' (upscaled — quality loss possible)') : '';
    console.log(
      chalk.cyan(
        `      ↻ healed: ${before.width}×${before.height} → ${after.width}×${after.height}, ` +
          `alpha ${before.hasAlpha ? 'YES' : 'no'} → ${after.hasAlpha ? 'YES' : 'no'}, ` +
          `density ${before.density ?? '?'} → ${after.density ?? '?'} dpi` +
          upscaleNote,
      ),
    );
    validation = await validateIapReviewScreenshot(filePath);
  }
  if (!validation.valid) {
    const lines = formatValidationFailures(validation.failures);
    throw new Error(
      `review_screenshot rejected by local validator ` +
        `(would FAIL silently on ASC):\n` +
        `${lines}\n` +
        `      Re-run with --fix to auto-heal, or normalise manually with the ` +
        `magick recipe in docs/iap-screenshots.md.`,
    );
  }
  const bytes = readFileSync(filePath);
  const size = statSync(filePath).size;
  const md5 = createHash('md5').update(bytes).digest('hex');
  const name = basename(filePath);

  const reservation = kind === 'purchase'
    ? await client.reserveInAppPurchaseReviewScreenshot(productAscId, name, size)
    : await client.reserveSubscriptionReviewScreenshot(productAscId, name, size);

  // PUT bytes to each presigned operation. ASC may chunk large files,
  // though review screenshots tend to be small enough to land in one.
  for (const op of reservation.uploadOperations) {
    const chunk = bytes.slice(op.offset, op.offset + op.length);
    const headers: Record<string, string> = {};
    for (const h of (op.requestHeaders ?? [])) headers[h.name] = h.value;
    const res = await fetch(op.url, { method: op.method, headers, body: chunk });
    if (!res.ok) {
      throw new Error(`review-screenshot chunk upload failed: ${res.status} ${res.statusText}`);
    }
  }

  if (kind === 'purchase') {
    await client.commitInAppPurchaseReviewScreenshot(reservation.id, md5);
  } else {
    await client.commitSubscriptionReviewScreenshot(reservation.id, md5);
  }
}

function truncate(text: string, maxLength: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim();
  if (oneLine.length <= maxLength) return oneLine;
  return oneLine.substring(0, maxLength - 3) + '...';
}
