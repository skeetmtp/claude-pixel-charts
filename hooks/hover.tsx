import type { ClientModule } from 'claude-code'

export type HoverTip = { lines: string[]; color: string; background: string; col: number; row: number }
export type HoverProps = { id: string; tip: HoverTip | null }

/**
 * Sits over a chart's picture: posts the pointer's cell (sub-cell where the
 * terminal reports it) and draws the value box the hooks module answers.
 */
const Hover: ClientModule<HoverProps, true> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.onPointer(ev => {
      if (ev.type === 'leave') surface.post({ id: props.id, leave: true })
      else if (ev.type === 'move' || ev.type === 'enter')
        surface.post({ id: props.id, x: ev.fine?.x ?? ev.x + 0.5, y: ev.fine?.y ?? ev.y + 0.5 })
    })
    surface.setState(true)
  }
  const { tip } = props
  return (
    <Box width={surface.columns} height={surface.rows}>
      {tip && (
        <Box
          position="absolute"
          top={tip.row}
          left={tip.col}
          flexDirection="column"
          borderStyle="round"
          borderColor={tip.color}
          backgroundColor={tip.background}
          paddingX={1}
        >
          {tip.lines.map((line, i) => (
            <Text bold={i === 0} color={i === 0 ? tip.color : undefined}>
              {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

export default Hover
