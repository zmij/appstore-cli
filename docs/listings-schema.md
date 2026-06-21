# Listings YAML schema

Per-locale YAML lives at `<metadata_dir>/listings/<lang>.yaml` (default `l10n/metadata/apple/listings/<lang>.yaml`).

One file per locale. The lang key is the short form — see the [locale mapping](#locale-mapping) below for how it maps to ASC's longer codes.

## Shape

```yaml
# l10n/metadata/apple/listings/en.yaml

whats_new: |
  New in this version:
  • Reworked solver
  • Faster startup
  • Bug fixes

app_info:
  title: "Lazy Sudoku"
  subtitle: "Solve smarter, not harder"
  promotional_text: "Now with diagonal-X support."
  description: |
    The most relaxing sudoku app on the store.

    • Classic + diagonal + jigsaw variants
    • Apple Pencil-friendly note-taking
    • Camera scanner for paper puzzles
  keywords: "sudoku,puzzle,brain,logic,number,maths"
```

## Field reference

| YAML field | ASC field | Limit | Notes |
|---|---|---|---|
| `whats_new` | `whatsNew` | 4000 chars | "What's New In This Version" on the release. Reset per version |
| `app_info.title` | `name` | 30 chars | App name in the store. Apple is strict — keep it short |
| `app_info.subtitle` | `subtitle` | 30 chars | One-liner under the title |
| `app_info.promotional_text` | `promotionalText` | 170 chars | Editable without a new release. Use for time-bound copy |
| `app_info.description` | `description` | 4000 chars | Full marketing description. Markdown-ish (line breaks preserved) |
| `app_info.keywords` | `keywords` | 100 chars | Comma-separated. **No spaces around commas** — wastes character budget |

Apple silently truncates over-limit fields. The CLI doesn't validate length client-side; use `appstore listings show --lang X` after a push to confirm.

## Multi-line values

YAML's `|` literal-block syntax preserves line breaks. Use it for `whats_new` and `description`:

```yaml
whats_new: |
  Line one.

  Line two with a blank line above.
description: |
  Paragraph one.

  Paragraph two. **Bold not supported** — Apple strips formatting.
```

## Keywords

Apple's keyword budget is **100 characters total, comma-separated, no spaces**. Pack carefully:

```yaml
# Good — 67 chars
keywords: "sudoku,puzzle,brain,logic,number,maths,daily,kids,relaxing"

# Bad — wastes 8 chars on spaces
keywords: "sudoku, puzzle, brain, logic, number, maths"
```

You don't need to repeat words from the title — Apple counts them implicitly. Keyword stuffing risks rejection.

## Per-locale strategy

Each locale's file is independent. Common pattern:

- `en.yaml` is your "authoritative" copy.
- Other locales are translations, but `keywords` should be **locale-specific** — Japanese users search for `数独` not `sudoku`.
- `whats_new` resets every release; copy/translate per release.
- `app_info.*` survives across releases until you change it.

## Locale mapping

YAML uses short codes; the CLI maps to ASC locales:

| `<lang>.yaml` | ASC locale |
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

Add a locale by creating `<lang>.yaml` and running `appstore listings update --lang <lang>`. The CLI creates the localisation on ASC if it doesn't exist.

## Push paths

```bash
# Update everything from every per-locale YAML
appstore listings update --all

# One locale only
appstore listings update --lang ja

# One field across all locales (e.g. only `whats_new` for a hotfix)
appstore listings update --all --field whats_new

# Dry-run first — always a good idea
appstore listings update --all --dry-run
```

## Diff

```bash
appstore listings diff [--lang ja]
```

Shows what's different between YAML and live, per field. Useful before a `--all` push to spot unintended changes.

## Mac vs iOS

If your app ships both iOS and Mac, ASC tracks them as separate versions with their own per-locale listings. `listings update` targets the editable version of one platform at a time:

```bash
appstore listings update --all --version-id <ios-version-id>
appstore listings update --all --version-id <macos-version-id>
```

Same YAML, two pushes. (TODO: a `--platform ios,macos` mode that fans out automatically.)
