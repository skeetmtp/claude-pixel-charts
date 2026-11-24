# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code plugin (`pixel-charts`) that draws pixel charts in the terminal transcript using the kitty graphics protocol, falling back to a half-block cell raster. It has no build step and no package.json. Claude Code runs the TypeScript/TSX in `hooks/` directly.

## Commands

- Run all tests: `claude plugin test .`. This runs every `*.test.ts(x)` under the folder. There is no per-test filter. To run a subset, temporarily use `test.only` or move tests into a separate file.
- Try it live: `claude --plugin-dir .`, then `/pixel-charts-demo`.
- Force a render mode while testing: `PIXEL_CHARTS_MODE=image|raster`. Turn off Grafana auto charts: `PIXEL_CHARTS_AUTO=off`.
- Type definitions for the mod API (`claude-code`, `claude-code/testing`, etc.) are in `.claude-plugin/types/`, which `tsconfig.json` extends. tsc is not installed locally.

## Architecture

There are two independent halves, linked only by the tool result format:

1. **`server/server.mjs`** is a stdio MCP server (plain Node, no dependencies, newline-delimited JSON-RPC) declared in `.claude-plugin/plugin.json`. Its `draw_chart` tool validates the spec and returns two text blocks: a human summary that starts with `Drew ` and the normalized spec as JSON. It does no rendering. Its `instructions` string tells Claude when to prefer this tool.

2. **`hooks/register.tsx`** is the mod (listed in `hooks/hooks.json`). It intercepts `ui.render` for the terminal surface:
   - `ToolUse`: appends a chart under a single `draw_chart` or Grafana `query_prometheus` row.
   - `ToolGroup`: appends one chart per charted call in a collapsed group. Only the newest Prometheus *range* result is kept. Each chart gets a `1/n` share of the tree's image budget.
   - `ToolResult`: replaces the raw JSON with the dimmed `Drew …` summary.
   - Tools are matched by regex (`TOOL`, `AUTO`) on the full MCP tool name, so it works with any plugin or server prefix.
   - Specs are recovered from the output by JSON-parsing each text line and checking it with `isChartSpec`. The server output format and `specOf` must stay in sync.

Supporting modules:
- `hooks/chart.ts` is pure, with no engine access: `axesOf` (ticks and ranges), `rasterize` (RGBA pixels), `hover` (nearest point plus crosshair pixels), `cellsOf` (half-block raster encoding), and the light and dark palettes.
- `hooks/prometheus.ts` turns Prometheus range-query text into a `ChartSpec` (sets `spec.t` for UTC time axes, capped at 20 series).
- `hooks/hover.tsx` is a `ClientModule` overlay, mounted only in fullscreen. It posts pointer positions as `ui.message`. The `ui.message` handler in `register.tsx` looks up the cached drawing, redraws the pixels with `$.ui.blit` (no re-render), and returns the tooltip props.

Key constraints:
- **Image budget**: one render tree may carry about 2 MB of base64 image source in total. `pixelsOf` scales the resolution down from 8×16 px per cell to fit the share. Tests check this for 1 and 5 full-width charts.
- **Mode detection** (`modeOf`): image mode for kitty, Ghostty, or iTerm2 in fullscreen; raster inside tmux and elsewhere.
- **Cache**: drawings are pure functions of their key (`id|mode|theme|cols|WxH`). A 20-entry module-level LRU holds base pixels for hover restore. A theme change in `config.set` invalidates `ui.render`.
- Server limits: at most 6 series and 500 points (`MAX_SERIES`, `MAX_POINTS`). Bar and line charts need one value per `x` label; scatter charts use `points`.

## Tests

`tests/render.test.tsx` uses `claude-code/testing`. It stubs engine events with `on('env.get' | 'config.list' | 'ui.render', …)`, mounts a component with `$.ui.mount({ component: 'ToolGroup' | 'ToolUse' | …, props })`, and asserts on `ui.find({ key | type | text })`. Picture elements use the key `chart-<tool_use_id>`.

## Notes

`TODO.md` (untracked) lists planned work: a per-group chart cap, Loki auto-charts, a shared hover tooltip, and packaging (license, author, marketplace description). If you rename the plugin in `plugin.json`, the MCP tool name changes too. The `TOOL` regex still has to match it, and test `CALL` fixtures use the current name.
