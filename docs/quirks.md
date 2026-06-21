# Apple quirks

Non-obvious behaviour from the App Store Connect API that the CLI works around. Each entry includes what the API does, what we do about it, and what to remember when you go beyond the CLI.

## 1. Edit sessions are listings-only

Apple's API has a **session model** for app metadata: you open a draft "edit", make changes, then commit. The CLI threads this transparently for listings + screenshots.

**IAPs and subscriptions don't need an edit session.** Changes apply immediately on `iap sync`. Don't try to wrap them in a session — you'll get cryptic 4xx errors.

This split mirrors how the ASC website behaves: listing edits queue up in a "version under preparation" you submit later; IAP/sub edits go live on save.

## 2. `preserveCurrentPrice` is the migration discriminator

When you create a `subscriptionPrices` row:

| `preserveCurrentPrice` | Who sees the new price |
|---|---|
| `true` (CLI default on `iap sync`) | New subscribers only. Existing cohorts stay on their old price |
| `false` (`iap migrate-prices --confirm` writes this) | Everyone — existing subscribers get notified + migrated |

The flag is per-row, so a single subscription can have multiple `subscriptionPrices` schedules, each with its own `preserveCurrentPrice`. Apple uses the most recent one to decide what a new subscriber sees; existing subscribers stick to whatever schedule they signed up under, unless a `preserveCurrentPrice = false` row supersedes it.

**`iap sync` deliberately writes `true`** — never accidentally migrate live subscribers. `iap migrate-prices` is the explicit opt-in for the `false` path.

## 3. Subscription price points are per-territory

Apple has a tier table (`subscriptionPricePoints`) and you set prices by referencing a tier ID — you can't pass a free-form `$4.99`. Each call to `findSubscriptionPricePoint(subId, territory, "4.99")` returns the territory's tier ID matching that price.

**The CLI does this lookup for you.** If your YAML says `base_price: "4.99"` in `base_territory: USA`, the CLI:

1. Asks Apple for USA's tier table.
2. Finds the row with `customerPrice === "4.99"`.
3. Uses that row's ID.

If no tier matches exactly, the CLI errors and lists the nearest tiers — Apple's table is discrete, so `$4.99` exists but `$4.97` doesn't.

## 4. The anchor migration only affects the anchor's territory

Because each `subscriptionPrices` row is per-territory, **migrating the anchor doesn't auto-migrate other territories**. Apple's auto-equalised tier system handles the derived prices for *new* buyers in non-anchor territories, but existing buyers stay on whatever schedule they were signed up under in their territory.

The CLI's `iap migrate-prices` is **anchor-only by default**. Non-anchor territories are explicitly refused (clear error + hint to drop `--territory`) rather than silently using the wrong price-point ID — the point ID in the price summary is the anchor's, and reusing it for a different territory would migrate the wrong cohort.

Per-territory migration would need an extra lookup per scope; deferred until needed.

## 5. Apple picks the consent flow from the price delta

When `preserveCurrentPrice = false` triggers migration, **Apple decides the customer-facing flow** based on whether the new price is higher or lower than the old:

- **Price decrease** → auto-applies at the subscriber's next billing date. No customer prompt.
- **Price increase** → Apple's standard customer notification + opt-in flow. Subscribers see a Settings prompt asking them to accept; declines cancel the subscription at the next renewal.

You don't pass a "consent type" — Apple chooses. There's a separate `subscriptionPriceTimingType` enum for fine-grained control (e.g. `IMMEDIATELY` vs `WAITS_BILLING_CYCLE`), but the defaults work for the vast majority of cases.

## 6. IAP localisations require `name`

`InAppPurchaseLocalizationCreateRequest` requires `name` — passing only `description` errors out. The CLI ensures `display_name` is set on every locale; if you forget it in YAML, sync fails for that locale specifically (other locales still push).

This is different from listing localisations, where most fields are optional. Don't carry the same mental model across.

## 7. Subscription-group reference name is immutable

You can set `subscription_groups.<key>.reference_name` on creation, but it can't be changed afterwards. The CLI looks up existing groups by ASC ID, not by name, so you can rename in YAML without breaking the link — but the ASC UI keeps showing the original name.

If you really need to rename, delete the group on ASC (only possible if it has no active subscribers, which is almost never the case) and create a new one.

## 8. Review screenshots are required for submission

Apple Review needs a screenshot showing the IAP / subscription's purchase flow in your app. The CLI uploads it as part of `iap sync` when `review_screenshot: <path>` is set, but **doesn't validate** that the file is reasonable — it just uploads whatever you point at.

If you submit without a review screenshot, Apple rejects the IAP. The CLI surfaces upload errors but can't tell you whether the screenshot itself is good.

## 9. App Preview videos have a strict spec

App Previews (per-locale promo reels) must match Apple's spec exactly:

- **Portrait iPhone tiers**: 1080×1920, 30fps, AAC audio (silent is fine, but the track must exist).
- **Landscape iPad tiers**: their respective resolutions.
- File must be H.264 in MOV/MP4 container.

The CLI doesn't transcode — supply the right files. If Apple rejects the upload, the error usually says which dimension is wrong. Common gotchas:

- Native iOS screen recordings are 1284×2778 / 60fps / no audio — all wrong.
- ffmpeg transcode incantation:
  ```bash
  ffmpeg -i in.mov -vf "scale=1080:1920,fps=30" \
         -c:v libx264 -pix_fmt yuv420p -profile:v high -level 4.0 \
         -c:a aac -ar 48000 -b:a 64k -af "anullsrc" -shortest \
         -movflags +faststart out.mov
  ```

## 10. Worktree vs project root

The CLI distinguishes two roots:

- **Project root** — the main repo. Where secrets live (`.secret-stuff/appstore-config.yaml`). Shared across worktrees.
- **Worktree root** — the current branch's working directory. Where metadata lives (`l10n/metadata/apple/iap.yaml`). Per-branch.

This matters when you're editing IAP metadata on a feature branch in a worktree: the change stays in the worktree, but the secrets you use to push it come from the main repo. `git rev-parse --git-common-dir` discovers the main repo even from a worktree.

If you're not using worktrees, both roots are the same path — nothing to think about.

## 11. Rate limits are real but generous

App Store Connect rate-limits aggressively for write operations, less so for reads. The CLI doesn't back off — if you hit a rate limit, the call fails with a clear error and you re-run. In practice:

- `iap sync` for ~10 products including ~170 territories each: ~1 minute, no rate hits.
- `iap export` (full pull): ~90 seconds for the same setup.
- `listings update --all` for 14 locales: ~20 seconds.

Bulk operations that fan out to many calls (e.g. screenshot uploads) are the most likely to hit limits. Spread big uploads across multiple runs if you see 429s.

## 12. `lazy_sudoku_*` legacy SKU prefix

(Lazy-Sudoku-specific, but illustrative.) When the project was set up, IAPs were named `lazy_sudoku_premium_lifetime` etc. Later renames dropped the prefix (`premium_lifetime`), but the old SKUs can't be renamed — Apple treats productId as immutable. If you're forking this CLI for your own project, **choose your SKU names carefully on day one**; renames mean creating new products + deprecating the old ones, not editing in place.
