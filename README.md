# appstore-cli

A CLI + bundled MCP server for managing **App Store Connect** metadata, screenshots, and in-app purchases from YAML files. Designed for teams that want their store listing under version control instead of click-driven through the App Store Connect website.

What it does:

- Pull every per-locale listing, IAP, subscription, custom-product-page, and screenshot summary into committed YAML.
- Push YAML edits back to ASC: localised copy, prices, availability, subscription intro offers, review screenshots.
- Create new IAPs and subscriptions from YAML.
- Two-way reconcile: pull live state into committed YAML without overwriting hand-edits; field-level diff with paths like `subscriptions/my_sub/intro_offers/FREE_TRIAL+ONE_WEEK+1+__global/start_date`.
- Migrate existing subscribers when a price changes.

Same code is exposed as an [MCP server](#mcp-server) so an agent can read/list/update store state without shelling out.

> Originally extracted from a working Lazy Sudoku setup. Defaults match that layout (`.secret-stuff/` + `l10n/metadata/apple/`); downstream projects can either adopt the same conventions (no config needed) or override via `appstore-cli.config.yaml` / env vars — see [Configuration](#configuration).

## Install

```bash
npm install -g appstore-cli
# or, from a checkout
cd appstore-cli && npm install && npm run build && npm link
```

## Authentication

You need an [App Store Connect API key](https://appstoreconnect.apple.com/access/api). The `.p8` file plus the issuer ID + app ID go in a config file:

```yaml
# .secret-stuff/appstore-config.yaml (gitignored — never commit)
issuer_id: "8a8a8a8a-1234-5678-9abc-def012345678"
app_id: "1234567890"

keys:
  app_manager:
    key_id: "ABCDE12345"
    key_file: "AuthKey_ABCDE12345.p8"
  build_upload:
    key_id: "FGHIJ67890"
    key_file: "AuthKey_FGHIJ67890.p8"

default_key: "app_manager"
```

Multiple keys let you separate concerns (one for build uploads, one for metadata edits). Pick a non-default key per call with `--key-id`.

See [docs/auth.md](docs/auth.md) for key creation and the JWT lifecycle.

## Configuration

The defaults match the layout this tool was extracted from:

| What | Default | Where |
|---|---|---|
| Secrets directory | `.secret-stuff/` at project root | Holds `appstore-config.yaml` + `.p8` files |
| Metadata directory | `l10n/metadata/apple/` at worktree root | Holds `listings/<lang>.yaml`, `iap.yaml`, `screenshots/order.yaml` |

To override, drop an `appstore-cli.config.yaml` at the worktree root (preferred) or project root:

```yaml
# appstore-cli.config.yaml
secrets_dir:  config/appstore-secrets     # relative to project root
metadata_dir: store-metadata/apple        # relative to worktree root
```

Env vars win over the file:

```bash
APPSTORE_SECRETS_DIR=/path/to/secrets
APPSTORE_METADATA_DIR=/path/to/metadata
```

The CLI uses git to find the project root (so secrets live with the main repo, not in worktrees) and the worktree root (so per-branch metadata edits stay local).

## Quickstart

```bash
# 1. Pull current ASC state into YAML
appstore iap export --output l10n/metadata/apple/iap.yaml

# 2. Edit the YAML in your editor
$EDITOR l10n/metadata/apple/iap.yaml

# 3. Preview the push
appstore iap sync --dry-run

# 4. Push
appstore iap sync
```

Same flow for listings:

```bash
appstore listings update --all --dry-run
appstore listings update --all
```

See [docs/workflow.md](docs/workflow.md) for the full export → edit → sync → pull loop.

## Commands

### App + version info

```bash
appstore info                                       # bundle ID, name, SKU, primary locale
appstore versions list                              # all app versions
```

### Listings

```bash
appstore listings list --version-id X
appstore listings show --lang en-GB
appstore listings update --all [--dry-run]
appstore listings update --lang en-GB --field whats_new
appstore listings diff                              # YAML vs live
```

### In-App Purchases + subscriptions

```bash
appstore iap list                                              # quick stats
appstore iap show <productId>                                  # full detail
appstore iap export --output l10n/metadata/apple/iap.yaml      # overwrites file
appstore iap sync [--product-id X] [--dry-run]                 # YAML → ASC
appstore iap create [--product-id X] [--dry-run]               # provision new
appstore iap pull [--product-id X] [--dry-run]                 # ASC → YAML (additive)
appstore iap diff [--product-id X]                             # field-level divergence
appstore iap migrate-prices --product-id X [--territory T] [--confirm]
```

Subscriptions, subscription groups, intro offers, review screenshots all round-trip through `iap.yaml`. See [docs/iap-schema.md](docs/iap-schema.md) for the YAML schema.

### Screenshots

```bash
appstore screenshots list --lang en-GB
appstore screenshots upload --source ./shots --lang en-GB --mode replace
appstore screenshots upload --source ./shots --all --mode replace
appstore screenshots reorder --all
```

Modes: `replace` (drop + re-upload), `add` (append), `reorder` (no upload, reorder existing).

### Custom Product Pages

```bash
appstore pages list
```

### App Previews (video)

```bash
appstore previews list --lang en-GB
appstore previews upload --source ./reels --lang en-GB
```

## MCP Server

The package ships a bundled MCP server (`appstore-mcp`) using the same client code as the CLI. Any MCP-aware agent — Claude Code, Cursor, Windsurf, Cline, Continue, Zed — can talk to it over stdio.

### Prerequisites

`appstore-mcp` must be on `$PATH`. The [Install](#install) step puts it there (either `npm install -g appstore-cli` or `npm link` from a checkout). Verify:

```bash
which appstore-mcp
```

If you'd rather not install globally, register an absolute path instead — see below.

### Register with Claude Code

```bash
# Run from the project whose store listing you manage — that becomes the
# server's working directory, which is where config + metadata YAMLs are
# resolved from. See "Working directory and auth" below.
claude mcp add appstore appstore-mcp
```

`claude mcp add` defaults to **local** scope (your account, this directory). Pick the scope that fits:

| Scope | Where it's stored | Use when |
|---|---|---|
| `--scope local` (default) | `~/.claude.json`, keyed by cwd | Personal experiments in one repo |
| `--scope project` | `<repo>/.mcp.json` (committed) | Everyone in the repo gets it |
| `--scope user` | `~/.claude.json` global | You want it everywhere |

If you skipped `npm link`, register the build output directly:

```bash
claude mcp add appstore node /absolute/path/to/appstore-cli/build/mcp/server.js
```

### Register with other MCP clients

Clients that read a JSON config (Cursor, Windsurf, Cline, Continue, Zed, …) take this shape. Point `command` at the binary on `$PATH`, or use an absolute path:

```json
{
  "mcpServers": {
    "appstore": {
      "command": "appstore-mcp"
    }
  }
}
```

Consult your client's docs for *where* this config file lives — common paths are `~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, or a workspace-level file.

### Working directory and auth

The MCP server inherits its **working directory** from the client that spawns it. Path resolution (where `appstore-config.yaml` and metadata YAMLs live) starts from `git rev-parse --show-toplevel` of that cwd, with one refinement: when the server detects it's running inside a git submodule (via `git rev-parse --show-superproject-working-tree`), it resolves paths against the parent worktree instead of the submodule's own root.

Practical implications:

- Launch your MCP client from the repo whose store listing you manage. The server then finds `.secret-stuff/appstore-config.yaml` and the metadata YAMLs from there.
- If your client launches from somewhere else, override paths via env vars passed through the client config:

```json
{
  "mcpServers": {
    "appstore": {
      "command": "appstore-mcp",
      "env": {
        "APPSTORE_SECRETS_DIR": "/abs/path/to/secrets",
        "APPSTORE_METADATA_DIR": "/abs/path/to/metadata"
      }
    }
  }
}
```

See [Configuration](#configuration) for the full env var list.

### Verify

```bash
claude mcp list
```

Then in a session, ask the agent to call `appstore_get_app_info` — the first tool call confirms wiring. An "auth failed" error means wiring is fine and you just need a valid `appstore-config.yaml`.

### Tools exposed

| Tool | Description |
|---|---|
| `appstore_get_app_info` | Bundle ID, name, SKU, primary locale, relationships |
| `appstore_list_versions` | All app versions |
| `appstore_list_localisations` | Per-locale metadata (with `locales` filter + `summary` + `truncateLength`) |
| `appstore_show_listing` | One locale on the editable version |
| `appstore_update_listing` | Patch one locale's fields (only supplied fields touched) |
| `appstore_list_iap` | All in-app purchases |
| `appstore_list_subscriptions` | All subscription groups |
| `appstore_list_pages` | All custom product pages |
| `appstore_screenshot_summary` | Per-locale × per-device screenshot counts |

Auth + paths come from the same config files as the CLI; no separate setup.

## Key selection

Priority order:

1. `--key-id <name>` flag
2. `APPSTORE_KEY_ID` env var
3. `default_key` from the config file

```bash
# Use a specific key
appstore versions list --key-id build_upload
```

## Apple quirks worth knowing

The Apple side has several non-obvious gotchas the CLI works around. Captured in [docs/quirks.md](docs/quirks.md):

- **Edit sessions are listings-only.** IAPs and subscriptions skip the session.
- **`preserveCurrentPrice` is the migration discriminator.** `iap sync` writes `true` (new subscribers only); `iap migrate-prices` writes `false` (existing too).
- **Subscription price points are per-territory.** No "auto-equalise everywhere" call — the anchor migration only affects the anchor's territory.
- **Apple chooses the consent flow from the price delta.** Decreases auto-apply; increases trigger Apple's notification + opt-in flow.
- **`subscriptionPrices.create` requires picking a tier price point ID** — you can't pass a free-form `$4.99`. The CLI finds the matching tier for you.

## Project layout

```
appstore-cli/
├── src/
│   ├── auth.ts             # config loading + JWT
│   ├── client.ts           # SDK wrapper (read + write methods)
│   ├── paths.ts            # secrets + metadata path resolution
│   ├── project.ts          # git-root discovery
│   ├── types.ts            # YAML schema types
│   ├── index.ts            # CLI entry (commander)
│   ├── commands/           # one file per command group
│   └── mcp/server.ts       # MCP server (stdio)
├── docs/                   # auth / workflow / iap-schema / listings-schema / quirks
├── package.json            # bin: appstore + appstore-mcp
└── README.md               # this file
```

## Contributing

See [CLAUDE.md](CLAUDE.md) for agent-facing development notes.

For human contributors: PRs welcome. Run `npx tsc --noEmit` to typecheck. There are no unit tests yet — verify against a real ASC account via `--dry-run` flags first.

## Adopters

> I built this to manage [Lazy Sudoku](https://lazy-sudoku.com)'s App Store listing — 14 locales, 12 IAP products across 173 territories of pricing, plus subscription groups with intro offers. Editing YAML in my editor and running `appstore listings sync` / `appstore iap sync` is dramatically less error-prone than clicking through App Store Connect's per-locale tabs, and lets every store change land via normal PR review.
>
> — *Sergei Fedorov, [Lazy Sudoku](https://lazy-sudoku.com)*

Using appstore-cli somewhere? Open a PR adding yourself to this section.

## Licence

MIT.
