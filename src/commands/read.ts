/**
 * Read Commands
 *
 * Commands for reading App Store Connect data (versions, localisations, etc.)
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';
import { LOCALE_TO_SHORT } from '../types.js';

export function registerReadCommands(program: Command): void {
  // Versions
  program
    .command('versions')
    .description('List app versions')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);
        const versions = await client.listVersions();

        if (versions.length === 0) {
          console.log('No versions found.');
          return;
        }

        console.log(chalk.blue('App Versions:'));
        console.log('');

        for (const version of versions) {
          const stateColor = getStateColor(version.state);
          const platformLabel = getPlatformLabel(version.platform);
          console.log(`  ${chalk.bold(version.versionString)} (${chalk.cyan(platformLabel)}) - ${stateColor(version.state)}`);
          console.log(`    ID: ${version.id}`);
          console.log(`    Created: ${version.createdDate}`);
          console.log('');
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Localisations
  program
    .command('localisations')
    .alias('localizations')
    .description('List localisations for the latest editable version')
    .option('--version-id <versionId>', 'Specific version ID')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);

        let versionId = options.versionId;
        if (!versionId) {
          const editableVersion = await client.getEditableVersion();
          if (!editableVersion) {
            console.log(chalk.yellow('No editable version found.'));
            console.log('Use --version-id to specify a version.');
            return;
          }
          versionId = editableVersion.id;
          console.log(chalk.blue(`Using version: ${editableVersion.versionString}`));
        }

        const localisations = await client.listLocalisations(versionId);

        if (localisations.length === 0) {
          console.log('No localisations found.');
          return;
        }

        console.log(chalk.blue('\nLocalisations:'));
        console.log('');

        for (const loc of localisations) {
          console.log(`  ${chalk.bold(loc.locale)} - ${loc.name || '(no name)'}`);
          console.log(`    ID: ${loc.id}`);
          if (loc.subtitle) console.log(`    Subtitle: ${loc.subtitle}`);
          console.log('');
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Export to YAML
  program
    .command('export')
    .description('Export current App Store state to YAML files')
    .requiredOption('--output <directory>', 'Output directory')
    .option('--version-id <versionId>', 'Specific version ID')
    .option('--platform <platform>', 'Target platform: ios, macos')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const { mkdirSync, writeFileSync } = await import('fs');
        const { join } = await import('path');
        const { stringify } = await import('yaml');

        const client = createClient(options.keyId);

        // Create output directory
        mkdirSync(options.output, { recursive: true });
        mkdirSync(join(options.output, 'listings'), { recursive: true });

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

          if (options.platform && !targetPlatform) {
            console.error(chalk.red(`Unknown platform: ${options.platform}. Use: ios, macos`));
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
            return;
          }
        }

        console.log(chalk.blue(`Exporting version ${version.versionString}...`));

        // Export localisations
        const localisations = await client.listLocalisations(version.id);

        for (const loc of localisations) {
          const yamlData = {
            whats_new: loc.whatsNew || '',
            app_info: {
              title: loc.name || '',
              subtitle: loc.subtitle || '',
              promotional_text: loc.promotionalText || '',
              description: loc.description || '',
              keywords: loc.keywords || '',
            },
          };

          // Use short locale name for filename (e.g., 'en' instead of 'en-GB')
          const shortLocale = LOCALE_TO_SHORT[loc.locale] || loc.locale;
          const filename = `${shortLocale}.yaml`;
          const filepath = join(options.output, 'listings', filename);
          writeFileSync(filepath, stringify(yamlData));
          console.log(`  Exported: ${filename}`);
        }

        // Export version info
        const versionInfo = {
          version: version.versionString,
          state: version.state,
          id: version.id,
          exported_at: new Date().toISOString(),
        };
        writeFileSync(
          join(options.output, 'version.yaml'),
          stringify(versionInfo)
        );

        console.log(chalk.green(`\n✓ Export complete: ${options.output}`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

function getStateColor(state: string): (s: string) => string {
  switch (state) {
    case 'PREPARE_FOR_SUBMISSION':
      return chalk.yellow;
    case 'WAITING_FOR_REVIEW':
      return chalk.blue;
    case 'IN_REVIEW':
      return chalk.cyan;
    case 'READY_FOR_SALE':
      return chalk.green;
    case 'DEVELOPER_REJECTED':
      return chalk.red;
    case 'REJECTED':
      return chalk.red;
    default:
      return chalk.gray;
  }
}

function getPlatformLabel(platform: string): string {
  switch (platform) {
    case 'IOS':
      return 'iOS';
    case 'MAC_OS':
      return 'macOS';
    case 'TV_OS':
      return 'tvOS';
    case 'VISION_OS':
      return 'visionOS';
    default:
      return platform || 'Unknown';
  }
}

function indent(text: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return text.split('\n').map(line => prefix + line).join('\n');
}
