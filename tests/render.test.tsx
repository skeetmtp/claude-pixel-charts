import type { On } from 'claude-code'
import { expect, type Plugin, test } from 'claude-code/testing'

const SPEC = { type: 'line', title: 'Signups', x: ['Jan', 'Feb', 'Mar'], series: [{ name: 'Free', values: [120, 135, 150] }] }
const OUTPUT = [
  { type: 'text', text: 'Drew line chart "Signups": 1 series, 3 x values, y 120 to 150.' },
  { type: 'text', text: JSON.stringify(SPEC) },
]
const CALL = {
  tool_use_id: 'toolu_1',
  tool: 'mcp__plugin_pixel-charts_pixel-charts__draw_chart',
  input: SPEC,
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: OUTPUT,
}

for (const mode of ['raster', 'image'] as const) {
  test(`a collapsed group keeps its line and draws the chart as ${mode}`, async ($, on) => {
    on('env.get', (_, e) => ({ value: e.name === 'PIXEL_CHARTS_MODE' ? mode : undefined }))
    on('config.list', () => ({ value: [] }))
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>Called pixel-charts</Text>
    })

    const ui = await $.ui.mount({
      plugin: 'pixel-charts',
      surface: 'terminal',
      component: 'ToolGroup',
      requestId: 'group-1',
      props: { calls: [CALL], isActive: false, isExpanded: false },
    })

    expect(await ui.find({ type: 'Text', text: /Called pixel-charts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Signups' })).toBeDefined()
    expect(await ui.find({ key: 'chart-toolu_1' })).toBeDefined()
    await ui.unmount()
  })
}

test('a standalone result shows the summary, not the JSON', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'TERM' ? 'xterm-kitty' : undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'pixel-charts',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'toolu_1',
    props: { tool_use_id: 'toolu_1', tool: CALL.tool, output: OUTPUT, isErrored: false },
  })

  expect((await ui.find({ type: 'Text' }))?.text).toMatch(/^Drew line chart/)
  await ui.unmount()
})

const PROM = (ts: number) => [
  {
    type: 'text',
    text: JSON.stringify({
      data: [
        { metric: { rcode: 'NXDOMAIN' }, values: [[ts, '3.9'], [ts + 300, '5.2'], [ts + 600, '4.2']] },
        { metric: { rcode: 'SERVFAIL' }, values: [[ts, '0.28'], [ts + 300, 'NaN'], [ts + 600, '1.45']] },
      ],
    }),
  },
]
const grafana = (id: string, ts: number) => ({
  tool_use_id: id,
  tool: 'mcp__grafana__query_prometheus',
  input: { expr: 'sum by (rcode) (rate(unbound_answer_rcodes_total[5m]))', queryType: 'range' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: PROM(ts),
})

test('a group of Prometheus queries charts the newest one alone', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'TERM' ? 'xterm-kitty' : undefined }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>called grafana 2 times</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'pixel-charts',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'group-2',
    props: { calls: [grafana('toolu_a', 1795524373), grafana('toolu_b', 1795525373)], isActive: false, isExpanded: false },
  })

  expect(await ui.find({ key: 'chart-toolu_b' })).toBeDefined()
  expect(await ui.find({ key: 'chart-toolu_a' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /unbound_answer_rcodes_total/ })).toBeDefined()
  await ui.unmount()
})

test('PIXEL_CHARTS_AUTO=off leaves Prometheus rows to the engine', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'PIXEL_CHARTS_AUTO' ? 'off' : undefined }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'pixel-charts',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'group-3',
    props: { calls: [grafana('toolu_c', 1795524373)], isActive: false, isExpanded: false },
  })

  expect(await ui.find({ key: 'chart-toolu_c' })).toBeUndefined()
  await ui.unmount()
})

test('a newer instant query does not hide the range query before it', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'TERM' ? 'xterm-kitty' : undefined }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>called grafana 2 times</Text>
  })
  const instant = {
    ...grafana('toolu_i', 1795524373),
    input: { expr: 'sum by (instance) (rate(x[1h]))', queryType: 'instant' },
    output: [{ type: 'text', text: JSON.stringify({ data: [{ metric: { instance: 'a' }, value: [1795524373, '1'] }] }) }],
  }

  const ui = await $.ui.mount({
    plugin: 'pixel-charts',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'group-4',
    props: { calls: [grafana('toolu_r', 1795524373), instant], isActive: false, isExpanded: false },
  })

  expect(await ui.find({ key: 'chart-toolu_r' })).toBeDefined()
  await ui.unmount()
})

const LINE = {
  type: 'line',
  title: 'Latency',
  x: ['00h', '06h', '12h', '18h'],
  series: [
    { name: 'api', values: [10, 40, 20, 30] },
    { name: 'front', values: [5, 8, 6, 7] },
  ],
}
const LINE_CALL = { ...CALL, tool_use_id: 'toolu_h', input: LINE, output: [OUTPUT[0], { type: 'text', text: JSON.stringify(LINE) }] }

test('hovering the chart shows the nearest value, and leaving clears it', async ($, on) => {
  const blits: string[] = []
  on('env.get', (_, e) => ({ value: e.name === 'PIXEL_CHARTS_MODE' ? 'raster' : undefined }))
  on('config.list', () => ({ value: [] }))
  on('ui.blit', (_, e) => {
    blits.push(e.key)
    return { value: {} }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>called pixel-charts</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'pixel-charts',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'group-h',
    viewport: { columns: 60, rows: 40, isFullscreen: true },
    props: { calls: [LINE_CALL], isActive: false, isExpanded: false },
  })
  const cols = 60 - 6 - 4
  await ui.resize({ columns: cols, rows: 12 })

  // Second category (06h), near the top of the plot: api's 40.
  await ui.pointer({ type: 'move', x: Math.floor(cols * 0.375), y: 1 })
  expect(await ui.find({ type: 'Text', text: 'api', in: 'hover-toolu_h' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'x  06h', in: 'hover-toolu_h' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'y  40', in: 'hover-toolu_h' })).toBeDefined()
  expect(blits).toEqual(['chart-toolu_h'])

  await ui.pointer({ type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ type: 'Text', text: 'y  40', in: 'hover-toolu_h' })).toBeUndefined()
  expect(blits.length).toBe(2)
  await ui.unmount()
})

test('no hover layer on the main screen, where the terminal keeps the mouse', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'TERM' ? 'xterm-kitty' : undefined }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>called pixel-charts</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'pixel-charts',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'group-m',
    viewport: { columns: 60, rows: 40, isFullscreen: false },
    props: { calls: [LINE_CALL], isActive: false, isExpanded: false },
  })
  expect(await ui.find({ key: 'chart-toolu_h' })).toBeDefined()
  expect(await ui.find({ key: 'hover-toolu_h' })).toBeUndefined()
  await ui.unmount()
})

test('five full-width image charts in one group stay within the tree Image budget', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'PIXEL_CHARTS_MODE' ? 'image' : undefined }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>called grafana, pixel-charts 4 times</Text>
  })
  const calls = [
    ...['d1', 'd2', 'd3', 'd4'].map(id => ({ ...LINE_CALL, tool_use_id: id })),
    grafana('toolu_g', 1795524373),
  ]

  const ui = await $.ui.mount({
    plugin: 'pixel-charts',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'group-big',
    viewport: { columns: 230, rows: 60 },
    props: { calls, isActive: false, isExpanded: false },
  })

  for (const id of ['d1', 'd2', 'd3', 'd4', 'toolu_g']) expect(await ui.find({ key: `chart-${id}` })).toBeDefined()
  await ui.unmount()
})

test('one full-width image chart stays within the budget', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'PIXEL_CHARTS_MODE' ? 'image' : undefined }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>row</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'pixel-charts',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'toolu_w',
    viewport: { columns: 230, rows: 60 },
    props: { ...LINE_CALL, tool_use_id: 'toolu_w' },
  })

  expect(await ui.find({ key: 'chart-toolu_w' })).toBeDefined()
  await ui.unmount()
})

const NO_KITTY = (_: unknown, e: { name: string }) => ({ value: e.name === 'TERM' ? 'xterm-256color' : undefined })

test('without kitty graphics the chart is left to the engine and easel', async ($, on) => {
  on('env.get', NO_KITTY)
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>called grafana</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'pixel-charts',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'group-n',
    viewport: { columns: 100, rows: 40 },
    props: { calls: [grafana('toolu_n', 1795524373)], isActive: false, isExpanded: false },
  })

  expect(await ui.find({ key: 'chart-toolu_n' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'called grafana' })).toBeDefined()
  await ui.unmount()
})

/** A plugin beside pixel-charts: lists the tools through its hooks, and toasts what it saw. */
const PROBE: Plugin = {
  name: 'probe',
  register(on) {
    on('session.start', async ($, e, next) => {
      const tools = (await $.tool.list()).map(t => t.name)
      $.ui.toast(JSON.stringify({ tools }))
      return next(e)
    })
  },
}

const probed = (on: On) => {
  const seen: { tools?: string[] } = {}
  on('ui.toast', (_, e) => {
    Object.assign(seen, JSON.parse(e.text))
    return { value: undefined }
  })
  return seen
}

const engineBeneath = (on: On) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.list', () => ({
    value: [
      { name: 'mcp__plugin_pixel-charts_pixel-charts__draw_chart', description: '', mcp: true },
      { name: 'mcp__easel__chart', description: '', mcp: true },
    ],
  }))
}

test('without kitty graphics draw_chart is withdrawn', { plugins: [PROBE] }, async ($, on) => {
  on('env.get', NO_KITTY)
  const noKittySeen = probed(on)
  engineBeneath(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(noKittySeen.tools).toEqual(['mcp__easel__chart'])
})

test('with kitty graphics draw_chart stays', { plugins: [PROBE] }, async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'TERM_PROGRAM' ? 'ghostty' : undefined }))
  const kittySeen = probed(on)
  engineBeneath(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(kittySeen.tools?.length).toBe(2)
})

const KITTY = (_: unknown, e: { name: string }) => ({ value: e.name === 'TERM' ? 'xterm-kitty' : undefined })

test('a charted Prometheus result is not handed to the hooks beneath, so easel does not chart it again', async ($, on) => {
  on('env.get', KITTY)
  on('config.list', () => ({ value: [] }))
  let beneath: readonly { tool: string; output?: unknown }[] = []
  on('ui.render', ($, e) => {
    if (e.component === 'ToolGroup') beneath = e.props.calls
    const { Text } = $.ui.resolve(e)
    return <Text>called grafana 2 times</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'pixel-charts',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'group-e',
    viewport: { columns: 100, rows: 40 },
    props: { calls: [grafana('toolu_e1', 1795524373), LINE_CALL], isActive: false, isExpanded: false },
  })

  expect(await ui.find({ key: 'chart-toolu_e1' })).toBeDefined()
  expect(beneath.map(c => c.output === undefined)).toEqual([true, false])
  await ui.unmount()
})

test('without kitty graphics the hooks beneath get every result, for easel to chart', async ($, on) => {
  on('env.get', NO_KITTY)
  on('config.list', () => ({ value: [] }))
  let beneath: readonly { tool: string; output?: unknown }[] = []
  on('ui.render', ($, e) => {
    if (e.component === 'ToolGroup') beneath = e.props.calls
    const { Text } = $.ui.resolve(e)
    return <Text>called grafana</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'pixel-charts',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'group-f',
    viewport: { columns: 100, rows: 40 },
    props: { calls: [grafana('toolu_f1', 1795524373)], isActive: false, isExpanded: false },
  })

  expect(beneath[0]?.output).toBeDefined()
  await ui.unmount()
})
