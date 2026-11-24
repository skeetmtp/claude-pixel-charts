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

## Packaging

- [ ] Add a license (`LICENSE` file or `license` in `plugin.json`) and an
      `author` in `plugin.json`.
- [ ] Add a `description` to `.claude-plugin/marketplace.json`.
- [ ] Run `gh auth setup-git` so HTTPS pushes work.
- [ ] Rename the plugin itself (`plugin.json` `name`) to `claude-pixel-charts`?
      It renames the slash command and the MCP tool name.
- [ ] Offer the plugin to the organization's library.
