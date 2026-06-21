# Workflow

The CLI exists to make App Store Connect editable from text files instead of a website. The canonical loop is **export → edit → sync**, with **pull** + **diff** filling in two-way reconciliation.

## The core loop (IAPs + subscriptions)

```bash
# One-time: seed the YAML from live ASC.
appstore iap export --output l10n/metadata/apple/iap.yaml
git add l10n/metadata/apple/iap.yaml && git commit -m "seed: iap metadata"

# Day-to-day: edit YAML, push.
$EDITOR l10n/metadata/apple/iap.yaml
appstore iap sync --dry-run                # safe preview
appstore iap sync                          # push for real
git commit -am "Update IAP copy for v1.2"

# When someone edits ASC directly (Apple staff, product manager, etc.):
appstore iap diff                          # show what drifted
appstore iap pull                          # absorb live changes without overwriting local
git diff l10n/metadata/apple/iap.yaml      # review what came in
```

## The same loop for listings

```bash
# Seed
appstore listings update --all --dry-run   # shows the snapshot you'd push
# (no dedicated `listings export` yet — export is via the IAP / show paths)

# Edit
$EDITOR l10n/metadata/apple/listings/en-GB.yaml

# Preview + push
appstore listings update --lang en-GB --dry-run
appstore listings update --all
```

`appstore listings diff` shows YAML-vs-live drift the same way `iap diff` does.

## Creating new products

`iap sync` only patches products that already exist on ASC; it skips missing ones. To create new IAPs/subscriptions from YAML:

```bash
# Add a new product entry to iap.yaml
$EDITOR l10n/metadata/apple/iap.yaml

# Pre-flight: does Apple think this productId is taken?
appstore iap create --product-id premium_lifetime --dry-run

# Actually create. Hard-fails if the productId already exists (use sync instead).
appstore iap create --product-id premium_lifetime
```

The create flow:
1. Creates the IAP / sub / group on ASC.
2. Immediately pushes localisations, prices, availability, intro offers, and the review screenshot — same code as `iap sync`.
3. Returns the new ASC entity ID for follow-up scripting.

To create everything in one go (multiple new productIds in YAML), drop `--product-id`:

```bash
appstore iap create --dry-run
appstore iap create
```

## Pricing migration

Patch operations write `preserveCurrentPrice = true` — the new price applies to **new** subscribers only. Existing cohorts stay on their old price.

To migrate existing subscribers:

```bash
# Anchor territory (USA, matches your YAML's base_territory).
appstore iap migrate-prices --product-id premium_monthly
# Migration plan:
#   subscription:   premium_monthly (ASC id 6756577170)
#   anchor:         USA
#   target price:   4.99 USA
#   semantics:      re-broadcasts current price with preserveCurrentPrice=false
# [dry-run] no API call fired. Pass --confirm to actually migrate.

appstore iap migrate-prices --product-id premium_monthly --confirm
```

Apple's customer notification + opt-in flow kicks in automatically for increases; decreases auto-apply at next billing.

See [quirks.md](quirks.md) for why non-anchor territories aren't supported in one call.

## Two-way reconciliation

Two scenarios where `pull` + `diff` matter:

**1. Someone edited ASC directly.**

```bash
appstore iap diff
# mismatch    purchases/diagonal_12clue/localisations/en/description
#               yaml: 12 clue diagonal puzzles
#               live: Diagonal puzzles with 12 starting clues

appstore iap pull --dry-run                # shows what would be added
appstore iap pull                          # absorbs additions (never overwrites)
git diff l10n/metadata/apple/iap.yaml      # commit if it looks right
```

`pull` is **additive only**. If a product exists in both YAML and live but their fields differ, `pull` leaves the YAML alone — you have to decide which side wins:

- `iap sync` → YAML wins (overwrites live)
- Hand-edit YAML to match live, then `pull` is a no-op

**2. You set up a new project.**

```bash
appstore iap export --output l10n/metadata/apple/iap.yaml
# OVERWRITES the file. Use this only when seeding.
```

After the initial export, switch to `pull` for incremental absorbs. Export is the nuclear option that round-trips the entire live state and discards any local edits.

## CI integration

Both `iap sync` and `listings update` exit non-zero on failure, so they integrate cleanly into CI:

```yaml
# .github/workflows/release.yml
- name: Push metadata
  env:
    APPSTORE_KEY_ID: build_upload
    # Auth + .p8 staged in .secret-stuff/ by an earlier secret-decrypt step
  run: |
    appstore listings update --all
    appstore iap sync
```

For preview-mode CI (PR builds that shouldn't touch live state):

```yaml
- name: Validate metadata
  run: |
    appstore listings update --all --dry-run
    appstore iap sync --dry-run
    appstore iap diff           # exits 0 even with divergence; pipe to fail-on-output
```

## Screenshots

Different rhythm — screenshots are bigger binary uploads, so the CLI's batch operations matter:

```bash
# Upload one locale's set, replacing whatever's there.
appstore screenshots upload --source ./shots/en-GB --lang en-GB --mode replace

# Upload every locale's set in one pass.
appstore screenshots upload --source ./shots --all --mode replace
```

`./shots/<lang>/` should contain files named per Apple's device-class conventions — see [screenshots-schema.md](screenshots-schema.md) (TODO) for the naming pattern.

## App Previews (video)

Similar to screenshots but for the per-device-class App Preview reels:

```bash
appstore previews list --lang en-GB
appstore previews upload --source ./reels/en-GB --lang en-GB
```

Apple rejects previews that don't match the strict spec (1080×1920, 30fps, AAC silent audio for portrait iPhone tiers, etc.). The CLI doesn't transcode — supply the right files.
