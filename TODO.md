# TODO

## Charts

- [ ] Cap the charts drawn per tool group (e.g. the newest 3) so each picture
      keeps its pixel density under the 2 MiB per-tree Image budget.
- [ ] Draw multi-series Prometheus instant queries as a sorted horizontal bar
      chart.
- [ ] Auto-chart Loki metric queries (`count_over_time`, `rate`).
- [ ] Per-series stats in the legend: max (and when), last, min, mean.
- [ ] Choose how auto charts keep their top 20 series: by peak, mean or last.
- [ ] Second y axis, or a separate scale, for series of very different
      magnitudes.

## Hover

- [ ] Check in a live fullscreen session that the hover layer leaves the
      picture intact outside the value box, and that scrolling still works
      over a chart.
- [ ] Shared tooltip: every series' value at the hovered x, as in Grafana.
- [ ] Click to pin a tooltip; arrow keys step between points.

## Terminals

- [x] Pixels only where kitty graphics work; elsewhere withdraw `draw_chart`
      and leave charts to easel (checked live in Ghostty and with
      `TERM=xterm-256color`).
- [x] Hide a charted Prometheus result from easel so each query gets one chart.
- [ ] Detect kitty graphics from the terminal itself (a `$.ui.blit` on a
      mounted Image is refused while it shows its alt) instead of `TERM`
      guesses, for SSH sessions. A `settings.read` override of easel's option
      is ruled out: `cc-plugin-sec-default` skips that hook.

## Packaging

- [x] Add a license (MIT) and an `author` in `plugin.json`.
- [x] Add a `description` to `.claude-plugin/marketplace.json`.
- [ ] Run `gh auth setup-git` so HTTPS pushes work.
- [ ] Rename the plugin itself (`plugin.json` `name`) to `claude-pixel-charts`?
      It renames the slash command and the MCP tool name.
- [ ] Offer the plugin to the organization's library.
