/**
 * Listings Commands
 *
 * Commands for updating app store listings from YAML metadata files.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';
import { LANGUAGE_MAP } from '../types.js';
import type { ListingMetadata } from '../types.js';

export function registerListingsCommands(program: Command): void {
  const listingsCmd = program
    .command('listings')
    .description('Manage app store listings');

  // Update listings from YAML
  listingsCmd
    .command('update')
    .description('Update listings from YAML metadata files')
    .option('--all', 'Update all languages')
    .option('--lang <language>', 'Update specific language (e.g., en, de)')
    .option('--version-id <versionId>', 'Target specific version ID (defaults to first editable version)')
    .option('--platform <platform>', 'Target platform: ios, macos (defaults to first editable version)')
    .option(
      '--field <field>',
      'Update specific field only (whats_new, title, subtitle, promotional_text, description, keywords)'
    )
    .option('--dry-run', 'Show changes without applying them')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const { readFileSync, existsSync, readdirSync } = await import('fs');
        const { join, basename } = await import('path');
        const { parse: parseYaml } = await import('yaml');
        const { getListingsDir } = await import('../paths.js');

        const client = createClient(options.keyId);

        // Resolve metadata directory (configurable via appstore-cli.config.yaml
        // or APPSTORE_METADATA_DIR; defaults to l10n/metadata/apple/listings).
        const metadataDir = getListingsDir();

        if (!existsSync(metadataDir)) {
          console.error(chalk.red(`Metadata directory not found: ${metadataDir}`));
          console.log('Expected YAML files in the configured metadata_dir (default `l10n/metadata/apple/listings/`).');
          process.exit(1);
        }

        // Get target version
        let version;
        if (options.versionId) {
          // Use specified version ID
          const versions = await client.listVersions();
          version = versions.find((v) => v.id === options.versionId);
          if (!version) {
            console.error(chalk.red(`Version not found: ${options.versionId}`));
            process.exit(1);
          }
        } else {
          // Get editable version, optionally filtered by platform
          const versions = await client.listVersions();
          const editableStates = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED'];

          // Map platform option to API platform value
          const platformMap: Record<string, string> = {
            ios: 'IOS',
            macos: 'MAC_OS',
            tvos: 'TV_OS',
            visionos: 'VISION_OS',
          };

          const targetPlatform = options.platform
            ? platformMap[options.platform.toLowerCase()]
            : null;

          if (options.platform && !targetPlatform) {
            console.error(
              chalk.red(`Unknown platform: ${options.platform}. Use: ios, macos, tvos, visionos`)
            );
            process.exit(1);
          }

          version = versions.find((v) => {
            const isEditable = editableStates.includes(v.state);
            const matchesPlatform = targetPlatform ? v.platform === targetPlatform : true;
            return isEditable && matchesPlatform;
          });

          if (!version) {
            const platformMsg = targetPlatform ? ` for platform ${options.platform}` : '';
            console.log(chalk.yellow(`No editable version found${platformMsg}.`));
            console.log('Cannot update listings without an editable version.');
            return;
          }
        }

        console.log(chalk.blue(`Target version: ${version.versionString} (${version.platform})`));
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes will be made\n'));
        }

        // Determine which languages to update
        let languages: string[] = [];

        if (options.all) {
          // Find all YAML files in metadata directory
          const files = readdirSync(metadataDir).filter((f) => f.endsWith('.yaml'));
          languages = files.map((f) => basename(f, '.yaml'));
        } else if (options.lang) {
          languages = [options.lang];
        } else {
          console.error(chalk.red('Please specify --all or --lang <language>'));
          process.exit(1);
        }

        // Get existing localisations
        const existingLocalisations = await client.listLocalisations(version.id);
        const localisationMap = new Map(existingLocalisations.map((l) => [l.locale, l]));

        let updatedCount = 0;
        let createdCount = 0;
        let errorCount = 0;

        for (const lang of languages) {
          const yamlPath = join(metadataDir, `${lang}.yaml`);

          if (!existsSync(yamlPath)) {
            console.log(chalk.yellow(`  Skipping ${lang}: no YAML file found`));
            continue;
          }

          try {
            const content = readFileSync(yamlPath, 'utf-8');
            const metadata = parseYaml(content) as ListingMetadata;

            const locale = LANGUAGE_MAP[lang] || lang;
            const existing = localisationMap.get(locale);

            console.log(chalk.bold(`\n${lang} (${locale}):`));

            // Build updates object for version-level fields
            // Note: name and subtitle are app-level fields (appInfoLocalizations)
            // and require a different API endpoint
            const updates: Record<string, string> = {};

            if (!options.field || options.field === 'whats_new') {
              if (metadata.whats_new) {
                updates.whatsNew = metadata.whats_new;
              }
            }

            if (metadata.app_info) {
              // These fields are version-level (appStoreVersionLocalizations)
              if (!options.field || options.field === 'promotional_text') {
                if (metadata.app_info.promotional_text) {
                  updates.promotionalText = metadata.app_info.promotional_text;
                }
              }
              if (!options.field || options.field === 'description') {
                if (metadata.app_info.description) {
                  updates.description = metadata.app_info.description;
                }
              }
              if (!options.field || options.field === 'keywords') {
                if (metadata.app_info.keywords) {
                  updates.keywords = metadata.app_info.keywords;
                }
              }

              // Warn about app-level fields that need different handling
              if (!options.field || options.field === 'title') {
                if (metadata.app_info.title) {
                  console.log(chalk.yellow(`  Note: 'title' is an app-level field, not version-level`));
                }
              }
              if (!options.field || options.field === 'subtitle') {
                if (metadata.app_info.subtitle) {
                  console.log(chalk.yellow(`  Note: 'subtitle' is an app-level field, not version-level`));
                }
              }
            }

            if (Object.keys(updates).length === 0) {
              console.log(chalk.gray('  No updates to apply'));
              continue;
            }

            // Show diff
            if (existing) {
              showDiff(
                {
                  whatsNew: existing.whatsNew,
                  name: existing.name,
                  subtitle: existing.subtitle,
                  promotionalText: existing.promotionalText,
                  description: existing.description,
                  keywords: existing.keywords,
                },
                updates
              );

              if (!options.dryRun) {
                await client.updateLocalisation(existing.id, updates);
                console.log(chalk.green('  ✓ Updated'));
                updatedCount++;
              }
            } else {
              console.log(chalk.cyan('  New localisation will be created'));
              for (const [key, value] of Object.entries(updates)) {
                const preview = truncate(value, 60);
                console.log(`    ${chalk.green('+')} ${key}: ${preview}`);
              }

              if (!options.dryRun) {
                await client.createLocalisation(version.id, locale, updates);
                console.log(chalk.green('  ✓ Created'));
                createdCount++;
              }
            }
          } catch (error) {
            console.error(
              chalk.red(`  Error processing ${lang}:`),
              error instanceof Error ? error.message : error
            );
            errorCount++;
          }
        }

        // Summary
        console.log(chalk.blue('\n--- Summary ---'));
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes were made'));
        }
        console.log(`Languages processed: ${languages.length}`);
        if (updatedCount > 0) console.log(chalk.green(`Updated: ${updatedCount}`));
        if (createdCount > 0) console.log(chalk.cyan(`Created: ${createdCount}`));
        if (errorCount > 0) console.log(chalk.red(`Errors: ${errorCount}`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Show listing for language (already in read.ts, but add here for discoverability)
  listingsCmd
    .command('show')
    .description('Show current listing for a language')
    .requiredOption('--lang <language>', 'Language code (e.g., en, de)')
    .option('--version-id <versionId>', 'Specific version ID')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);
        const locale = LANGUAGE_MAP[options.lang] || options.lang;

        let versionId = options.versionId;
        if (!versionId) {
          const editableVersion = await client.getEditableVersion();
          if (!editableVersion) {
            console.log(chalk.yellow('No editable version found.'));
            return;
          }
          versionId = editableVersion.id;
          console.log(chalk.blue(`Version: ${editableVersion.versionString}`));
        }

        const localisation = await client.getLocalisation(versionId, locale);
        if (!localisation) {
          console.log(chalk.yellow(`No localisation found for ${locale}`));
          return;
        }

        console.log(chalk.blue(`\nListing for ${localisation.locale}:`));
        console.log('');
        console.log(chalk.bold('Name:'), localisation.name);
        console.log(chalk.bold('Subtitle:'), localisation.subtitle || '(none)');
        console.log(chalk.bold('Promotional Text:'));
        console.log(indent(localisation.promotionalText || '(none)', 2));
        console.log('');
        console.log(chalk.bold("What's New:"));
        console.log(indent(localisation.whatsNew || '(none)', 2));
        console.log('');
        console.log(chalk.bold('Keywords:'));
        console.log(indent(localisation.keywords || '(none)', 2));
        console.log('');
        console.log(chalk.bold('Description:'));
        console.log(indent(localisation.description || '(none)', 2));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Diff command - compare local YAML with App Store
  listingsCmd
    .command('diff')
    .description('Show differences between local YAML and App Store')
    .option('--all', 'Compare all languages')
    .option('--lang <language>', 'Compare specific language')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const { readFileSync, existsSync, readdirSync } = await import('fs');
        const { join, basename } = await import('path');
        const { parse: parseYaml } = await import('yaml');
        const { getListingsDir } = await import('../paths.js');

        const client = createClient(options.keyId);
        const metadataDir = getListingsDir();

        if (!existsSync(metadataDir)) {
          console.error(chalk.red(`Metadata directory not found: ${metadataDir}`));
          process.exit(1);
        }

        const version = await client.getEditableVersion();
        if (!version) {
          console.log(chalk.yellow('No editable version found.'));
          return;
        }

        console.log(chalk.blue(`Comparing with version: ${version.versionString}\n`));

        let languages: string[] = [];
        if (options.all) {
          const files = readdirSync(metadataDir).filter((f) => f.endsWith('.yaml'));
          languages = files.map((f) => basename(f, '.yaml'));
        } else if (options.lang) {
          languages = [options.lang];
        } else {
          console.error(chalk.red('Please specify --all or --lang <language>'));
          process.exit(1);
        }

        const existingLocalisations = await client.listLocalisations(version.id);
        const localisationMap = new Map(existingLocalisations.map((l) => [l.locale, l]));

        let totalDiffs = 0;

        for (const lang of languages) {
          const yamlPath = join(metadataDir, `${lang}.yaml`);
          if (!existsSync(yamlPath)) continue;

          const content = readFileSync(yamlPath, 'utf-8');
          const metadata = parseYaml(content) as ListingMetadata;
          const locale = LANGUAGE_MAP[lang] || lang;
          const existing = localisationMap.get(locale);

          const diffs: string[] = [];

          if (!existing) {
            console.log(chalk.bold(`\n${lang} (${locale}):`));
            console.log(chalk.cyan('  New localisation (not in App Store)'));
            totalDiffs++;
            continue;
          }

          // Compare fields
          if (metadata.whats_new && metadata.whats_new !== existing.whatsNew) {
            diffs.push('whatsNew');
          }
          if (metadata.app_info) {
            if (metadata.app_info.title && metadata.app_info.title !== existing.name) {
              diffs.push('name');
            }
            if (metadata.app_info.subtitle && metadata.app_info.subtitle !== existing.subtitle) {
              diffs.push('subtitle');
            }
            if (
              metadata.app_info.promotional_text &&
              metadata.app_info.promotional_text !== existing.promotionalText
            ) {
              diffs.push('promotionalText');
            }
            if (
              metadata.app_info.description &&
              metadata.app_info.description !== existing.description
            ) {
              diffs.push('description');
            }
            if (metadata.app_info.keywords && metadata.app_info.keywords !== existing.keywords) {
              diffs.push('keywords');
            }
          }

          if (diffs.length > 0) {
            console.log(chalk.bold(`\n${lang} (${locale}):`));
            console.log(chalk.yellow(`  Changed fields: ${diffs.join(', ')}`));
            totalDiffs++;
          }
        }

        if (totalDiffs === 0) {
          console.log(chalk.green('No differences found.'));
        } else {
          console.log(chalk.blue(`\n--- ${totalDiffs} language(s) have differences ---`));
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

function showDiff(
  existing: { [key: string]: string | undefined },
  updates: Record<string, string>
): void {
  for (const [key, newValue] of Object.entries(updates)) {
    const existingKey = key as keyof typeof existing;
    const oldValue = existing[existingKey] || '';

    if (oldValue !== newValue) {
      console.log(chalk.yellow(`  ${key}:`));
      if (oldValue) {
        console.log(chalk.red(`    - ${truncate(oldValue, 60)}`));
      }
      console.log(chalk.green(`    + ${truncate(newValue, 60)}`));
    } else {
      console.log(chalk.gray(`  ${key}: (unchanged)`));
    }
  }
}

function truncate(text: string, maxLength: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim();
  if (oneLine.length <= maxLength) return oneLine;
  return oneLine.substring(0, maxLength - 3) + '...';
}

function indent(text: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}
