#!/usr/bin/env node

/**
 * App Store Connect MCP server.
 *
 * Bundled with the appstore-cli package — same code paths as the
 * CLI, exposed over the Model Context Protocol so an agent can
 * read/list/update App Store Connect state without shelling out.
 *
 * Install + register:
 *
 *   npm install -g appstore-cli
 *   claude mcp add appstore appstore-mcp
 *
 * Or from a local checkout:
 *
 *   appstore-cli/build/mcp/server.js
 *
 * Auth + paths come from the same `appstore-config.yaml` and
 * `appstore-cli.config.yaml` the CLI reads. See README for setup.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { createClient } from '../client.js';

const server = new Server(
  {
    name: 'appstore-cli',
    version: '1.0.0',
  },
  {
    capabilities: { tools: {} },
  },
);

// ============================================================================
// Tool definitions
// ============================================================================
//
// Tool names match the existing in-tree sudoku-mcp wrappers so a project
// migrating to this standalone server doesn't have to rename anything.

const TOOLS = [
  {
    name: 'appstore_get_app_info',
    description:
      'Get basic app information. Returns bundle ID, name, SKU, primary locale, available territories.',
    inputSchema: {
      type: 'object',
      properties: {
        keyName: { type: 'string', description: 'Key name from config (default: config default_key).' },
      },
    },
  },
  {
    name: 'appstore_list_versions',
    description: 'List all app versions. Returns version IDs, version strings, platforms, states, creation dates.',
    inputSchema: {
      type: 'object',
      properties: {
        keyName: { type: 'string', description: 'Key name from config (default: config default_key).' },
      },
    },
  },
  {
    name: 'appstore_list_localisations',
    description:
      'List localisations for an app version. Returns locale-specific metadata: name, subtitle, description, keywords, whatsNew, promotionalText.',
    inputSchema: {
      type: 'object',
      properties: {
        versionId: { type: 'string', description: 'Version ID to list localisations for.' },
        locales: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific locales (e.g., ["en-GB", "de-DE"]). Omit for all.',
        },
        summary: {
          type: 'boolean',
          description: 'Return ✓/empty indicators per field instead of full content (saves context).',
        },
        truncateLength: {
          type: 'number',
          description: 'Truncate long fields to this length. 0 / omitted = no truncation.',
        },
        keyName: { type: 'string', description: 'Key name from config.' },
      },
      required: ['versionId'],
    },
  },
  {
    name: 'appstore_show_listing',
    description: 'Show the current listing for one locale on the editable version.',
    inputSchema: {
      type: 'object',
      properties: {
        locale: { type: 'string', description: "Locale code (e.g., 'en-US')." },
        versionId: { type: 'string', description: 'Specific version ID (optional).' },
        keyName: { type: 'string', description: 'Key name from config.' },
      },
      required: ['locale'],
    },
  },
  {
    name: 'appstore_update_listing',
    description:
      'Update one locale on the editable version (PREPARE_FOR_SUBMISSION or DEVELOPER_REJECTED). Only the supplied fields are touched.',
    inputSchema: {
      type: 'object',
      properties: {
        locale: { type: 'string', description: "Locale code (e.g., 'en-US')." },
        name: { type: 'string', description: 'App name.' },
        subtitle: { type: 'string', description: 'App subtitle.' },
        description: { type: 'string', description: 'Full description.' },
        keywords: { type: 'string', description: 'Keywords (comma-separated).' },
        whatsNew: { type: 'string', description: "What's new text." },
        promotionalText: { type: 'string', description: 'Promotional text.' },
        versionId: { type: 'string', description: 'Specific version ID (optional).' },
        keyName: { type: 'string', description: 'Key name from config.' },
      },
      required: ['locale'],
    },
  },
  {
    name: 'appstore_list_iap',
    description: 'List all in-app purchases. Returns product IDs, reference names, states, types.',
    inputSchema: {
      type: 'object',
      properties: { keyName: { type: 'string', description: 'Key name from config.' } },
    },
  },
  {
    name: 'appstore_list_subscriptions',
    description: 'List all subscription groups. Returns group IDs and reference names.',
    inputSchema: {
      type: 'object',
      properties: { keyName: { type: 'string', description: 'Key name from config.' } },
    },
  },
  {
    name: 'appstore_list_pages',
    description: 'List all custom product pages. Returns page IDs, names, URLs, visibility.',
    inputSchema: {
      type: 'object',
      properties: { keyName: { type: 'string', description: 'Key name from config.' } },
    },
  },
  {
    name: 'appstore_screenshot_summary',
    description: 'Per-locale × per-device screenshot counts for the editable version.',
    inputSchema: {
      type: 'object',
      properties: {
        versionId: { type: 'string', description: 'Specific version ID (optional).' },
        keyName: { type: 'string', description: 'Key name from config.' },
      },
    },
  },
] as const;

// ============================================================================
// Handlers
// ============================================================================

function ok(data: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function truncate(text: string | undefined | null, max: number): string {
  if (!text || max <= 0) return text ?? '';
  return text.length <= max ? text : text.slice(0, max - 3) + '...';
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const keyName = (args as any).keyName as string | undefined;

  switch (name) {
    case 'appstore_get_app_info': {
      const client = createClient(keyName);
      const info = await client.getAppInfo();
      return ok(info);
    }

    case 'appstore_list_versions': {
      const client = createClient(keyName);
      const versions = await client.listVersions();
      return ok({ versions });
    }

    case 'appstore_list_localisations': {
      const client = createClient(keyName);
      const versionId = (args as any).versionId as string;
      const locales = (args as any).locales as string[] | undefined;
      const summary = (args as any).summary as boolean | undefined;
      const truncateLength = (args as any).truncateLength as number | undefined;

      let localisations = await client.listLocalisations(versionId);
      if (locales && locales.length > 0) {
        const wanted = new Set(locales);
        localisations = localisations.filter((l) => wanted.has(l.locale));
      }

      if (summary) {
        const rows = localisations.map((l) => ({
          locale: l.locale,
          name: l.name ? '✓' : '',
          subtitle: l.subtitle ? '✓' : '',
          description: l.description ? '✓' : '',
          keywords: l.keywords ? '✓' : '',
          promotionalText: l.promotionalText ? '✓' : '',
          whatsNew: l.whatsNew ? '✓' : '',
        }));
        return ok({ localisations: rows });
      }

      const rows = localisations.map((l) => ({
        ...l,
        ...(truncateLength && truncateLength > 0 && {
          description: truncate(l.description, truncateLength),
          keywords: truncate(l.keywords, truncateLength),
          whatsNew: truncate(l.whatsNew, truncateLength),
          promotionalText: truncate(l.promotionalText, truncateLength),
        }),
      }));
      return ok({ localisations: rows });
    }

    case 'appstore_show_listing': {
      const client = createClient(keyName);
      const locale = (args as any).locale as string;
      const versionId = (args as any).versionId as string | undefined
        ?? (await client.getEditableVersion())?.id;
      if (!versionId) {
        throw new Error('No editable version found and no --versionId supplied.');
      }
      const listing = await client.getLocalisation(versionId, locale);
      if (!listing) {
        throw new Error(`No listing for locale ${locale} on version ${versionId}.`);
      }
      return ok(listing);
    }

    case 'appstore_update_listing': {
      const client = createClient(keyName);
      const locale = (args as any).locale as string;
      const versionId = (args as any).versionId as string | undefined
        ?? (await client.getEditableVersion())?.id;
      if (!versionId) {
        throw new Error('No editable version found and no --versionId supplied.');
      }
      const live = await client.getLocalisation(versionId, locale);
      if (!live) {
        throw new Error(`No listing for locale ${locale} on version ${versionId}.`);
      }
      // Only forward fields the caller actually supplied — the API
      // treats undefined as "don't touch".
      const patch: Record<string, string> = {};
      for (const f of ['name', 'subtitle', 'description', 'keywords', 'whatsNew', 'promotionalText'] as const) {
        const v = (args as any)[f];
        if (typeof v === 'string') patch[f] = v;
      }
      await client.updateLocalisation(live.id, patch);
      return ok({ updated: true, localisationId: live.id, fields: Object.keys(patch) });
    }

    case 'appstore_list_iap': {
      const client = createClient(keyName);
      const purchases = await client.listInAppPurchases();
      const rows = purchases.map((p: any) => ({
        id: p.id,
        productId: p.attributes?.productId,
        name: p.attributes?.name,
        state: p.attributes?.state,
        type: p.attributes?.inAppPurchaseType,
      }));
      return ok({ purchases: rows });
    }

    case 'appstore_list_subscriptions': {
      const client = createClient(keyName);
      const groups = await client.listSubscriptions();
      const rows = groups.map((g: any) => ({
        id: g.id,
        referenceName: g.attributes?.referenceName,
      }));
      return ok({ subscriptionGroups: rows });
    }

    case 'appstore_list_pages': {
      const client = createClient(keyName);
      const pages = await client.listCustomProductPages();
      return ok({ pages });
    }

    case 'appstore_screenshot_summary': {
      const client = createClient(keyName);
      const versionId = (args as any).versionId as string | undefined
        ?? (await client.getEditableVersion())?.id;
      if (!versionId) {
        throw new Error('No editable version found and no --versionId supplied.');
      }
      // Walk each localisation, list its screenshot sets + count per
      // set. Cheap-ish — one network call per locale, but bounded.
      const localisations = await client.listLocalisations(versionId);
      const matrix: Array<{ locale: string; sets: Array<{ deviceType: string; count: number }> }> = [];
      for (const l of localisations) {
        const sets = await client.listScreenshotSets(l.id);
        const setRows = await Promise.all(
          sets.map(async (s: any) => {
            const shots = await client.listScreenshots(s.id);
            return { deviceType: s.attributes?.screenshotDisplayType ?? '', count: shots.length };
          }),
        );
        matrix.push({ locale: l.locale, sets: setRows });
      }
      return ok({ matrix });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ============================================================================
// Bootstrap
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr-only — stdout is the MCP transport.
  process.stderr.write('appstore-cli MCP server running on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`appstore-mcp fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
