# appstore-cli docs

| File | Topic |
|---|---|
| [auth.md](auth.md) | API key creation, JWT lifecycle, role selection, env-var overrides |
| [workflow.md](workflow.md) | Export → edit → sync → pull loop; create + migrate-prices paths; CI integration |
| [iap-schema.md](iap-schema.md) | Full YAML schema for `iap.yaml` (purchases, subscriptions, groups, intro offers, review screenshots) |
| [listings-schema.md](listings-schema.md) | Per-locale `listings/<lang>.yaml` shape; keyword + length limits |
| [quirks.md](quirks.md) | Apple-side gotchas the CLI works around (preserveCurrentPrice, tier price points, edit sessions, etc.) |

Top-level entry points:
- [README.md](../README.md) — install, quickstart, command reference, MCP setup
- [CLAUDE.md](../CLAUDE.md) — agent-facing development notes
