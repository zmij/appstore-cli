# `iap.yaml` schema

The full YAML format for `iap.yaml`. Covers purchases (managed + non-renewing), subscriptions, subscription groups, intro offers, and review screenshots.

## Top-level shape

```yaml
subscription_groups:        # optional — only needed if creating new groups via `iap create`
  <ref_name>:
    reference_name: <string>
    localisations:
      <lang>:
        name: <string>
        custom_app_name: <string>   # optional

purchases:                  # IAPs: managed (lifetime) + non-renewing subs
  <product_id>:
    reference_name: <string>
    type: NON_CONSUMABLE | CONSUMABLE | NON_RENEWING_SUBSCRIPTION
    family_sharable: <bool>
    price:
      base_territory: <ISO3>           # e.g. USA
      base_price: "4.99"               # customer-facing in base_territory's currency
    availability:
      available_in_new_territories: <bool>
      territories: [ISO3, ...] | "all"
    review_screenshot: <path>          # local PNG / JPEG, required for ASC submission
    localisations:
      <lang>:
        display_name: <string>
        description: <string>

subscriptions:              # auto-renewing
  <product_id>:
    reference_name: <string>
    group: <ref_name>                  # which subscription_groups entry
    subscription_period: ONE_WEEK | ONE_MONTH | TWO_MONTHS | THREE_MONTHS | SIX_MONTHS | ONE_YEAR
    family_sharable: <bool>
    group_level: <number>              # 1 = top tier; lower number = higher rank
    price:
      base_territory: <ISO3>
      base_price: "9.99"
    availability:
      available_in_new_territories: <bool>
      territories: [ISO3, ...] | "all"
    intro_offers:
      - mode: FREE_TRIAL | PAY_AS_YOU_GO | PAY_UP_FRONT
        duration: THREE_DAYS | ONE_WEEK | TWO_WEEKS | ONE_MONTH | TWO_MONTHS | THREE_MONTHS | SIX_MONTHS | ONE_YEAR
        periods: <number>              # how many duration cycles
        price: "1.99"                  # only for PAY_AS_YOU_GO / PAY_UP_FRONT
        territory: <ISO3>              # optional — omit for global
        start_date: <ISO8601>          # optional
        end_date: <ISO8601>            # optional
    review_screenshot: <path>
    localisations:
      <lang>:
        display_name: <string>
        description: <string>
```

## Field reference

### `purchases.*` and `subscriptions.*`

| Field | Type | Required on | Notes |
|---|---|---|---|
| `reference_name` | string | always | Apple's internal label; not user-visible |
| `type` | enum | `iap create` | `NON_CONSUMABLE`/`CONSUMABLE`/`NON_RENEWING_SUBSCRIPTION`. **Immutable** once created |
| `family_sharable` | bool | `iap create` | Family Sharing eligibility. **Immutable** |
| `price` | object | always | See below |
| `availability` | object | always | See below |
| `review_screenshot` | path | submission | Local file path (PNG / JPEG). Required by App Review |
| `localisations` | map | always | Per-locale `display_name` + `description` |

### `price`

```yaml
price:
  base_territory: USA   # ISO 3166-1 alpha-3
  base_price: "4.99"    # customer-facing price in base_territory's currency
```

Apple uses a **tier price-point system**, not free-form prices. You pick a tier (e.g. `$4.99 USD`) and Apple auto-derives the equivalent tier in every other territory's currency. The CLI looks up the matching tier ID from your stated price — if Apple doesn't have a tier at exactly `$4.99`, the CLI errors with the nearest tiers listed.

Only the **anchor** (`base_territory`) is set explicitly. Other territories inherit from Apple's tier table.

### `availability`

```yaml
availability:
  available_in_new_territories: true   # if Apple opens a new region, ship there by default
  territories: ["USA", "GBR", "DEU", ...]
  # OR:
  territories: "all"                   # shorthand for every territory Apple supports
```

### `localisations`

```yaml
localisations:
  en:
    display_name: "Premium - Lifetime"
    description: "All features unlocked, forever."
  de:
    display_name: "Premium - Lebenslang"
    description: "Alle Funktionen freigeschaltet, dauerhaft."
```

The lang key uses the short form (e.g. `en`, `de`, `fr`, `pt-BR`). The CLI maps to ASC locales (`en-GB`, `de-DE`, `pt-BR`).

## `subscriptions.*` extras

### `intro_offers`

Smart-diffed by `(mode, duration, periods, territory)` tuple. Adding/removing offers in YAML adds/removes them on ASC; changing the price inside a matched offer overwrites that one.

```yaml
intro_offers:
  - mode: FREE_TRIAL
    duration: ONE_WEEK
    periods: 1
    # FREE_TRIAL doesn't need price
  - mode: PAY_AS_YOU_GO
    duration: ONE_MONTH
    periods: 3
    price: "1.99"
    territory: USA            # USA-only intro at $1.99/mo for 3 months
  - mode: PAY_UP_FRONT
    duration: ONE_YEAR
    periods: 1
    price: "29.99"
    start_date: "2026-01-01T00:00:00Z"
    end_date:   "2026-12-31T23:59:59Z"
```

### `group` + `group_level`

Subscriptions belong to a group. Within a group, users can only have one active sub at a time, so groups model tier ladders:

```yaml
subscription_groups:
  premium_tiers:
    reference_name: "Premium tiers"
    localisations:
      en: { name: "Premium" }

subscriptions:
  premium_monthly:
    group: premium_tiers
    group_level: 2            # below the annual
  premium_annual:
    group: premium_tiers
    group_level: 1            # top of the ladder
```

Lower `group_level` = higher tier (counter-intuitive). Upgrades go from higher number → lower number.

## `subscription_groups`

Required when `iap create` is creating a brand-new group. On export, the CLI fills in `reference_name` from the live group; you can leave it omitted on existing products (the CLI looks them up by ASC ID).

```yaml
subscription_groups:
  premium_tiers:
    reference_name: "Premium tiers"        # Apple's internal name
    localisations:
      en:
        name: "Premium"                    # user-visible group name
        custom_app_name: "MyApp Premium"   # optional override
      de:
        name: "Premium"
```

## Locale codes

The CLI uses **short codes** in YAML (more pleasant to type and grep). Internally it maps to ASC locales:

| YAML key | ASC locale |
|---|---|
| `en` | `en-GB` |
| `en-US` | `en-US` |
| `de` | `de-DE` |
| `fr` | `fr-FR` |
| `es` | `es-ES` |
| `es-MX` | `es-MX` |
| `pt` | `pt-BR` |
| `pt-PT` | `pt-PT` |
| `zh` | `zh-Hans` |
| `ja` | `ja` |
| `ko` | `ko` |
| `ar` | `ar-SA` |
| `ru` | `ru` |
| `hi` | `hi` |
| `id` | `id` |
| `fi` | `fi` |
| `he` | `he` |

## Validation

Pre-flight your edits before pushing:

```bash
appstore iap diff               # shows field-level divergence vs live
appstore iap sync --dry-run     # shows what `sync` would patch (no calls)
```

If you've added a new product and want to confirm the create path:

```bash
appstore iap create --product-id new_thing --dry-run
```

## Round-trip fidelity

`iap export` → `iap sync` is a no-op (zero divergence in `iap diff`). The exporter writes every field the syncer can push back, including ASC-side defaults like `family_sharable: false`. If you find a roundtrip that drifts, it's a bug.
