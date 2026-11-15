import type { ClientModule } from 'claude-code'

type SlotProps = {
  id: string
  label: string
  isBlocking: boolean
  project: string
  question: string
  isOpen: boolean
}

// 칸의 윗부분이다. Button은 글자만 눌린다. 이 모듈은 포인터를 직접 받아서 영역 전체가 눌린다
// 누르면 hooks 모듈에 칸의 번호를 보낸다. 펴기와 이동은 hooks 모듈이 정한다
const Slot: ClientModule<SlotProps> = (props, surface) => {
  const { Box, Text } = surface.elements
  surface.onPointer(event => {
    if (event.type === 'up' && event.button !== 'right') surface.post({ id: props.id })
  })
  // 클릭으로 초점을 받은 뒤에는 Enter도 같은 동작을 한다
  surface.onKey(event => {
    if (event.key === 'return') surface.post({ id: props.id })
  })

  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" gap="sm">
        <Text color={props.isBlocking ? 'error' : 'inactive'} size="caption" weight="semibold">
          {props.label}
        </Text>
        <Text size="caption">{props.project}</Text>
        <Text dimColor mono size="caption">
          {props.id}
        </Text>
      </Box>
      {props.isOpen ? (
        <Text weight="semibold" size="heading">
          {props.question}
        </Text>
      ) : (
        <Text dimColor={!props.isBlocking}>{props.question}</Text>
      )}
    </Box>
  )
}

export default Slot
