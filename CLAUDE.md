# appstore-cli — Agent Notes

Working on the CLI or the bundled MCP server. Stays here when this package is in a monorepo; ports cleanly when extracted to its own repo.

## What this package is

A TypeScript CLI + MCP server for App Store Connect. Two binaries from one codebase:

- `appstore` — interactive CLI (commander.js)
- `appstore-mcp` — Model Context Protocol server (stdio)

Both wrap `src/client.ts`, which wraps the [`appstore-connect-sdk`](https://www.npmjs.com/package/appstore-connect-sdk) (Apple's official OpenAPI surface).

## Layout

| Module | Purpose |
|---|---|
| `src/index.ts` | CLI entry — registers commands from `commands/` |
| `src/auth.ts` | Loads `appstore-config.yaml`, builds JWT auth context |
| `src/client.ts` | All SDK calls. Single source of truth for ASC operations |
| `src/project.ts` | `getProjectRoot()` / `getWorktreeRoot()` via git |
| `src/paths.ts` | Configurable path resolver (`getIapYamlPath()` etc.) |
| `src/types.ts` | YAML schema types (IAPMetadata, ListingMetadata, etc.) |
| `src/commands/` | One file per command group: listings, iap, screenshots, previews, custom-pages, builds, read |
| `src/mcp/server.ts` | MCP server — reuses `client.ts`, no duplication |

## Rules

1. **`src/client.ts` is the only file that calls the SDK.** Add new ops there, not inside command files.
2. **Don't shell out from the MCP server.** Import `createClient` and call its methods directly. The in-tree wrappers in some downstream projects do shell out; that's a separate compatibility layer, not the pattern for this package.
3. **All path resolution goes through `paths.ts`.** Never hardcode `l10n/metadata/apple/...` — use `getIapYamlPath()`, `getListingsDir()`, `getListingPath(locale)`, `getScreenshotsOrderPath()`. The defaults match Lazy Sudoku's layout, but downstream projects override via `appstore-cli.config.yaml`.
4. **Don't import from `auth.ts` for git roots.** Use `project.ts` directly to avoid circular imports.
5. **Dry-run is the default for destructive operations.** `iap migrate-prices` requires `--confirm`; `iap sync` accepts `--dry-run` for the safe path. Match this when adding new write commands.
6. **YAML is the source of truth.** `iap export` overwrites the file. `iap pull` is the additive merge — it never overwrites local values, only fills gaps. Pick the right one when writing.
7. **British spelling throughout** (colour, localisation, etc.). Apple's API uses American (`localization`, `color`); convert at the boundary.

## How adding a new command goes

Example: a new `appstore iap deactivate <productId>` command.

1. **Add the client method** in `src/client.ts`:
   ```ts
   async deactivateInAppPurchase(iapId: string): Promise<void> {
     const resp = await inAppPurchasesPatchInstance({
       client: this.client,
       path: { id: iapId },
       body: { data: { id: iapId, type: 'inAppPurchases', attributes: { state: 'REMOVED_FROM_SALE' } } } as any,
     });
     throwIfError(resp);
   }
   ```
2. **Wire the CLI command** in `src/commands/iap.ts`:
   ```ts
   iapCmd
     .command('deactivate <productId>')
     .description('Mark an IAP as removed-from-sale')
     .option('--confirm', 'Actually fire the call (default: dry-run)')
     .action(async (productId, options) => { ... });
   ```
3. **(Optional) Expose via MCP** in `src/mcp/server.ts` — add to the `TOOLS` array and a handler case. Same client method, no shelling.
4. **Verify**:
   - `npx tsc --noEmit`
   - Run the CLI with `--dry-run` against live ASC
   - For MCP, smoke-test with stdio echo:
     ```bash
     printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}' \
                   '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
                   '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"appstore_iap_deactivate","arguments":{"productId":"foo"}}}' \
     | node build/mcp/server.js
     ```

## How adding a new config knob goes

If you need a new configurable path (e.g. `previews_dir`):

1. Add the field to `PathsConfig` in `src/paths.ts`.
2. Add a resolver function (`getPreviewsDir()`) that follows the env > file > default precedence.
3. Update [`docs/auth.md`](docs/auth.md) (env var) and the [README](README.md) (config table).
4. Use it in the relevant command file via `await import('../paths.js')`.

## Testing

- **No unit tests yet.** Smoke against live ASC via `--dry-run` flags.
- **Typecheck** is the build gate: `npx tsc --noEmit` runs cleanly on master.
- **MCP smoke** — see the stdio echo snippet above; `tools/list` returns the schema array, `tools/call` returns content.

## Documentation that lives in `docs/`

| File | Topic |
|---|---|
| `auth.md` | API key creation, JWT scopes, key rotation |
| `workflow.md` | Export → edit → sync → pull loop with examples |
| `iap-schema.md` | YAML schema for `iap.yaml` (purchases + subscriptions + groups + intro offers + review screenshots) |
| `listings-schema.md` | YAML schema for `listings/<lang>.yaml` (whats_new, app_info, keywords format) |
| `quirks.md` | Apple-side gotchas the CLI works around |

Keep them in sync with the code. When you change a schema, update the doc in the same commit.

## What NOT to touch without thinking hard

- **`auth.ts` JWT generation** — getting this wrong silently produces 401s on every call.
- **`commands/iap.ts` deep-diff walker** — there's a recursive walker with array-id matching (intro_offers by tuple, territories by set). The shape lets one-territory price changes render as a single line; breaking it floods the diff.
- **`paths.ts` resolution order** — env wins over file wins over default. Don't reverse this; downstream users rely on env-overrides for CI.

## When extracted to its own repo

The extraction is a `git filter-branch --subdirectory-filter tools/appstore-cli` (or `git subtree split`). The package is self-contained:

- No imports from outside `tools/appstore-cli/`.
- Auth + paths configurable via files in any git repo.
- README + this CLAUDE.md travel with it.
- The bundled MCP makes the package useful as a standalone tool from day one — no separate "MCP package" needed.

After extraction, drop this monorepo-specific paragraph and rewrite the "downstream" framing in the README to "for use in any iOS/Apple app project".
