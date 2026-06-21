# Get started

A 5-minute walkthrough from zero to your first round-tripped App Store listing.

## 1. Install

```bash
npm install -g appstore-flow
```

Two binaries land on your `PATH`:

| Binary | Purpose |
|---|---|
| `appstore` | The CLI |
| `appstore-mcp` | The MCP server (stdio) — used by Claude Code / Cursor / other agents |

Verify:

```bash
appstore --help
which appstore-mcp
```

If you'd rather work from a checkout (handy when contributing back):

```bash
git clone https://github.com/zmij/appstore-cli.git
cd appstore-cli && npm install && npm run build && npm link
```

## 2. Get an App Store Connect API key

App Store Connect → **Users and Access → Integrations → App Store Connect API**. Create a key with the role that matches what you'll do (App Manager for everything in this CLI; Developer if you only need read).

Download the `.p8` file once — Apple won't show it again. Keep it out of git.

Note the **Issuer ID** (top of the Keys page) and your **app's resource ID** (App Store Connect → your app → App Information → Apple ID, the numeric one).

See [Authentication](/auth) for key rotation, role selection, and env-var overrides.

## 3. Drop the config file

The CLI looks for credentials in `<repo>/.secret-stuff/` by default. Create the directory (gitignored — never commit) and the config:

```yaml
# .secret-stuff/appstore-config.yaml
issuer_id: "00000000-0000-0000-0000-000000000000"
app_id: "1234567890"
keys:
  app_manager:
    key_id: "ABCDEF1234"
    key_file: "AuthKey_ABCDEF1234.p8"
default_key: "app_manager"
```

Drop the `.p8` file next to it: `.secret-stuff/AuthKey_ABCDEF1234.p8`.

**Different layout?** Set `APPSTORE_SECRETS_DIR=/abs/path` to point at any other directory, or commit an `appstore-cli.config.yaml` with `secrets_dir:` / `metadata_dir:` overrides. See the [README's Configuration section](https://github.com/zmij/appstore-cli#configuration).

## 4. Pull live state into YAML

Read-only — proves auth works and gives you a starting point.

```bash
# Listings: per-locale store copy → l10n/metadata/apple/listings/<lang>.yaml
appstore listings export

# IAP catalogue: every product / subscription / group → l10n/metadata/apple/iap.yaml
appstore iap export --output l10n/metadata/apple/iap.yaml
```

Open the files. Commit them — they are now the source of truth for your store.

## 5. Edit + push

Edit a value in `l10n/metadata/apple/listings/en-GB.yaml` — say, the `promotional_text:`. Then preview before pushing:

```bash
# Show what would change vs. live state
appstore listings sync --dry-run

# Push it
appstore listings sync
```

Same shape for IAP:

```bash
appstore iap sync --dry-run
appstore iap sync
```

`sync` only patches fields that differ — your hand-edits don't overwrite the world. See [Workflow](/workflow) for the full export → edit → sync → pull → reconcile loop.

## 6. (Optional) Wire up the MCP server

Let Claude Code (or any MCP client) read live store state during release prep without you leaving the terminal:

```bash
# In the project directory where your secrets live
claude mcp add appstore appstore-mcp
```

Then ask the agent things like *"show me the en-GB listing"* or *"list all in-app purchases"*. The agent calls the same client code the CLI uses — no shelling.

See the [README's MCP Server section](https://github.com/zmij/appstore-cli#mcp-server) for scope (local / project / user), other MCP clients (Cursor, Windsurf, Cline), and the working-directory + auth gotchas.

## Next steps

- [Workflow](/workflow) — full export → edit → sync → pull → reconcile loop with `migrate-prices` and `create` paths.
- [IAP schema](/iap-schema) — every field in `iap.yaml`: purchases, subscriptions, groups, intro offers, review screenshots.
- [Listings schema](/listings-schema) — per-locale `listings/<lang>.yaml` shape; keyword + length limits.
- [Apple quirks](/quirks) — the non-obvious gotchas the CLI works around (preserveCurrentPrice, tier price points, edit sessions, …).
