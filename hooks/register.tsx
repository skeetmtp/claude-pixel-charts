import type { Elements, EngineInterface, Register } from 'claude-code'

import { specFromPrometheus } from './prometheus'
import {
  type Axes,
  axesOf,
  cellsOf,
  type ChartSpec,
  hover,
  isChartSpec,
  paletteOf,
  rasterize,
  toBase64,
  xAxisRows,
  yAxisRows,
} from './chart'
import type { HoverProps, HoverTip } from './hover'

const TOOL = /^mcp__.*pixel[-_]charts.*__draw_chart$/
const AUTO = /^mcp__.*grafana.*__query_prometheus$/
const DEMO = `Pixel-charts demo: call draw_chart three times, one call per sample below, then reply with one short line.
1. {"type":"bar","title":"Deploys per weekday","x":["Mon","Tue","Wed","Thu","Fri"],"series":[{"name":"prod","values":[12,18,9,15,4]},{"name":"staging","values":[20,25,17,22,8]}]}
2. {"type":"line","title":"p95 latency (ms)","x":["00h","03h","06h","09h","12h","15h","18h","21h"],"series":[{"name":"api","values":[180,150,140,260,310,290,240,200]},{"name":"front","values":[90,85,80,140,160,150,120,100]},{"name":"worker","values":[400,380,360,420,520,610,480,430]}]}
3. {"type":"scatter","title":"Request size vs latency","series":[{"name":"GET","points":[{"x":1,"y":20},{"x":2,"y":28},{"x":3,"y":31},{"x":5,"y":45},{"x":8,"y":60},{"x":9,"y":71}]},{"name":"POST","points":[{"x":2,"y":55},{"x":4,"y":70},{"x":6,"y":92},{"x":7,"y":101},{"x":10,"y":140}]}]}`

type Mode = 'image' | 'raster'
type Drawn = {
  cols: number
  rows: number
  w: number
  h: number
  mode: Mode
  isDark: boolean
  spec: ChartSpec
  axes: Axes
  /** The base picture: what a hover draws its crosshair over, and puts back on leave. */
  pixels: Uint8Array
  image?: string
  cells?: string
  /** Where the picture is mounted, for `$.ui.blit`. */
  site: string
  pictureKey: string
}

// Drawings are pure functions of their key, so a module cache that a reload empties is enough.
const cache = new Map<string, Drawn>()
const CACHE_SIZE = 20

async function modeOf($: EngineInterface, isFullscreen: boolean | undefined): Promise<Mode> {
  const forced = await $.env.get('PIXEL_CHARTS_MODE')
  if (forced === 'image' || forced === 'raster') return forced
  if (await $.env.get('TMUX')) return 'raster'
  const term = (await $.env.get('TERM')) ?? ''
  const program = (await $.env.get('TERM_PROGRAM')) ?? ''
  if (term.includes('kitty') || (await $.env.get('KITTY_WINDOW_ID'))) return 'image'
  if (term.includes('ghostty') || program === 'ghostty') return 'image'
  if (program === 'iTerm.app' && isFullscreen) return 'image'
  return 'raster'
}

async function isDarkTheme($: EngineInterface): Promise<boolean> {
  const row = (await $.config.list()).find(r => r.key === 'theme')
  const theme = String(row?.value ?? 'dark')
  if (theme.includes('light')) return false
  if (theme.includes('dark')) return true
  const bg = Number((await $.env.get('COLORFGBG'))?.split(';').pop())
  return !(bg === 7 || bg === 15)
}

function textsOf(output: unknown): string[] {
  const blocks: unknown[] = Array.isArray(output)
    ? output
    : output && typeof output === 'object' && 'content' in output && Array.isArray(output.content)
      ? output.content
      : [output]
  return blocks
    .map(block => (typeof block === 'string' ? block : (block as { text?: unknown })?.text))
    .filter((text): text is string => typeof text === 'string')
}

async function chartSpecOf($: EngineInterface, call: { tool: string; input: unknown; output?: unknown }) {
  if (TOOL.test(call.tool)) return specOf(call.output)
  if (!AUTO.test(call.tool) || (await $.env.get('PIXEL_CHARTS_AUTO')) === 'off') return undefined
  const expr = (call.input as { expr?: unknown } | undefined)?.expr
  return specFromPrometheus(textsOf(call.output), typeof expr === 'string' ? expr : 'Prometheus')
}

const summaryOf = (output: unknown) => textsOf(output).find(t => t.startsWith('Drew '))

function specOf(output: unknown): ChartSpec | undefined {
  for (const text of textsOf(output)) {
    for (const part of text.split('\n')) {
      try {
        const spec: unknown = JSON.parse(part)
        if (isChartSpec(spec)) return spec
      } catch {}
    }
  }
  return undefined
}

// What one tree may carry in Image sources, counted as base64 (the limit is the tree's, not each Image's).
const TREE_IMAGE_BUDGET = 2_000_000

/** Pixels for the picture: 8x16 a cell, less when `share` of the tree's Image budget cannot hold that. */
function pixelsOf(mode: Mode, cols: number, rows: number, share = 1) {
  if (mode !== 'image') return { w: cols, h: rows * 2 }
  const full = cols * 8 * rows * 16 * 4 * (4 / 3)
  const k = Math.min(1, Math.sqrt((TREE_IMAGE_BUDGET * share) / full)) * 0.98
  return { w: Math.max(cols, Math.floor(cols * 8 * k)), h: Math.max(rows, Math.floor(rows * 16 * k)) }
}

const encode = (mode: Mode, pixels: Uint8Array, cols: number, rows: number, isDark: boolean) =>
  mode === 'image' ? { image: toBase64(pixels) } : { cells: cellsOf(pixels, cols, rows, isDark) }

/** Puts `pixels` in the mounted picture without a render pass. */
function blit($: EngineInterface, d: Drawn, pixels: Uint8Array) {
  const enc = encode(d.mode, pixels, d.cols, d.rows, d.isDark)
  return enc.image !== undefined
    ? $.ui.blit({ requestId: d.site, key: d.pictureKey, source: { rgba: enc.image, width: d.w, height: d.h } })
    : $.ui.blit({ requestId: d.site, key: d.pictureKey, cells: enc.cells ?? '' })
}

/** The value box beside the cursor cell, on the side with room, never under it. */
function placeTip(d: Drawn, x: number, y: number, lines: string[]) {
  const [cx, cy] = [Math.floor(x), Math.floor(y)]
  const [tw, th] = [Math.max(...lines.map(l => l.length)) + 4, lines.length + 2]
  const col = cx + 3 + tw <= d.cols ? cx + 3 : Math.max(0, cx - 3 - tw)
  const row = cy - 1 - th >= 0 ? cy - 1 - th : Math.max(0, Math.min(d.rows - th, cy + 2))
  return { col, row }
}

type HoverMessage = { id: string; leave?: boolean; x?: number; y?: number }
const isHoverMessage = (v: unknown): v is HoverMessage =>
  !!v && typeof v === 'object' && typeof (v as HoverMessage).id === 'string'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pixel-charts-demo',
      description: 'Ask Claude to draw one sample bar, line and scatter chart',
    })
    return next(e)
  })

  on('command.run', { command: 'pixel-charts-demo' }, async $ => {
    void $.prompt.submit({ text: DEMO })
    return { text: 'Asked Claude to draw a bar, a line and a scatter sample.', isTextDisplayOnly: true }
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    await $.ui.invalidate('ui.render')
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const spec = e.props.isRunning || e.props.isErrored ? undefined : await chartSpecOf($, e.props)
    if (!spec || e.surface !== 'terminal') return next(e)
    const ui = $.ui.resolve(e)
    const chart = await chartOf($, ui, e.viewport, spec, e.requestId, e.requestId, 1)
    const row = await next(e)
    return (
      <ui.Box flexDirection="column">
        {row}
        {chart}
      </ui.Box>
    )
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const done = e.props.calls.filter(c => !c.isRunning && !c.isErrored)
    if (e.props.isExpanded || !done.some(c => TOOL.test(c.tool) || AUTO.test(c.tool)) || e.surface !== 'terminal')
      return next(e)
    const ui = $.ui.resolve(e)
    const picked: { spec: ChartSpec; id: string }[] = []
    let hasAuto = false
    for (let i = done.length - 1; i >= 0; i--) {
      const call = done[i]
      if (!call || (AUTO.test(call.tool) && hasAuto)) continue
      const spec = await chartSpecOf($, call)
      if (!spec) continue
      hasAuto ||= AUTO.test(call.tool)
      picked.unshift({ spec, id: call.tool_use_id ?? `${e.requestId}-${i}` })
    }
    const charts = []
    for (const { spec, id } of picked) charts.push(await chartOf($, ui, e.viewport, spec, id, e.requestId, 1 / picked.length))
    if (!charts.length) return next(e)
    const row = await next(e)
    return (
      <ui.Box flexDirection="column">
        {row}
        {charts}
      </ui.Box>
    )
  })

  on('ui.message', async ($, e, next) => {
    const msg = e.data
    const d = isHoverMessage(msg) ? cache.get(msg.id) : undefined
    if (!isHoverMessage(msg) || !d) return next(e)
    const cleared: HoverProps = { id: msg.id, tip: null }
    if (msg.leave || msg.x === undefined || msg.y === undefined) {
      await blit($, d, d.pixels)
      return { props: cleared }
    }
    const hit = hover(d.spec, d.axes, d.pixels, d.w, d.h, d.isDark, (msg.x / d.cols) * d.w, (msg.y / d.rows) * d.h)
    if (!hit) {
      await blit($, d, d.pixels)
      return { props: cleared }
    }
    await blit($, d, hit.pixels)
    const palette = paletteOf(d.isDark)
    const lines = [hit.tip.name, `x  ${hit.tip.x}`, `y  ${hit.tip.y}`]
    const tip: HoverTip = {
      lines,
      color: palette[hit.tip.series % palette.length] ?? 'text',
      background: d.isDark ? '#1c1c1c' : '#f6f6f6',
      ...placeTip(d, msg.x, msg.y, lines),
    }
    return { props: { id: msg.id, tip } satisfies HoverProps }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { tool, output, isErrored } = e.props
    const summary = TOOL.test(tool) && !isErrored && specOf(output) ? summaryOf(output) : undefined
    if (!summary || e.surface !== 'terminal') return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{summary}</Text>
  })
}

type Ui = ReturnType<EngineInterface['ui']['resolve']> & Elements['terminal']

async function chartOf(
  $: EngineInterface,
  { Box, Text, Image, Raster, Client }: Ui,
  viewport: { columns: number; isFullscreen?: boolean } | undefined,
  spec: ChartSpec,
  id: string,
  site: string,
  share: number,
) {
  const mode = await modeOf($, viewport?.isFullscreen)
  const isDark = await isDarkTheme($)
  const rows = mode === 'image' ? 16 : 12
  const probe = axesOf(spec, 80)
  const yWidth = Math.max(...probe.yTicks.map(t => t.label.length)) + 2
  const cols = Math.max(20, Math.min(200, (viewport?.columns ?? 80) - yWidth - 4))
  const axes = axesOf(spec, cols)
  const px = pixelsOf(mode, cols, rows, share)
  const key = `${id}|${mode}|${isDark}|${cols}|${px.w}x${px.h}`
  const pictureKey = `chart-${id}`
  let drawn = cache.get(key)
  if (!drawn || drawn.site !== site) {
    const pixels = drawn?.pixels ?? rasterize(spec, axes, px.w, px.h, isDark)
    const enc = drawn ?? encode(mode, pixels, cols, rows, isDark)
    drawn = { cols, rows, ...px, mode, isDark, spec, axes, pixels, image: enc.image, cells: enc.cells, site, pictureKey }
  }
  cache.delete(key)
  cache.set(key, drawn)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value ?? key)
  const hoverProps: HoverProps = { id: key, tip: null }

  const yRows = yAxisRows(axes, rows, yWidth, px.w, px.h)
  const [marks, labels] = xAxisRows(axes.xTicks, cols, px.w, px.h)
  const unit = spec.t ? ' UTC' : ''
  const palette = paletteOf(isDark)
  const alt = `${spec.type} chart: ${spec.title}`

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      <Text bold>{spec.title}</Text>
      <Box flexDirection="row">
        <Box flexDirection="column" width={yWidth}>
          {yRows.map(label => (
            <Text dimColor>{label}</Text>
          ))}
        </Box>
        <Box width={cols} height={rows}>
          {drawn.image ? (
            <Image
              key={pictureKey}
              source={{ rgba: drawn.image, width: px.w, height: px.h }}
              columns={cols}
              rows={rows}
              alt={alt}
            />
          ) : (
            <Raster key={pictureKey} columns={cols} rows={rows} cells={drawn.cells ?? ''} />
          )}
          {viewport?.isFullscreen && (
            <Box position="absolute" top={0} left={0}>
              <Client key={`hover-${id}`} module="./hover.tsx" props={hoverProps} width={cols} height={rows} />
            </Box>
          )}
        </Box>
      </Box>
      <Box flexDirection="column" marginLeft={yWidth}>
        <Text dimColor>{marks}</Text>
        <Text dimColor>
          {labels}
          {unit}
        </Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" marginLeft={yWidth}>
        {spec.series.map((s, i) => (
          <Text>
            <Text color={palette[i % palette.length]}>{spec.type === 'line' ? '━━' : '■'}</Text> {s.name}
            {'  '}
          </Text>
        ))}
      </Box>
    </Box>
  )
}
