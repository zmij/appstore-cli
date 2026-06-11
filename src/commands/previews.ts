/**
 * Previews Commands
 *
 * Commands for managing App Store preview videos — summary, list, upload, delete.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';
import { LANGUAGE_MAP, LOCALE_EXPAND, PREVIEW_DEVICE_TYPE_MAP, PREVIEW_DEVICE_GROUPS } from '../types.js';
import type { PreviewUploadMode } from '../types.js';

/**
 * Reverse lookup: preview type enum → friendly device key
 */
const PREVIEW_TYPE_LABELS: Record<string, string> = {};
for (const [key, value] of Object.entries(PREVIEW_DEVICE_TYPE_MAP)) {
  PREVIEW_TYPE_LABELS[value] = key;
}

/**
 * Find the editable version, optionally filtered by platform
 */
async function getEditableVersion(
  client: ReturnType<typeof createClient>,
  options: { platform?: string; versionId?: string }
) {
  const versions = await client.listVersions();

  if (options.versionId) {
    const version = versions.find((v) => v.id === options.versionId);
    if (!version) {
      console.error(chalk.red(`Version not found: ${options.versionId}`));
      process.exit(1);
    }
    return version;
  }

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
    process.exit(0);
  }

  return version;
}

export function registerPreviewsCommands(program: Command): void {
  const previewsCmd = program
    .command('previews')
    .description('Manage app store preview videos');

  // ============================================================================
  // previews summary
  // ============================================================================
  previewsCmd
    .command('summary')
    .description('Show preview counts for all languages and device types')
    .option('--platform <platform>', 'Target platform: ios, macos')
    .option('--version-id <versionId>', 'Specific version ID')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);
        const version = await getEditableVersion(client, options);

        console.log(`Version: ${version.versionString} (${version.platform})\n`);

        const localisations = await client.listLocalisations(version.id);

        const allPreviewTypes = new Set<string>();
        const langData: Map<string, Map<string, number>> = new Map();

        for (const loc of localisations) {
          const previewSets = await client.listPreviewSets(loc.id);
          const typeCounts = new Map<string, number>();

          for (const set of previewSets) {
            const previewType = set.attributes?.previewType || 'Unknown';
            allPreviewTypes.add(previewType);

            const previews = await client.listPreviews(set.id);
            typeCounts.set(previewType, previews.length);
          }

          langData.set(loc.locale, typeCounts);
        }

        const sortedTypes = Array.from(allPreviewTypes).sort();

        if (sortedTypes.length === 0) {
          console.log(chalk.yellow('No preview videos found for any locale.'));
          return;
        }

        // Print header
        const localeWidth = 8;
        const colWidth = 14;
        let header = 'Locale'.padEnd(localeWidth);
        for (const pt of sortedTypes) {
          const label = PREVIEW_TYPE_LABELS[pt] || pt;
          header += label.padStart(colWidth);
        }
        console.log(chalk.bold(header));
        console.log('-'.repeat(header.length));

        // Print rows
        const sortedLocales = Array.from(langData.keys()).sort();
        for (const locale of sortedLocales) {
          const counts = langData.get(locale)!;
          let row = locale.padEnd(localeWidth);

          for (const pt of sortedTypes) {
            const count = counts.get(pt) || 0;
            const countStr = count > 0 ? count.toString() : '-';
            const colored = count > 0 ? chalk.green(countStr) : chalk.gray(countStr);
            row += colored.padStart(colWidth + (colored.length - countStr.length));
          }
          console.log(row);
        }

        console.log('-'.repeat(header.length));
        console.log(`\nTotal locales: ${localisations.length}`);
        console.log(`Preview types: ${sortedTypes.length}`);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ============================================================================
  // previews list
  // ============================================================================
  previewsCmd
    .command('list')
    .description('List current previews for a language')
    .requiredOption('--lang <language>', 'Language code (e.g., en, de)')
    .option('--platform <platform>', 'Target platform: ios, macos')
    .option('--version-id <versionId>', 'Specific version ID')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);
        const locale = LANGUAGE_MAP[options.lang] || options.lang;
        const version = await getEditableVersion(client, options);

        console.log(`Version: ${version.versionString} (${version.platform})`);

        const localisation = await client.getLocalisation(version.id, locale);
        if (!localisation) {
          console.log(chalk.yellow(`No localisation found for ${locale}`));
          return;
        }

        const previewSets = await client.listPreviewSets(localisation.id);

        if (previewSets.length === 0) {
          console.log('\nNo preview sets found.');
          return;
        }

        console.log(`\nPreviews for ${locale}:\n`);

        for (const set of previewSets) {
          const previewType = set.attributes?.previewType || 'Unknown';
          const label = PREVIEW_TYPE_LABELS[previewType] || previewType;
          console.log(chalk.bold(`  ${previewType} (${label}):`));

          const previews = await client.listPreviews(set.id);

          if (previews.length === 0) {
            console.log(chalk.gray('    (no previews)'));
          } else {
            for (const preview of previews) {
              const state = preview.assetDeliveryState?.state || 'UNKNOWN';
              const stateColor = state === 'COMPLETE' ? chalk.green : chalk.yellow;
              console.log(`    ${preview.fileName} - ${stateColor(state)}`);
              if (preview.videoUrl) {
                console.log(chalk.dim(`      ${preview.videoUrl}`));
              }
            }
          }
          console.log('');
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ============================================================================
  // previews upload
  // ============================================================================
  previewsCmd
    .command('upload')
    .description('Upload a preview video to one or more locales')
    .requiredOption('--file <path>', 'Path to video file')
    .requiredOption('--device <type>', 'Device type or group (e.g., iphone, ipad, iphone-6.9)')
    .option('--lang <language>', 'Target language code')
    .option('--all', 'Upload to all locales')
    .option('--platform <platform>', 'Target platform: ios, macos')
    .option(
      '--mode <mode>',
      'Upload mode: replace (delete only previews with matching filename), ' +
        'replace-all (delete every existing preview in the locale+device tier), ' +
        'add (keep existing), skip (skip if exists)',
      'skip'
    )
    .option('--dry-run', 'Show what would be uploaded without uploading')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const { existsSync, readFileSync, statSync } = await import('fs');
        const { basename } = await import('path');
        const { createHash } = await import('crypto');

        const mode = options.mode as PreviewUploadMode;

        if (!['replace', 'replace-all', 'add', 'skip'].includes(mode)) {
          console.error(chalk.red('Invalid mode. Use: replace, replace-all, add, or skip'));
          process.exit(1);
        }

        // Resolve ~ in file path
        const filePath = options.file.replace(/^~/, process.env.HOME || '');

        if (!existsSync(filePath)) {
          console.error(chalk.red(`File not found: ${filePath}`));
          process.exit(1);
        }

        // Resolve device keys: group alias or single device
        const deviceKeys = PREVIEW_DEVICE_GROUPS[options.device]
          || (PREVIEW_DEVICE_TYPE_MAP[options.device] ? [options.device] : null);

        if (!deviceKeys) {
          const validDevices = [
            ...Object.keys(PREVIEW_DEVICE_GROUPS),
            ...Object.keys(PREVIEW_DEVICE_TYPE_MAP),
          ].join(', ');
          console.error(chalk.red(`Unknown device: ${options.device}. Valid: ${validDevices}`));
          process.exit(1);
        }

        const previewTypes = deviceKeys.map((k) => ({
          key: k,
          type: PREVIEW_DEVICE_TYPE_MAP[k],
        }));

        if (!options.lang && !options.all) {
          console.error(chalk.red('Please specify --lang <language> or --all'));
          process.exit(1);
        }

        const client = createClient(options.keyId);
        const version = await getEditableVersion(client, options);

        const fileName = basename(filePath);
        const fileSize = statSync(filePath).size;

        // Read file and compute checksum once
        const fileContent = readFileSync(filePath);
        const checksum = createHash('md5').update(fileContent).digest('hex');

        console.log(`Target version: ${version.versionString}`);
        console.log(`File: ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
        console.log(`Device: ${options.device} → ${previewTypes.map((p) => p.type).join(', ')}`);
        console.log(`Upload mode: ${mode}`);
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN — no changes will be made\n'));
        }

        const localisations = await client.listLocalisations(version.id);

        // Determine which locales to process
        let localesToProcess: typeof localisations;
        if (options.all) {
          localesToProcess = localisations;
        } else {
          const expandedLocales = LOCALE_EXPAND[options.lang]
            || [LANGUAGE_MAP[options.lang] || options.lang];
          localesToProcess = localisations.filter((l) => expandedLocales.includes(l.locale));

          if (localesToProcess.length === 0) {
            console.log(chalk.yellow(`No localisation found for ${options.lang}`));
            return;
          }
        }

        let totalUploaded = 0;
        let totalSkipped = 0;
        let totalDeleted = 0;
        let totalErrors = 0;

        for (const loc of localesToProcess) {
          console.log(chalk.bold(`\n${loc.locale}:`));

          const previewSets = await client.listPreviewSets(loc.id);

          for (const { key: deviceKey, type: previewType } of previewTypes) {
            let set = previewSets.find(
              (s: any) => s.attributes?.previewType === previewType
            );

            // Check existing previews
            if (set) {
              const existingPreviews = await client.listPreviews(set.id);

              if (existingPreviews.length > 0) {
                if (mode === 'skip') {
                  // Skip only if the SAME filename is already there. Other
                  // previews in the tier (e.g. preview-2-advanced) shouldn't
                  // block uploading preview-1-relaxed.
                  if (existingPreviews.some((p: any) => p.fileName === fileName)) {
                    console.log(chalk.dim(`  ${deviceKey}: skipped (${fileName} already present)`));
                    totalSkipped++;
                    continue;
                  }
                }

                // `replace` deletes only the entries whose filename matches
                // the new file's basename. Other previews in the tier are
                // left intact — the common case for "I re-rendered this
                // specific preview, swap it in."
                // `replace-all` keeps the old wholesale behaviour for the
                // rare "wipe this locale+device clean" case.
                const previewsToDelete = mode === 'replace'
                  ? existingPreviews.filter((p: any) => p.fileName === fileName)
                  : mode === 'replace-all'
                    ? existingPreviews
                    : [];

                for (const preview of previewsToDelete) {
                  if (options.dryRun) {
                    console.log(`  ${deviceKey}: would delete ${preview.fileName}`);
                  } else {
                    try {
                      await client.deletePreview(preview.id);
                      console.log(chalk.red(`  ${deviceKey}: deleted ${preview.fileName}`));
                      totalDeleted++;
                    } catch (error) {
                      console.error(
                        chalk.red(`  ${deviceKey}: failed to delete ${preview.fileName}:`),
                        error instanceof Error ? error.message : error
                      );
                      totalErrors++;
                    }
                  }
                }
              }
            }

            if (options.dryRun) {
              console.log(`  ${deviceKey}: would upload ${fileName}`);
              continue;
            }

            try {
              // Create preview set if missing
              if (!set) {
                console.log(chalk.dim(`  ${deviceKey}: creating preview set`));
                const setId = await client.createPreviewSet(loc.id, previewType);
                set = { id: setId };
              }

              // Reserve upload slot
              const reservation = await client.reservePreview(set.id, fileName, fileSize);

              // Upload chunks
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
              await client.commitPreview(reservation.id, checksum);
              console.log(chalk.green(`  ${deviceKey}: uploaded`));
              totalUploaded++;
            } catch (error) {
              console.error(
                chalk.red(`  ${deviceKey}: failed to upload:`),
                error instanceof Error ? error.message : error
              );
              totalErrors++;
            }
          }
        }

        // Summary
        console.log('\n--- Summary ---');
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN — no changes were made'));
        } else {
          if (totalUploaded > 0) console.log(chalk.green(`Uploaded: ${totalUploaded}`));
          if (totalSkipped > 0) console.log(chalk.dim(`Skipped: ${totalSkipped}`));
          if (totalDeleted > 0) console.log(chalk.red(`Deleted: ${totalDeleted}`));
          if (totalErrors > 0) console.log(chalk.red(`Errors: ${totalErrors}`));
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ============================================================================
  // previews delete
  // ============================================================================
  previewsCmd
    .command('delete')
    .description('Delete previews for a language')
    .option('--lang <language>', 'Language code (e.g., en, de). Required unless --all is set.')
    .option('--device <device>', 'Delete only for specific device type')
    .option('--all', 'Delete for all locales')
    .option('--platform <platform>', 'Target platform: ios, macos')
    .option(
      '--filename <name>',
      'Delete only previews matching this exact filename'
    )
    .option(
      '--filename-prefix <prefix>',
      'Delete previews whose filename starts with this prefix (e.g. cleanup of an old version)'
    )
    .option('--dry-run', 'Show what would be deleted without deleting')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        if (!options.lang && !options.all) {
          console.error(chalk.red('Please specify --lang <language> or --all'));
          process.exit(1);
        }

        const client = createClient(options.keyId);
        const version = await getEditableVersion(client, options);

        const localisations = await client.listLocalisations(version.id);

        // Determine which locales to process
        let localesToProcess: typeof localisations;
        if (options.all) {
          localesToProcess = localisations;
        } else {
          const expandedLocales = LOCALE_EXPAND[options.lang]
            || [LANGUAGE_MAP[options.lang] || options.lang];
          localesToProcess = localisations.filter((l) => expandedLocales.includes(l.locale));

          if (localesToProcess.length === 0) {
            console.log(chalk.yellow(`No localisation found for ${options.lang}`));
            return;
          }
        }

        let targetPreviewTypes: Set<string> | null = null;
        if (options.device) {
          const deviceKeys = PREVIEW_DEVICE_GROUPS[options.device]
            || (PREVIEW_DEVICE_TYPE_MAP[options.device] ? [options.device] : null);

          if (!deviceKeys) {
            const validDevices = [
              ...Object.keys(PREVIEW_DEVICE_GROUPS),
              ...Object.keys(PREVIEW_DEVICE_TYPE_MAP),
            ].join(', ');
            console.error(chalk.red(`Unknown device: ${options.device}. Valid: ${validDevices}`));
            process.exit(1);
          }
          targetPreviewTypes = new Set(deviceKeys.map((k) => PREVIEW_DEVICE_TYPE_MAP[k]));
        }

        // Compile filename filter once. `--filename` is an exact match;
        // `--filename-prefix` is a stem match; if neither is set, every
        // preview matches (preserves the original "delete everything in
        // scope" behaviour).
        const filenameExact: string | null = options.filename || null;
        const filenamePrefix: string | null = options.filenamePrefix || null;
        if (filenameExact && filenamePrefix) {
          console.error(chalk.red(
            'Use either --filename OR --filename-prefix, not both.'
          ));
          process.exit(1);
        }
        const matchesFilename = (fileName: string): boolean => {
          if (filenameExact) return fileName === filenameExact;
          if (filenamePrefix) return fileName.startsWith(filenamePrefix);
          return true;
        };

        console.log(`Deleting previews...`);
        if (filenameExact) {
          console.log(chalk.dim(`Filter: filename == "${filenameExact}"`));
        } else if (filenamePrefix) {
          console.log(chalk.dim(`Filter: filename startsWith "${filenamePrefix}"`));
        }
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN — no changes will be made\n'));
        }

        let totalDeleted = 0;
        let totalSkipped = 0;

        for (const loc of localesToProcess) {
          console.log(chalk.bold(`\n${loc.locale}:`));

          const previewSets = await client.listPreviewSets(loc.id);

          for (const set of previewSets) {
            const previewType = set.attributes?.previewType || 'Unknown';

            if (targetPreviewTypes && !targetPreviewTypes.has(previewType)) continue;

            const label = PREVIEW_TYPE_LABELS[previewType] || previewType;
            console.log(`  ${chalk.bold(`${previewType} (${label})`)}:`);

            const previews = await client.listPreviews(set.id);

            for (const preview of previews) {
              if (!matchesFilename(preview.fileName)) {
                console.log(chalk.dim(`    Skipped: ${preview.fileName} (no filename match)`));
                totalSkipped++;
                continue;
              }
              if (options.dryRun) {
                console.log(`    Would delete: ${preview.fileName}`);
              } else {
                try {
                  await client.deletePreview(preview.id);
                  console.log(chalk.red(`    Deleted: ${preview.fileName}`));
                  totalDeleted++;
                } catch (error) {
                  console.error(
                    chalk.red(`    Failed to delete ${preview.fileName}:`),
                    error instanceof Error ? error.message : error
                  );
                }
              }
            }
          }
        }

        if (!options.dryRun) {
          console.log(`\nTotal deleted: ${totalDeleted}`);
          if (totalSkipped > 0) {
            console.log(chalk.dim(`Skipped (no filename match): ${totalSkipped}`));
          }
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
