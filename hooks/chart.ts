export type Series = { name: string; values?: number[]; points?: { x: number; y: number }[] }
export type ChartSpec = {
  type: 'bar' | 'line' | 'scatter'
  title: string
  x: string[]
  series: Series[]
  /** Unix seconds, one per `x`: a time axis with round UTC ticks. */
  t?: number[]
}
type Rgb = [number, number, number]

const PALETTES: Record<'dark' | 'light', string[]> = {
  dark: [
    '#6cb6ff', '#f5a623', '#5fd38d', '#ff6b8b', '#b18cff', '#3fd0d4', '#e8d44d', '#ff9f6b', '#9be37a', '#f78fd6',
    '#7f8cff', '#4fe0b0', '#ffc8a0', '#c0a0ff', '#a0e0ff', '#d0d070', '#ff7070', '#70c0a0', '#c8c8c8', '#ffb0c8',
  ],
  light: [
    '#1f6feb', '#c46a12', '#1a8f4c', '#d63864', '#7a4fd6', '#0e8a90', '#a88b00', '#d1491a', '#4f8f1a', '#b0388f',
    '#3a48c8', '#0f8f6a', '#a0643a', '#6a3ab0', '#2a7fa8', '#7a7a1a', '#b81c1c', '#2f7a5a', '#5a5a5a', '#c0507a',
  ],
}

export const paletteOf = (isDark: boolean) => PALETTES[isDark ? 'dark' : 'light']

const rgbOf = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb

export function isChartSpec(v: unknown): v is ChartSpec {
  const s = v as ChartSpec
  return (
    !!s && ['bar', 'line', 'scatter'].includes(s.type) && typeof s.title === 'string' &&
    Array.isArray(s.x) && Array.isArray(s.series) && s.series.length > 0
  )
}

export type Tick = { at: number; label: string }
export type Axes = { yMin: number; yMax: number; xMin: number; xMax: number; yTicks: Tick[]; xTicks: Tick[] }

const TIME_STEPS = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800]
const pad2 = (n: number) => String(n).padStart(2, '0')

/** A round step (1, 2, 2.5 or 5 times a power of ten) giving at most `count` intervals over `span`. */
function niceStep(span: number, count: number) {
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  return ([1, 2, 2.5, 5, 10].find(m => m * mag >= raw) ?? 10) * mag
}

const ticksOf = (min: number, max: number, step: number, label: (v: number) => string) => {
  const ticks: Tick[] = []
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) {
    const at = Math.round(v / step) * step
    ticks.push({ at, label: label(at) })
  }
  return ticks
}

const fmtStep = (step: number) => (v: number) => {
  const a = Math.abs(v)
  if (a < step * 1e-6) return '0'
  if (a >= 1e9) return `${+(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${+(v / 1e6).toFixed(2)}M`
  if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}k`
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (step % 1 && (step * 10) % 1 ? 1 : 0))
  return v.toFixed(Math.min(decimals, 6))
}

function timeLabel(t: number, step: number) {
  const d = new Date(t * 1000)
  const day = `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  return step >= 86400 ? day : d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? day : time
}

/**
 * Rounded y ticks the bounds snap to, and x ticks with `at` as a fraction of
 * the plot's width: every few categories, round UTC times, or round numbers.
 */
export function axesOf(spec: ChartSpec, cols: number): Axes {
  const ys = spec.series.flatMap(s => s.values ?? s.points?.map(p => p.y) ?? []).filter(Number.isFinite)
  let lo = Math.min(...ys)
  let hi = Math.max(...ys)
  if (spec.type === 'bar' || (lo >= 0 && lo <= hi / 2)) lo = Math.min(0, lo)
  if (spec.type === 'bar') hi = Math.max(0, hi)
  if (hi === lo) [lo, hi] = lo === 0 ? [0, 1] : [lo - Math.abs(lo) / 2, hi + Math.abs(hi) / 2]
  const yStep = niceStep(hi - lo, 5)
  const yMin = Math.floor(lo / yStep + 1e-9) * yStep
  let yMax = Math.ceil(hi / yStep - 1e-9) * yStep
  if (spec.type !== 'bar' && yMax - hi < yStep * 0.02) yMax += yStep / 2
  const yTicks = ticksOf(yMin, yMax, yStep, fmtStep(yStep))

  const n = spec.x.length
  const target = Math.max(2, Math.floor(cols / 9))
  const byIndex = (i: number) => (i + 0.5) / Math.max(1, n)
  let xTicks: Tick[] = []
  let [xMin, xMax] = [0, 0]
  if (spec.type === 'scatter') {
    const xs = spec.series.flatMap(s => s.points?.map(p => p.x) ?? [])
    const xStep = niceStep(Math.max(...xs) - Math.min(...xs) || 1, target)
    xMin = Math.floor(Math.min(...xs) / xStep) * xStep
    xMax = Math.max(Math.ceil(Math.max(...xs) / xStep) * xStep, xMin + xStep)
    xTicks = ticksOf(xMin, xMax, xStep, fmtStep(xStep)).map(t => ({ ...t, at: (t.at - xMin) / (xMax - xMin) }))
  } else if (spec.t && spec.t.length === n && n > 1) {
    const [t0, tN] = [spec.t[0] ?? 0, spec.t[n - 1] ?? 0]
    const step = TIME_STEPS.find(st => (tN - t0) / st <= target) ?? 604800
    xTicks = ticksOf(t0, tN, step, t => timeLabel(t, step)).map(t => ({
      ...t,
      at: byIndex(((t.at - t0) / (tN - t0)) * (n - 1)),
    }))
  } else {
    const width = Math.max(...spec.x.map(l => l.length)) + 2
    const every = Math.max(1, Math.ceil((n * width) / cols))
    xTicks = spec.x.flatMap((label, i) => (i % every === 0 ? [{ at: byIndex(i), label }] : []))
  }
  return { yMin, yMax, xMin, xMax, yTicks, xTicks }
}

/** The plot's box inside a w x h canvas; the text around the image lines up with it. */
export function plotBox(w: number, h: number) {
  const s = Math.max(1, h / 120)
  const pad = Math.round(2 * s)
  return { s, left: 0, right: w - pad, top: pad, bottom: h - 1 - pad }
}

/** The x ticks as two text rows `cols` wide: tick marks, and labels that do not overlap. */
export function xAxisRows(ticks: Tick[], cols: number, w: number, h: number) {
  const box = plotBox(w, h)
  const [left, right] = [(box.left / w) * cols, (box.right / w) * cols]
  const marks = Array.from({ length: cols }, () => '─')
  const labels = Array.from({ length: cols }, () => ' ')
  let free = 0
  for (const { at, label } of ticks) {
    const col = Math.min(cols - 1, Math.max(0, Math.floor(left + at * (right - left))))
    marks[col] = '┬'
    const start = Math.min(cols - label.length, Math.max(0, col - Math.floor(label.length / 2)))
    if (start < free) continue
    labels.splice(start, label.length, ...label)
    free = start + label.length + 1
  }
  return [marks.join(''), labels.join('').trimEnd()]
}

/** The y tick labels, one entry per text row of the image, right-aligned to `width`. */
export function yAxisRows(axes: Axes, rows: number, width: number, w: number, h: number) {
  const out = Array.from({ length: rows }, () => ''.padStart(width))
  const { top, bottom } = plotBox(w, h)
  const used = new Set<number>()
  for (const { at, label } of axes.yTicks) {
    const y = bottom - ((at - axes.yMin) / (axes.yMax - axes.yMin)) * (bottom - top)
    const row = Math.min(rows - 1, Math.max(0, Math.floor((y / h) * rows)))
    if (used.has(row)) continue
    used.add(row)
    out[row] = `${label} ┤`.padStart(width)
  }
  return out
}

/** A straight-alpha RGBA canvas, transparent so the terminal's own background shows. */
class Canvas {
  readonly w: number
  readonly h: number
  readonly px: Uint8Array
  constructor(w: number, h: number, px?: Uint8Array) {
    this.w = w
    this.h = h
    this.px = px ?? new Uint8Array(w * h * 4)
  }
  blend(x: number, y: number, [r, g, b]: Rgb, a: number) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y * this.w + x) * 4
    const da = (this.px[i + 3] ?? 0) / 255
    const oa = a + da * (1 - a)
    const mix = (src: number, dst: number) => Math.round((src * a + dst * da * (1 - a)) / oa)
    this.px[i] = mix(r, this.px[i] ?? 0)
    this.px[i + 1] = mix(g, this.px[i + 1] ?? 0)
    this.px[i + 2] = mix(b, this.px[i + 2] ?? 0)
    this.px[i + 3] = Math.round(oa * 255)
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: Rgb, a = 1) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.w, Math.ceil(x1)); x++) {
        const cover = Math.min(x + 1, x1) - Math.max(x, x0)
        const coverY = Math.min(y + 1, y1) - Math.max(y, y0)
        this.blend(x, y, c, a * Math.max(0, cover) * Math.max(0, coverY))
      }
  }
  /** Anti-aliased thick segment: coverage from each pixel centre's distance to the segment. */
  line(ax: number, ay: number, bx: number, by: number, width: number, c: Rgb) {
    const r = width / 2
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy || 1
    for (let y = Math.floor(Math.min(ay, by) - r - 1); y <= Math.ceil(Math.max(ay, by) + r + 1); y++)
      for (let x = Math.floor(Math.min(ax, bx) - r - 1); x <= Math.ceil(Math.max(ax, bx) + r + 1); x++) {
        const px = x + 0.5
        const py = y + 0.5
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        this.blend(x, y, c, Math.max(0, Math.min(1, r + 0.5 - d)))
      }
  }
  dot(cx: number, cy: number, radius: number, c: Rgb) {
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++)
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        this.blend(x, y, c, Math.max(0, Math.min(1, radius + 0.5 - d)))
      }
  }
}

/** The plot's coordinates in a w x h canvas: one source for drawing and for hit-testing. */
function geometryOf(spec: ChartSpec, axes: Axes, w: number, h: number) {
  const { s, left, right, top, bottom } = plotBox(w, h)
  const n = spec.x.length
  const slot = (right - left) / Math.max(1, n)
  const group = slot * 0.8
  const bw = group / spec.series.length
  return {
    s, left, right, top, bottom, slot, group, bw,
    X: (i: number) => left + slot * (i + 0.5),
    XS: (v: number) => left + ((v - axes.xMin) / (axes.xMax - axes.xMin)) * (right - left),
    Y: (v: number) => bottom - ((v - axes.yMin) / (axes.yMax - axes.yMin)) * (bottom - top),
    barX: (i: number, si: number) => left + slot * (i + 0.5) - group / 2 + bw * si + Math.min(s, bw * 0.1),
    barW: bw - Math.min(2 * s, bw * 0.2),
    indexAt: (px: number) => Math.max(0, Math.min(n - 1, Math.floor((px - left) / slot))),
  }
}

/** Rasterizes the plot area alone: labels, title and legend are drawn as text around it. */
export function rasterize(spec: ChartSpec, axes: Axes, w: number, h: number, isDark: boolean): Uint8Array {
  const cv = new Canvas(w, h)
  const ink: Rgb = isDark ? [255, 255, 255] : [0, 0, 0]
  const colors = paletteOf(isDark).map(rgbOf)
  const { s, left, right, top, bottom, X, XS, Y, barX, barW } = geometryOf(spec, axes, w, h)

  for (const { at } of axes.yTicks) cv.rect(left, Y(at) - s / 2, right, Y(at) + s / 2, ink, at === 0 ? 0.3 : 0.1)
  for (const { at } of axes.xTicks) {
    const x = Math.floor(left + at * (right - left))
    cv.rect(x, top, x + s, bottom, ink, 0.06)
  }

  const isDense = spec.series.length > 6 || spec.x.length > 120
  const width = Math.max(1, (isDense ? 1.1 : 2) * s)
  spec.series.forEach((series, si) => {
    const c = colors[si % colors.length] ?? ink
    const values = series.values ?? []
    if (spec.type === 'bar') {
      values.forEach((v, i) => {
        if (Number.isFinite(v)) cv.rect(barX(i, si), Y(Math.max(0, v)), barX(i, si) + barW, Y(Math.min(0, v)), c)
      })
    } else if (spec.type === 'line') {
      for (let i = 1; i < values.length; i++) {
        const [a, b] = [values[i - 1] ?? NaN, values[i] ?? NaN]
        if (Number.isFinite(a) && Number.isFinite(b)) cv.line(X(i - 1), Y(a), X(i), Y(b), width, c)
      }
      values.forEach((v, i) => {
        const isolated = !Number.isFinite(values[i - 1] ?? NaN) && !Number.isFinite(values[i + 1] ?? NaN)
        if (Number.isFinite(v) && ((!isDense && values.length <= 40) || isolated)) cv.dot(X(i), Y(v), width * 1.2, c)
      })
    } else {
      for (const p of series.points ?? []) cv.dot(XS(p.x), Y(p.y), 2.8 * s, c)
    }
  })

  cv.rect(left, top, left + s, h, ink, 0.5)
  cv.rect(left, h - s, right, h, ink, 0.5)
  return cv.px
}

export type Tip = { series: number; name: string; x: string; y: string }

const fmtValue = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toPrecision(4)))

/**
 * The datum nearest the pointer (pixel `px`, `py`) and a copy of `base` with
 * a crosshair and that datum highlighted; undefined where there is none.
 */
export function hover(
  spec: ChartSpec, axes: Axes, base: Uint8Array, w: number, h: number, isDark: boolean, px: number, py: number,
): { pixels: Uint8Array; tip: Tip } | undefined {
  const g = geometryOf(spec, axes, w, h)
  const ink: Rgb = isDark ? [255, 255, 255] : [0, 0, 0]
  const colors = paletteOf(isDark).map(rgbOf)
  let best: { si: number; i: number; x: number; y: number; d: number } | undefined

  if (spec.type === 'scatter') {
    spec.series.forEach((series, si) =>
      (series.points ?? []).forEach((p, i) => {
        const [x, y] = [g.XS(p.x), g.Y(p.y)]
        const d = Math.hypot(x - px, y - py)
        if (!best || d < best.d) best = { si, i, x, y, d }
      }),
    )
  } else {
    const i = g.indexAt(px)
    const si = spec.type === 'bar'
      ? Math.max(0, Math.min(spec.series.length - 1, Math.floor((px - (g.X(i) - g.group / 2)) / g.bw)))
      : undefined
    spec.series.forEach((series, k) => {
      const v = series.values?.[i] ?? NaN
      if (!Number.isFinite(v) || (si !== undefined && k !== si)) return
      const d = Math.abs(g.Y(v) - py)
      if (!best || d < best.d) best = { si: k, i, x: g.X(i), y: g.Y(v), d }
    })
  }
  const hit = best
  if (!hit) return undefined

  const cv = new Canvas(w, h, new Uint8Array(base))
  const c = colors[hit.si % colors.length] ?? ink
  const series = spec.series[hit.si]
  cv.rect(hit.x - g.s / 2, g.top, hit.x + g.s / 2, g.bottom, ink, 0.35)
  if (spec.type === 'bar') {
    const v = series?.values?.[hit.i] ?? 0
    cv.rect(g.barX(hit.i, hit.si), g.Y(Math.max(0, v)), g.barX(hit.i, hit.si) + g.barW, g.Y(Math.min(0, v)), ink, 0.3)
  } else {
    if (spec.type === 'scatter') cv.rect(g.left, hit.y - g.s / 2, g.right, hit.y + g.s / 2, ink, 0.35)
    cv.dot(hit.x, hit.y, 4.5 * g.s, ink)
    cv.dot(hit.x, hit.y, 3.2 * g.s, c)
  }

  const point = spec.type === 'scatter' ? series?.points?.[hit.i] : undefined
  const tip: Tip = {
    series: hit.si,
    name: series?.name ?? '',
    x: point ? fmtValue(point.x) : (spec.x[hit.i] ?? '') + (spec.t ? ' UTC' : ''),
    y: fmtValue(point ? point.y : (series?.values?.[hit.i] ?? NaN)),
  }
  return { pixels: cv.px, tip }
}

const DEFAULT_COLOR = 0x01000000
const UPPER = 0x2580
const LOWER = 0x2584
const SPACE = 0x20

/**
 * Packs an RGBA canvas twice as tall as `rows` into Raster cells, two pixels per
 * cell with half blocks; a pixel under 40% alpha is the terminal's background.
 */
export function cellsOf(px: Uint8Array, columns: number, rows: number, isDark: boolean): string {
  const bg = isDark ? [24, 24, 24] : [255, 255, 255]
  const colorAt = (x: number, y: number) => {
    const i = (y * columns + x) * 4
    const a = (px[i + 3] ?? 0) / 255
    if (a < 0.4) return DEFAULT_COLOR
    const ch = (k: number) => Math.round((px[i + k] ?? 0) * a + (bg[k] ?? 0) * (1 - a))
    return (ch(0) << 16) | (ch(1) << 8) | ch(2)
  }
  const words = new Uint32Array(columns * rows * 3)
  for (let r = 0; r < rows; r++)
    for (let x = 0; x < columns; x++) {
      const top = colorAt(x, r * 2)
      const bottom = colorAt(x, r * 2 + 1)
      const o = (r * columns + x) * 3
      if (top === DEFAULT_COLOR && bottom === DEFAULT_COLOR) words.set([SPACE, DEFAULT_COLOR, DEFAULT_COLOR], o)
      else if (top === DEFAULT_COLOR) words.set([LOWER, bottom, DEFAULT_COLOR], o)
      else words.set([UPPER, top, bottom], o)
    }
  return toBase64(new Uint8Array(words.buffer))
}

const B64 = new TextEncoder().encode('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/')
const PAD = 61

/** Base64 of `bytes`: the runtime's own encoder where it has one, else a byte-buffer loop. */
export function toBase64(bytes: Uint8Array): string {
  if ('toBase64' in bytes && typeof bytes.toBase64 === 'function') return String(bytes.toBase64())
  const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4)
  let o = 0
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    out[o++] = B64[a >> 2] ?? PAD
    out[o++] = B64[((a & 3) << 4) | (b >> 4)] ?? PAD
    out[o++] = i + 1 < bytes.length ? (B64[((b & 15) << 2) | (c >> 6)] ?? PAD) : PAD
    out[o++] = i + 2 < bytes.length ? (B64[c & 63] ?? PAD) : PAD
  }
  return new TextDecoder().decode(out)
}
