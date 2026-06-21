/**
 * Screenshots Commands
 *
 * Commands for managing App Store screenshots - upload, delete, reorder.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';
import { LANGUAGE_MAP, LOCALE_EXPAND, DEVICE_TYPE_MAP } from '../types.js';
import type { ParsedScreenshotFilename, ScreenshotUploadMode } from '../types.js';

export function registerScreenshotsCommands(program: Command): void {
  const screenshotsCmd = program
    .command('screenshots')
    .description('Manage app store screenshots');

  // Summary of all screenshots
  screenshotsCmd
    .command('summary')
    .description('Show screenshot counts for all languages and device types')
    .option('--platform <platform>', 'Target platform: ios, macos')
    .option('--version-id <versionId>', 'Specific version ID')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);

        // Get target version
        let version;
        if (options.versionId) {
          const versions = await client.listVersions();
          version = versions.find((v) => v.id === options.versionId);
          if (!version) {
            console.error(chalk.red(`Version not found: ${options.versionId}`));
            process.exit(1);
          }
        } else {
          const versions = await client.listVersions();
          const editableStates = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED'];

          const platformMap: Record<string, string> = {
            ios: 'IOS',
            macos: 'MAC_OS',
          };

          const targetPlatform = options.platform
            ? platformMap[options.platform.toLowerCase()]
            : null;

          version = versions.find((v) => {
            const isEditable = editableStates.includes(v.state);
            const matchesPlatform = targetPlatform ? v.platform === targetPlatform : true;
            return isEditable && matchesPlatform;
          });

          if (!version) {
            const platformMsg = targetPlatform ? ` for platform ${options.platform}` : '';
            console.log(chalk.yellow(`No editable version found${platformMsg}.`));
            return;
          }
        }

        console.log(`Version: ${version.versionString} (${version.platform})\n`);

        const localisations = await client.listLocalisations(version.id);

        // Collect all device types and counts per language
        const allDeviceTypes = new Set<string>();
        const langData: Map<string, Map<string, number>> = new Map();

        for (const loc of localisations) {
          const screenshotSets = await client.listScreenshotSets(loc.id);
          const deviceCounts = new Map<string, number>();

          for (const set of screenshotSets) {
            const displayType = set.attributes?.screenshotDisplayType || 'Unknown';
            allDeviceTypes.add(displayType);

            const screenshots = await client.listScreenshots(set.id);
            deviceCounts.set(displayType, screenshots.length);
          }

          langData.set(loc.locale, deviceCounts);
        }

        // Sort device types for consistent display
        const sortedDeviceTypes = Array.from(allDeviceTypes).sort();

        // Create header
        const deviceLabels: Record<string, string> = {
          'APP_IPHONE_55': '5.5"',
          'APP_IPHONE_61': '6.1"',
          'APP_IPHONE_65': '6.5"',
          'APP_IPHONE_67': '6.9"',
          'APP_IPAD_PRO_3GEN_11': 'iPad 11"',
          'APP_IPAD_PRO_3GEN_129': 'iPad 12.9"',
          'APP_IPAD_PRO_129': 'iPad 13"',
        };

        // Print header
        const localeWidth = 8;
        const colWidth = 10;
        let header = 'Locale'.padEnd(localeWidth);
        for (const dt of sortedDeviceTypes) {
          const label = deviceLabels[dt] || dt.replace('APP_', '').substring(0, 8);
          header += label.padStart(colWidth);
        }
        console.log(chalk.bold(header));
        console.log('-'.repeat(header.length));

        // Print rows
        const sortedLocales = Array.from(langData.keys()).sort();
        for (const locale of sortedLocales) {
          const counts = langData.get(locale)!;
          let row = locale.padEnd(localeWidth);

          for (const dt of sortedDeviceTypes) {
            const count = counts.get(dt) || 0;
            const countStr = count > 0 ? count.toString() : '-';
            const colored = count > 0 ? chalk.green(countStr) : chalk.gray(countStr);
            row += colored.padStart(colWidth + (colored.length - countStr.length));
          }
          console.log(row);
        }

        // Summary
        console.log('-'.repeat(header.length));
        console.log(`\nTotal locales: ${localisations.length}`);
        console.log(`Device types: ${sortedDeviceTypes.length}`);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // List screenshots
  screenshotsCmd
    .command('list')
    .description('List current screenshots for a language')
    .requiredOption('--lang <language>', 'Language code (e.g., en, de)')
    .option('--platform <platform>', 'Target platform: ios, macos')
    .option('--version-id <versionId>', 'Specific version ID')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);
        const locale = LANGUAGE_MAP[options.lang] || options.lang;

        let versionId = options.versionId;
        let versionString = '';
        if (!versionId) {
          const versions = await client.listVersions();
          const editableStates = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED'];

          const platformMap: Record<string, string> = {
            ios: 'IOS',
            macos: 'MAC_OS',
          };

          const targetPlatform = options.platform
            ? platformMap[options.platform.toLowerCase()]
            : null;

          const version = versions.find((v) => {
            const isEditable = editableStates.includes(v.state);
            const matchesPlatform = targetPlatform ? v.platform === targetPlatform : true;
            return isEditable && matchesPlatform;
          });

          if (!version) {
            const platformMsg = targetPlatform ? ` for platform ${options.platform}` : '';
            console.log(chalk.yellow(`No editable version found${platformMsg}.`));
            return;
          }
          versionId = version.id;
          versionString = version.versionString;
          console.log(`Version: ${versionString} (${version.platform})`);
        }

        const localisation = await client.getLocalisation(versionId, locale);
        if (!localisation) {
          console.log(chalk.yellow(`No localisation found for ${locale}`));
          return;
        }

        const screenshotSets = await client.listScreenshotSets(localisation.id);

        if (screenshotSets.length === 0) {
          console.log('No screenshot sets found.');
          return;
        }

        console.log(`\nScreenshots for ${locale}:\n`);

        for (const set of screenshotSets) {
          const displayType = set.attributes?.screenshotDisplayType || 'Unknown';
          console.log(chalk.bold(`  ${displayType}:`));

          const screenshots = await client.listScreenshots(set.id);

          if (screenshots.length === 0) {
            console.log(chalk.gray('    (no screenshots)'));
          } else {
            for (const screenshot of screenshots) {
              const state = screenshot.assetDeliveryState?.state || 'UNKNOWN';
              const stateColor = state === 'COMPLETE' ? chalk.green : chalk.yellow;
              console.log(`    ${screenshot.fileName} - ${stateColor(state)}`);
            }
          }
          console.log('');
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Upload screenshots
  screenshotsCmd
    .command('upload')
    .description('Upload screenshots from a directory')
    .requiredOption('--source <directory>', 'Source directory containing screenshots')
    .option('--lang <language>', 'Upload for specific language')
    .option('--all', 'Upload for all languages found in source')
    .option('--platform <platform>', 'Target platform: ios, macos')
    .option(
      '--mode <mode>',
      'Upload mode: replace (delete existing), add (keep existing), reorder (reorder only)',
      'replace'
    )
    .option('--dry-run', 'Show what would be uploaded without uploading')
    .option('--device <device>', 'Upload only for specific device (e.g. iphone-6.9, ipad-13)')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const { existsSync, readdirSync, readFileSync, statSync } = await import('fs');
        const { join, basename } = await import('path');
        const { parse: parseYaml } = await import('yaml');
        const { createHash } = await import('crypto');
        const { getScreenshotsOrderPath } = await import('../paths.js');

        const mode = options.mode as ScreenshotUploadMode;

        if (!['replace', 'add', 'reorder'].includes(mode)) {
          console.error(chalk.red('Invalid mode. Use: replace, add, or reorder'));
          process.exit(1);
        }

        if (!existsSync(options.source)) {
          console.error(chalk.red(`Source directory not found: ${options.source}`));
          process.exit(1);
        }

        const client = createClient(options.keyId);

        // Get editable version with platform filter
        const versions = await client.listVersions();
        const editableStates = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED'];

        const platformMap: Record<string, string> = {
          ios: 'IOS',
          macos: 'MAC_OS',
        };

        const targetPlatform = options.platform
          ? platformMap[options.platform.toLowerCase()]
          : null;

        if (options.platform && !targetPlatform) {
          console.error(chalk.red(`Unknown platform: ${options.platform}. Use: ios, macos`));
          process.exit(1);
        }

        const version = versions.find((v) => {
          const isEditable = editableStates.includes(v.state);
          const matchesPlatform = targetPlatform ? v.platform === targetPlatform : true;
          return isEditable && matchesPlatform;
        });

        if (!version) {
          const platformMsg = targetPlatform ? ` for platform ${options.platform}` : '';
          console.log(chalk.yellow(`No editable version found${platformMsg}.`));
          return;
        }

        console.log(`Target version: ${version.versionString}`);
        console.log(`Upload mode: ${mode}`);
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes will be made\n'));
        }

        // Parse screenshot filenames
        const files = readdirSync(options.source).filter(
          (f) => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')
        );

        const parsed = files
          .map((f) => parseScreenshotFilename(f))
          .filter((p): p is ParsedScreenshotFilename => p !== null);

        if (parsed.length === 0) {
          console.log(chalk.yellow('No valid screenshot files found.'));
          console.log('Expected format: {lang}-{device}-{orientation}-{feature}-{timestamp}-{resolution}.png');
          return;
        }

        // Group by language
        const byLanguage = new Map<string, ParsedScreenshotFilename[]>();
        for (const p of parsed) {
          const existing = byLanguage.get(p.language) || [];
          existing.push(p);
          byLanguage.set(p.language, existing);
        }

        // Determine which languages to process
        let languagesToProcess: string[];
        if (options.all) {
          languagesToProcess = Array.from(byLanguage.keys());
        } else if (options.lang) {
          languagesToProcess = [options.lang];
        } else {
          console.error(chalk.red('Please specify --all or --lang <language>'));
          process.exit(1);
        }

        // Load order configuration if exists (configurable via
        // appstore-cli.config.yaml or APPSTORE_METADATA_DIR; defaults
        // to l10n/metadata/apple/screenshots/order.yaml).
        const orderPath = getScreenshotsOrderPath();
        let order: string[] = [];
        if (existsSync(orderPath)) {
          const orderContent = readFileSync(orderPath, 'utf-8');
          const orderConfig = parseYaml(orderContent) as { order: string[] };
          order = orderConfig.order || [];
          console.log(chalk.dim(`Using order from: ${orderPath}`));
        }

        // Get existing localisations
        const existingLocalisations = await client.listLocalisations(version.id);
        const localisationMap = new Map(existingLocalisations.map((l) => [l.locale, l]));

        let totalUploaded = 0;
        let totalDeleted = 0;
        let totalErrors = 0;

        for (const lang of languagesToProcess) {
          const screenshots = byLanguage.get(lang);
          if (!screenshots || screenshots.length === 0) {
            console.log(chalk.yellow(`\n${lang}: No screenshots found`));
            continue;
          }

          // Expand language to potentially multiple store locales
          const locales = LOCALE_EXPAND[lang] || [LANGUAGE_MAP[lang] || lang];

          for (const locale of locales) {
          const localisation = localisationMap.get(locale);

          if (!localisation) {
            console.log(chalk.yellow(`\n${lang}: No localisation found for ${locale}`));
            continue;
          }

          console.log(chalk.bold(`\n${lang} → ${locale}:`));
          console.log(`  Found ${screenshots.length} screenshots`);

          // Group by device type
          const byDevice = new Map<string, ParsedScreenshotFilename[]>();
          for (const s of screenshots) {
            const existing = byDevice.get(s.device) || [];
            existing.push(s);
            byDevice.set(s.device, existing);
          }

          // Process each device type
          for (const [device, deviceScreenshots] of byDevice) {
            // Filter by --device if specified
            if (options.device && device !== options.device) continue;

            const displayType = DEVICE_TYPE_MAP[device];
            if (!displayType) {
              console.log(chalk.yellow(`    ${device}: Unknown device type, skipping`));
              continue;
            }

            console.log(`    ${chalk.bold(device)} (${displayType}):`)

            // Sort by order config or feature name
            const sorted = [...deviceScreenshots].sort((a, b) => {
              const aIndex = order.indexOf(a.feature);
              const bIndex = order.indexOf(b.feature);
              if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
              if (aIndex !== -1) return -1;
              if (bIndex !== -1) return 1;
              return a.feature.localeCompare(b.feature);
            });

            if (options.dryRun) {
              for (const s of sorted) {
                console.log(`      Would upload: ${s.filename}`);
              }
              continue;
            }

            // Get or create screenshot set
            const screenshotSets = await client.listScreenshotSets(localisation.id);
            let set = screenshotSets.find(
              (s: any) => s.attributes?.screenshotDisplayType === displayType
            );

            if (!set) {
              console.log(chalk.dim(`      Creating screenshot set for ${displayType}`));
              const setId = await client.createScreenshotSet(localisation.id, displayType);
              set = { id: setId };
            }

            // Delete existing screenshots if replace mode
            if (mode === 'replace') {
              const existing = await client.listScreenshots(set.id);
              for (const screenshot of existing) {
                try {
                  await client.deleteScreenshot(screenshot.id);
                  console.log(chalk.red(`      Deleted: ${screenshot.fileName}`));
                  totalDeleted++;
                } catch (error) {
                  console.error(
                    chalk.red(`      Failed to delete ${screenshot.fileName}:`),
                    error instanceof Error ? error.message : error
                  );
                  totalErrors++;
                }
              }
            }

            // Upload new screenshots
            if (mode !== 'reorder') {
              for (const s of sorted) {
                try {
                  const filePath = join(options.source, s.filename);
                  const fileContent = readFileSync(filePath);
                  const fileSize = statSync(filePath).size;
                  const checksum = createHash('md5').update(fileContent).digest('hex');

                  // Reserve upload slot
                  const reservation = await client.reserveScreenshot(set.id, s.filename, fileSize);

                  // Upload to each operation URL
                  for (const op of reservation.uploadOperations) {
                    const chunk = fileContent.slice(op.offset, op.offset + op.length);
                    const uploadResponse = await fetch(op.url, {
                      method: op.method,
                      headers: op.requestHeaders.reduce(
                        (acc: Record<string, string>, h: { name: string; value: string }) => {
                          acc[h.name] = h.value;
                          return acc;
                        },
                        {}
                      ),
                      body: chunk,
                    });
                    if (!uploadResponse.ok) {
                      throw new Error(
                        `Upload chunk failed: ${uploadResponse.status} ${uploadResponse.statusText}`
                      );
                    }
                  }

                  // Commit upload
                  await client.commitScreenshot(reservation.id, checksum);
                  console.log(chalk.green(`      Uploaded: ${s.filename}`));
                  totalUploaded++;
                } catch (error) {
                  console.error(
                    chalk.red(`      Failed to upload ${s.filename}:`),
                    error instanceof Error ? error.message : error
                  );
                  totalErrors++;
                }
              }
            }
          }
          } // end locale expansion
        }

        // Summary
        console.log('\n--- Summary ---');
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes were made'));
        } else {
          if (totalUploaded > 0) console.log(chalk.green(`Uploaded: ${totalUploaded}`));
          if (totalDeleted > 0) console.log(chalk.red(`Deleted: ${totalDeleted}`));
          if (totalErrors > 0) console.log(chalk.red(`Errors: ${totalErrors}`));
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Delete all screenshots for a language
  screenshotsCmd
    .command('delete')
    .description('Delete all screenshots for a language')
    .requiredOption('--lang <language>', 'Language code (e.g., en, de)')
    .option('--device <device>', 'Delete only for specific device type')
    .option('--dry-run', 'Show what would be deleted without deleting')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);
        const locale = LANGUAGE_MAP[options.lang] || options.lang;

        const version = await client.getEditableVersion();
        if (!version) {
          console.log(chalk.yellow('No editable version found.'));
          return;
        }

        const localisation = await client.getLocalisation(version.id, locale);
        if (!localisation) {
          console.log(chalk.yellow(`No localisation found for ${locale}`));
          return;
        }

        console.log(`Deleting screenshots for ${locale}...`);
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes will be made\n'));
        }

        const screenshotSets = await client.listScreenshotSets(localisation.id);
        let totalDeleted = 0;

        for (const set of screenshotSets) {
          const displayType = set.attributes?.screenshotDisplayType || 'Unknown';

          if (options.device) {
            const targetDisplayType = DEVICE_TYPE_MAP[options.device];
            if (displayType !== targetDisplayType) continue;
          }

          console.log(`  ${chalk.bold(displayType)}:`);

          const screenshots = await client.listScreenshots(set.id);

          for (const screenshot of screenshots) {
            if (options.dryRun) {
              console.log(`    Would delete: ${screenshot.fileName}`);
            } else {
              try {
                await client.deleteScreenshot(screenshot.id);
                console.log(chalk.red(`    Deleted: ${screenshot.fileName}`));
                totalDeleted++;
              } catch (error) {
                console.error(
                  chalk.red(`    Failed to delete ${screenshot.fileName}:`),
                  error instanceof Error ? error.message : error
                );
              }
            }
          }
        }

        if (!options.dryRun) {
          console.log(`\nTotal deleted: ${totalDeleted}`);
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Reorder screenshots based on order.yaml
  screenshotsCmd
    .command('reorder')
    .description('Reorder screenshots based on order.yaml configuration')
    .option('--lang <language>', 'Reorder for specific language')
    .option('--all', 'Reorder for all languages')
    .option('--platform <platform>', 'Target platform: ios, macos')
    .option('--dry-run', 'Show what would be reordered without changes')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const { existsSync, readFileSync } = await import('fs');
        const { parse: parseYaml } = await import('yaml');
        const { getScreenshotsOrderPath } = await import('../paths.js');

        const client = createClient(options.keyId);

        // Load order configuration from the configured metadata_dir.
        const orderPath = getScreenshotsOrderPath();

        if (!existsSync(orderPath)) {
          console.error(chalk.red(`Order configuration not found: ${orderPath}`));
          process.exit(1);
        }

        const orderContent = readFileSync(orderPath, 'utf-8');
        const orderConfig = parseYaml(orderContent) as { order: string[] };
        const order = orderConfig.order || [];

        if (order.length === 0) {
          console.error(chalk.red('No order configuration found in order.yaml'));
          process.exit(1);
        }

        console.log(`Using order: ${order.join(', ')}\n`);

        // Get editable version with platform filter
        const versions = await client.listVersions();
        const editableStates = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED'];

        const platformMap: Record<string, string> = {
          ios: 'IOS',
          macos: 'MAC_OS',
        };

        const targetPlatform = options.platform
          ? platformMap[options.platform.toLowerCase()]
          : null;

        const version = versions.find((v) => {
          const isEditable = editableStates.includes(v.state);
          const matchesPlatform = targetPlatform ? v.platform === targetPlatform : true;
          return isEditable && matchesPlatform;
        });

        if (!version) {
          const platformMsg = targetPlatform ? ` for platform ${options.platform}` : '';
          console.log(chalk.yellow(`No editable version found${platformMsg}.`));
          return;
        }

        console.log(`Target version: ${version.versionString}`);
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes will be made\n'));
        }

        // Get localisations
        const localisations = await client.listLocalisations(version.id);

        // Determine which languages to process
        let localesToProcess: typeof localisations;
        if (options.all) {
          localesToProcess = localisations;
        } else if (options.lang) {
          const expandedLocales = LOCALE_EXPAND[options.lang]
            || [LANGUAGE_MAP[options.lang] || options.lang];
          localesToProcess = localisations.filter((l) => expandedLocales.includes(l.locale));
          if (localesToProcess.length === 0) {
            console.log(chalk.yellow(`No localisation found for ${expandedLocales.join(', ')}`));
            return;
          }
        } else {
          console.error(chalk.red('Please specify --all or --lang <language>'));
          process.exit(1);
        }

        let totalReordered = 0;

        for (const loc of localesToProcess) {
          console.log(chalk.bold(`\n${loc.locale}:`));

          const screenshotSets = await client.listScreenshotSets(loc.id);

          for (const set of screenshotSets) {
            const displayType = set.attributes?.screenshotDisplayType || 'Unknown';
            const screenshots = await client.listScreenshots(set.id);

            if (screenshots.length === 0) {
              continue;
            }

            // Parse filenames to get feature names
            const screenshotsWithFeature = screenshots.map((s) => {
              const parsed = parseScreenshotFilename(s.fileName);
              return {
                ...s,
                feature: parsed?.feature || s.fileName,
              };
            });

            // Sort by order config
            const sorted = [...screenshotsWithFeature].sort((a, b) => {
              const aIndex = order.indexOf(a.feature);
              const bIndex = order.indexOf(b.feature);
              if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
              if (aIndex !== -1) return -1;
              if (bIndex !== -1) return 1;
              return a.feature.localeCompare(b.feature);
            });

            // Check if order changed
            const currentOrder = screenshots.map((s) => s.id);
            const newOrder = sorted.map((s) => s.id);
            const orderChanged = currentOrder.some((id, i) => id !== newOrder[i]);

            if (!orderChanged) {
              console.log(`  ${displayType}: already in correct order`);
              continue;
            }

            console.log(`  ${chalk.bold(displayType)}:`);
            console.log(`    Current: ${screenshotsWithFeature.map((s) => s.feature).join(', ')}`);
            console.log(`    New:     ${sorted.map((s) => s.feature).join(', ')}`);

            if (!options.dryRun) {
              try {
                await client.reorderScreenshots(set.id, newOrder);
                console.log(chalk.green(`    ✓ Reordered`));
                totalReordered++;
              } catch (error) {
                console.error(
                  chalk.red(`    Failed to reorder:`),
                  error instanceof Error ? error.message : error
                );
              }
            }
          }
        }

        // Summary
        console.log('\n--- Summary ---');
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes were made'));
        } else {
          console.log(`Reordered: ${totalReordered} screenshot sets`);
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

/**
 * Parse a screenshot filename into its components.
 *
 * Expected format: {lang}-{device}-{orientation}-{feature}-{timestamp}-{resolution}.png
 * Example: en-iphone-6.7-p-blr-detail-20260122-201913-1290x2796.png
 *
 * Timestamp can be date only (20260122) or date-time (20260122-201913)
 */
function parseScreenshotFilename(filename: string): ParsedScreenshotFilename | null {
  // Remove extension
  const base = filename.replace(/\.(png|jpg|jpeg)$/i, '');

  // Pattern: lang-device-orientation-feature-timestamp-resolution
  // Device can have dots (e.g., iphone-6.7)
  // Timestamp can be date-time (20260122-201913) or just date (20260122)
  const match = base.match(
    /^([a-z]{2})-([a-z]+-[\d.]+)-([pl])-(.+)-(\d{8}-\d{6}|\d{8})-(\d+x\d+)$/i
  );

  if (!match) {
    // Try alternate patterns (without dot in device, e.g., android-phone-wqhd)
    const altMatch = base.match(
      /^([a-z]{2})-([a-z]+-[a-z]+-[a-z0-9]+)-([pl])-(.+)-(\d{8}-\d{6}|\d{8})-(\d+x\d+)$/i
    );

    if (altMatch) {
      return {
        language: altMatch[1],
        device: altMatch[2],
        orientation: altMatch[3].toLowerCase() as 'p' | 'l',
        feature: altMatch[4],
        timestamp: altMatch[5],
        resolution: altMatch[6],
        filename,
      };
    }

    // Try simple device pattern (e.g., ipad-11)
    const simpleMatch = base.match(
      /^([a-z]{2})-([a-z]+-\d+)-([pl])-(.+)-(\d{8}-\d{6}|\d{8})-(\d+x\d+)$/i
    );

    if (simpleMatch) {
      return {
        language: simpleMatch[1],
        device: simpleMatch[2],
        orientation: simpleMatch[3].toLowerCase() as 'p' | 'l',
        feature: simpleMatch[4],
        timestamp: simpleMatch[5],
        resolution: simpleMatch[6],
        filename,
      };
    }

    return null;
  }

  return {
    language: match[1],
    device: match[2],
    orientation: match[3].toLowerCase() as 'p' | 'l',
    feature: match[4],
    timestamp: match[5],
    resolution: match[6],
    filename,
  };
}
