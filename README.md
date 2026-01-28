# App Store Connect CLI

Command-line tool for managing App Store Connect metadata, screenshots, and in-app purchases for Lazy Sudoku.

## Installation

```bash
cd appstore-cli
npm install
npm run build
```

## Authentication

The CLI uses API keys stored in `{project_root}/.secret-stuff/appstore-config.yaml`:

```yaml
issuer_id: "your-issuer-id"
app_id: "your-app-id"

keys:
  build_upload:
    key_id: "YOUR_KEY_ID"
    key_file: "AuthKey_YOUR_KEY_ID.p8"
  app_manager:
    key_id: "ANOTHER_KEY_ID"
    key_file: "AuthKey_ANOTHER_KEY_ID.p8"

default_key: "build_upload"
```

The CLI automatically discovers the project root via git, even when running from a worktree.

## Usage

```bash
# Run directly
node build/index.js <command>

# Or install globally
npm link
appstore <command>
```

## Commands

### Authentication

```bash
# Validate authentication configuration
appstore auth

# Find app ID by bundle ID (for initial setup)
appstore setup --bundle-id online.lazy-sudoku.app \
  --issuer-id YOUR_ISSUER_ID \
  --key-id YOUR_KEY_ID \
  --key-file path/to/AuthKey.p8
```

### Read Operations

```bash
# List app versions (shows platform: iOS/macOS)
appstore versions list

# List localisations for the editable version
appstore localisations list

# List localisations for a specific version
appstore localisations list --version-id <id>

# Show listing for a specific locale
appstore listings show --lang en-US

# Export current state to YAML files
appstore export --output ./backup/
```

### In-App Purchases & Subscriptions

```bash
# List in-app purchases
appstore iap list

# List subscription groups
appstore subscriptions list
```

### Custom Product Pages

```bash
# List custom product pages
appstore pages list
```

### Update Operations

```bash
# Update all localisations from YAML files
appstore listings update --all

# Update specific language
appstore listings update --lang en-US

# Update specific field only
appstore listings update --lang en-US --field whats_new

# Dry-run (show what would change)
appstore listings update --all --dry-run
```

### Screenshots

```bash
# List screenshots for a language
appstore screenshots list --lang en-US

# Upload screenshots (replace mode)
appstore screenshots upload --source ~/screenshots --lang en-US --mode replace

# Upload to all languages
appstore screenshots upload --source ~/screenshots --all --mode replace
```

## MCP Integration

The App Store tools are also available via MCP in the `sudoku-mcp` server:

| Tool | Description |
|------|-------------|
| `appstore_list_versions` | List versions with platform info |
| `appstore_list_localisations` | List localisations for a version |
| `appstore_show_listing` | Show listing for a locale |
| `appstore_update_listing` | Update listing fields |
| `appstore_list_iap` | List in-app purchases |
| `appstore_list_subscriptions` | List subscription groups |
| `appstore_list_pages` | List custom product pages |
| `appstore_get_app_info` | Get app bundle ID, name, SKU |

## Metadata Format

Listings are stored in YAML format in `l10n/metadata/apple/listings/`:

```yaml
# listings/en.yaml
whats_new: |
  New in this version:
  • Feature 1
  • Feature 2

app_info:
  title: "Lazy Sudoku"
  subtitle: "Solve Smarter, Not Harder"
  promotional_text: "Advanced sudoku..."
  description: |
    Full app description here...
  keywords: "sudoku,puzzle,brain,logic"
```

IAP and subscriptions in `l10n/metadata/apple/iap.yaml`:

```yaml
purchases:
  premium_lifetime:
    reference_name: "Premium - Lifetime"
    localisations:
      en:
        display_name: "Premium - Lifetime"
        description: "All features unlocked!"

subscriptions:
  premium_monthly:
    reference_name: "Premium - Monthly"
    localisations:
      en:
        display_name: "Premium - Monthly"
        description: "Access all features for one month."
```

## Key Selection

Keys are selected in this priority order:

1. `--key-id` CLI flag
2. `APPSTORE_KEY_ID` environment variable
3. `default_key` from config file

```bash
# Use a specific key
appstore versions list --key-id app_manager
```

## Language Codes

The CLI uses App Store Connect locale codes:

| Our Code | App Store Locale |
|----------|------------------|
| en | en-US |
| de | de-DE |
| fr | fr-FR |
| es | es-ES |
| ar | ar-SA |
| ja | ja |
| ko | ko |
| ru | ru |
| zh | zh-Hans |

## Dependencies

- `appstore-connect-sdk` - App Store Connect API client
- `commander` - CLI framework
- `yaml` - YAML parsing
- `chalk` - Terminal styling
