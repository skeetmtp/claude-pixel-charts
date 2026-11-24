import type { ChartSpec } from './chart'

type Sample = [number, string]
type Matrix = { metric?: Record<string, string>; values?: Sample[] }[]

const MAX_SERIES = 20

function matrixOf(text: string): Matrix | undefined {
  let json: { data?: unknown; result?: unknown }
  try {
    json = JSON.parse(text)
  } catch {
    return undefined
  }
  const data = json?.data as { result?: unknown } | unknown[] | undefined
  const rows = Array.isArray(data) ? data : (data?.result ?? json?.result)
  if (!Array.isArray(rows)) return undefined
  const matrix = rows.filter((r): r is Matrix[number] => Array.isArray(r?.values) && r.values.length > 1)
  return matrix.length ? matrix : undefined
}

const nameOf = (metric: Record<string, string> = {}) => {
  const { __name__, ...labels } = metric
  const parts = Object.values(labels)
  const name = parts.length ? parts.join(' · ') : (__name__ ?? 'value')
  return name.length > 32 ? `${name.slice(0, 31)}…` : name
}

const pad = (n: number) => String(n).padStart(2, '0')

function labelOf(ts: number) {
  const d = new Date(ts * 1000)
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** A Prometheus range result as a line chart: the 20 series with the highest peak, gaps as NaN. */
export function specFromPrometheus(texts: string[], expr: string): ChartSpec | undefined {
  const matrix = texts.map(matrixOf).find(Boolean)
  if (!matrix) return undefined
  const stamps = [...new Set(matrix.flatMap(r => (r.values ?? []).map(([t]) => t)))].sort((a, b) => a - b)
  const index = new Map(stamps.map((t, i) => [t, i]))
  const series = matrix
    .map(r => {
      const values: number[] = stamps.map(() => NaN)
      for (const [t, v] of r.values ?? []) values[index.get(t) ?? 0] = Number(v)
      const peak = Math.max(...values.filter(Number.isFinite))
      return { name: nameOf(r.metric), values, peak }
    })
    .filter(s => Number.isFinite(s.peak))
    .sort((a, b) => b.peak - a.peak)
    .slice(0, MAX_SERIES)
    .map(({ name, values }) => ({ name, values }))
  if (!series.length) return undefined
  const more = matrix.length > MAX_SERIES ? ` (top ${MAX_SERIES} of ${matrix.length})` : ''
  const title = (expr.length > 90 ? `${expr.slice(0, 89)}…` : expr) + more
  return { type: 'line', title, x: stamps.map(labelOf), t: stamps, series }
}
