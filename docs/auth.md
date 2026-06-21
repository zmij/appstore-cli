# Authentication

The CLI authenticates to App Store Connect via API keys + JWT. This doc covers how to create the keys, what scopes they need, and how the CLI rotates them.

## TL;DR

```bash
# 1. Create a key on App Store Connect (see below)
# 2. Download the .p8 file to .secret-stuff/
# 3. Write .secret-stuff/appstore-config.yaml:
#    issuer_id: "<your-issuer-uuid>"
#    app_id: "<numeric-app-id>"
#    keys:
#      app_manager:
#        key_id: "ABCDE12345"
#        key_file: "AuthKey_ABCDE12345.p8"
#    default_key: "app_manager"
# 4. Smoke-test:
appstore info
```

## Creating a key

[App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/api).

1. Click **Generate API Key** (or **+** if you already have one).
2. Pick an **access role** — see below for what each role allows.
3. Download the `.p8` immediately. **Apple shows it once.** If you lose it, revoke and regenerate.
4. Note the **Key ID** (10 characters, shown next to the key name) and your **Issuer ID** (UUID at the top of the Keys page).
5. Drop the `.p8` in `.secret-stuff/` and reference its filename in `appstore-config.yaml`.

## Access roles

| Role | What the CLI can do |
|---|---|
| **Admin** | Everything. Avoid unless you need it for a one-off. |
| **App Manager** | Listings, IAPs, subscriptions, screenshots, custom product pages. **Default choice for the CLI.** |
| **Developer** | Read-only on most things; cannot edit listings or push pricing. |
| **Marketer** | Listings + screenshots only. Useful for a "marketing-only" key that can't touch pricing. |
| **Customer Support** | Reads + responds to reviews. Not relevant to this CLI. |

For day-to-day use, **App Manager** is the right pick. The CLI will refuse to do something the key can't do — you'll get a 403 from ASC with a clear message.

## Multiple keys

You can configure multiple keys with different roles. Useful when you want a separate key for build uploads (often automated, in CI) from one for metadata edits:

```yaml
keys:
  build_upload:
    key_id: "AAAAA11111"
    key_file: "AuthKey_AAAAA11111.p8"
  app_manager:
    key_id: "BBBBB22222"
    key_file: "AuthKey_BBBBB22222.p8"
default_key: "app_manager"
```

Pick a non-default key per call with `--key-id build_upload`, or set `APPSTORE_KEY_ID` for the whole shell.

## JWT lifecycle

The CLI generates a fresh JWT per command run (Apple tokens are valid for 20 minutes). The signing is done locally in-process — your `.p8` never leaves your machine. The token is:

- `iss` — issuer ID from config
- `kid` — key ID from the selected key
- `aud` — `appstoreconnect-v1`
- `exp` — `now + 19m` (1-minute safety margin under Apple's 20-minute limit)
- Signed with `ES256` using the `.p8` private key

There's nothing to refresh or cache. If a long-running operation crosses the 20-minute boundary, Apple will reject the call; the CLI surfaces the error and you re-run. (In practice, no single command takes that long — the slowest is a full `iap export` over 173 territories × 12 products, which is still under 2 minutes.)

## Key rotation

```bash
# 1. Generate a new key on ASC (don't revoke the old one yet)
# 2. Drop the new .p8 in .secret-stuff/
# 3. Add it as a new entry in appstore-config.yaml
# 4. Run a smoke test with --key-id <new>
appstore info --key-id app_manager_v2
# 5. Once you've confirmed it works, flip default_key + revoke the old one on ASC
```

## Validating auth

The CLI doesn't ship a dedicated `appstore auth` command (yet). The cheapest validation is `appstore info` — it makes a single read call and prints the bundle ID. If that returns, your auth is wired.

```bash
appstore info
# {
#   "id": "1234567890",
#   "name": "Your App",
#   "bundleId": "com.you.yourapp",
#   ...
# }
```

If you see `401 Unauthorized`, the most common causes:

- `.p8` file doesn't match the `key_id` in your config
- Issuer ID typo
- Key was revoked or expired on ASC

If you see `403 Forbidden`, the key doesn't have the role for the operation. Switch to a higher-privilege key or pick a different role for this key.

## Security

- **Never commit `.p8` or `appstore-config.yaml`.** The repo's `.gitignore` should include `.secret-stuff/` — verify before your first commit.
- The CLI reads `.p8` files from disk on every command invocation. They're not cached in memory longer than the process lifetime.
- JWTs are signed with the private key locally; the key is never sent to Apple.

## Env-var overrides

For CI or one-off scripts:

| Var | Effect |
|---|---|
| `APPSTORE_KEY_ID` | Use this key name instead of the config's `default_key` |
| `APPSTORE_SECRETS_DIR` | Override where to look for `appstore-config.yaml` + `.p8` |
| `APPSTORE_METADATA_DIR` | Override where to find/write YAML metadata |
