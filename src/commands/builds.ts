/**
 * Build Commands
 *
 * Commands for listing builds, beta tester groups, and promoting
 * builds to external tester groups in TestFlight.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';

export function registerBuildsCommands(program: Command): void {
  const buildsCmd = program.command('builds').description('Manage builds and TestFlight beta groups');

  // List recent builds
  buildsCmd
    .command('list')
    .description('List recent builds')
    .option('--limit <n>', 'Maximum number of builds to show', '10')
    .option('--version <string>', 'Filter by version string')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);
        const builds = await client.listBuilds({
          limit: parseInt(options.limit, 10),
          version: options.version,
        });

        if (builds.length === 0) {
          console.log('No builds found.');
          return;
        }

        console.log(chalk.bold('Recent Builds:\n'));

        for (const build of builds) {
          const stateColour = build.processingState === 'VALID'
            ? chalk.green
            : build.processingState === 'PROCESSING'
              ? chalk.yellow
              : chalk.red;

          console.log(`  ${chalk.bold(build.version)} (${chalk.cyan(build.platform)}) - ${stateColour(build.processingState)}`);
          console.log(`    ID: ${build.id}`);
          console.log(`    Uploaded: ${build.uploadedDate}`);
          console.log('');
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // List beta tester groups
  buildsCmd
    .command('groups')
    .description('List TestFlight beta tester groups')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);
        const groups = await client.listBetaGroups();

        if (groups.length === 0) {
          console.log('No beta groups found.');
          return;
        }

        console.log(chalk.bold('Beta Tester Groups:\n'));

        for (const group of groups) {
          const typeLabel = group.isInternalGroup ? chalk.cyan('internal') : chalk.green('external');
          const linkLabel = group.publicLinkEnabled ? chalk.green('public link enabled') : '';

          console.log(`  ${chalk.bold(group.name)} (${typeLabel}) ${linkLabel}`);
          console.log(`    ID: ${group.id}`);
          console.log('');
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // List builds in a beta group
  buildsCmd
    .command('group-builds')
    .description('List builds assigned to a beta group')
    .requiredOption('--group <id>', 'Beta group ID')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);
        const builds = await client.getBetaGroupBuilds(options.group);

        if (builds.length === 0) {
          console.log('No builds in this group.');
          return;
        }

        console.log(chalk.bold('Builds in Group:\n'));

        for (const build of builds) {
          console.log(`  ${chalk.bold(build.version)} - ${build.processingState}`);
          console.log(`    ID: ${build.id}`);
          console.log(`    Uploaded: ${build.uploadedDate}`);
          console.log('');
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Promote build to a beta group
  buildsCmd
    .command('promote')
    .description('Add a build to a TestFlight beta tester group')
    .requiredOption('--group <nameOrId>', 'Beta group name or ID')
    .option('--build-id <id>', 'Build ID (defaults to latest processed build)')
    .option('--notes <text>', 'What to Test notes (required for external groups)')
    .option('--dry-run', 'Show what would happen without making changes')
    .option('--yes', 'Skip confirmation prompt')
    .option('--key-id <keyId>', 'Use specific auth key')
    .action(async (options) => {
      try {
        const client = createClient(options.keyId);

        // Resolve beta group
        const groups = await client.listBetaGroups();
        const group = groups.find(
          (g) => g.id === options.group || g.name.toLowerCase() === options.group.toLowerCase()
        );

        if (!group) {
          console.error(chalk.red(`Beta group not found: ${options.group}`));
          console.log('\nAvailable groups:');
          for (const g of groups) {
            const typeLabel = g.isInternalGroup ? 'internal' : 'external';
            console.log(`  ${g.name} (${typeLabel}) - ID: ${g.id}`);
          }
          process.exit(1);
        }

        // Resolve build
        let buildId = options.buildId;
        let buildVersion = '';

        if (!buildId) {
          const builds = await client.listBuilds({ limit: 5 });
          const validBuild = builds.find((b) => b.processingState === 'VALID');

          if (!validBuild) {
            console.error(chalk.red('No valid (processed) builds found.'));
            console.log('Recent builds:');
            for (const b of builds) {
              console.log(`  ${b.version} - ${b.processingState} (ID: ${b.id})`);
            }
            process.exit(1);
          }

          buildId = validBuild.id;
          buildVersion = validBuild.version;
        }

        // For external groups, test notes are required
        const testNotes = options.notes;
        if (!group.isInternalGroup && !testNotes) {
          console.error(chalk.red('Test notes are required for external groups.'));
          console.log('Use --notes "What to test in this build"');
          process.exit(1);
        }

        // Confirm
        const typeLabel = group.isInternalGroup ? 'internal' : 'external';
        console.log(chalk.bold('\nBuild Promotion:'));
        console.log(`  Build: ${buildVersion || buildId}`);
        console.log(`  Group: ${group.name} (${typeLabel})`);
        console.log(`  Group ID: ${group.id}`);
        if (testNotes) {
          console.log(`  Test notes: ${testNotes.substring(0, 80)}${testNotes.length > 80 ? '...' : ''}`);
        }
        if (!group.isInternalGroup) {
          console.log(chalk.cyan('  → Will set beta build notes and submit for beta review'));
        }

        if (options.dryRun) {
          console.log(chalk.yellow('\n[Dry run] No changes made.'));
          return;
        }

        if (!options.yes) {
          const readline = await import('readline');
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise<string>((resolve) => {
            rl.question(chalk.yellow('\nProceed? (y/N) '), resolve);
          });
          rl.close();

          if (answer.toLowerCase() !== 'y') {
            console.log('Cancelled.');
            return;
          }
        }

        // For external groups: set test notes and submit for beta review
        if (!group.isInternalGroup) {
          if (testNotes) {
            console.log('Setting beta build notes...');
            await client.setBetaBuildNotes(buildId, 'en-GB', testNotes);
            console.log(chalk.green('  ✓ Test notes set'));
          }

          console.log('Submitting for beta app review...');
          await client.submitForBetaReview(buildId);
          console.log(chalk.green('  ✓ Submitted for beta review'));
        }

        await client.addBuildToBetaGroup(group.id, buildId);
        console.log(chalk.green(`\n✓ Build added to ${group.name}`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
