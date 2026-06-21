---
layout: home

hero:
  name: appstore-cli
  text: App Store Connect from your terminal
  tagline: Manage iOS listings, IAPs, subscriptions, and screenshots from YAML files. CLI + bundled MCP server.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/zmij/appstore-cli

features:
  - icon: 📝
    title: YAML-first
    details: Pull every per-locale listing, IAP catalogue, subscription, and screenshot summary into committed YAML. Edit in your editor; sync back.
  - icon: 🔄
    title: Two-way reconcile
    details: Field-level diff with paths like `subscriptions/my_sub/intro_offers/.../start_date`. Pull updates without clobbering local edits.
  - icon: 🤖
    title: Bundled MCP server
    details: Same client code, exposed over stdio. Any MCP-aware agent (Claude Code, Cursor, Cline, Windsurf) can read and update live store state.
  - icon: 💰
    title: Price + subscriber migrations
    details: Migrate existing subscribers when a price changes via Apple's `batchMigratePrices`. Dry-run by default; `--confirm` to fire.
  - icon: ⚡
    title: One install, two binaries
    details: Single `npm install`, two binaries (`appstore` + `appstore-mcp`). Configurable for any iOS project via env vars or `appstore-cli.config.yaml`.
  - icon: 🌍
    title: Locale-aware
    details: Built and battle-tested on Lazy Sudoku's 14-locale listing and 173-territory pricing matrix.
---

## What it does

`appstore-cli` puts your iOS store presence under version control. Instead of clicking through App Store Connect's per-locale tabs to update copy, prices, or screenshots, you pull live state into committed YAML, edit it in your editor, and sync it back through normal PR review.

The bundled `appstore-mcp` server exposes the same client code over stdio so any MCP-aware agent — Claude Code, Cursor, Windsurf, Cline, Continue, Zed — can read and update live store state without shelling out.

## Quick install

```bash
npm install -g appstore-cli
# or, from a checkout
git clone https://github.com/zmij/appstore-cli.git
cd appstore-cli && npm install && npm run build && npm link
```

Then see [Get started](/getting-started) for the first-run walkthrough.

## In production

> I built this to manage [Lazy Sudoku](https://lazy-sudoku.com)'s App Store listing — 14 locales, 12 IAP products across 173 territories of pricing, plus subscription groups with intro offers. Editing YAML in my editor and running `appstore listings sync` / `appstore iap sync` is dramatically less error-prone than clicking through App Store Connect's per-locale tabs, and lets every store change land via normal PR review.
>
> — *Sergei Fedorov, [Lazy Sudoku](https://lazy-sudoku.com)*

Using appstore-cli somewhere? [Open a PR](https://github.com/zmij/appstore-cli/blob/master/README.md) adding yourself to the Adopters section in the README.
