import type { ClientModule } from 'claude-code'

type SlotProps = {
  id: string
  kind: 'request' | 'notice' | 'report'
  isBroken: boolean
  // 사용자가 답했고 세션이 일한다. 흐리게 그린다 (2026-11-15 사용자 결정, Q3)
  isBusy: boolean
  // 칸의 세션이 끝났다 (보관, 앱 종료). 흐리게 그리고 '세션 끝남'이라고 쓴다
  isEnded: boolean
  project: string
  // 칸의 나이 ("3분 전"). 모르면 빈 글자
  age: string
  question: string
  isOpen: boolean
}

// 결재는 빨강, 알림은 노랑, 확인은 초록이다 (2026-11-15 사용자 결정)
const LOOK = {
  request: { color: 'error', label: '결재' },
  notice: { color: 'warning', label: '알림' },
  report: { color: 'success', label: '확인' },
} as const

// 칸의 윗부분이다. Button은 글자만 눌린다. 이 모듈은 포인터를 직접 받아서 영역 전체가 눌린다
// 누르면 hooks 모듈에 칸의 번호를 보낸다. 펴기와 이동은 hooks 모듈이 정한다
const Slot: ClientModule<SlotProps> = (props, surface) => {
  const { Box, Text } = surface.elements
  const look = LOOK[props.kind]
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
        <Text color={look.color} size="caption" weight="semibold" dimColor={props.isBusy || props.isEnded}>
          ● {props.isBroken ? '오류' : props.isEnded ? '세션 끝남' : props.isBusy ? '진행 중' : look.label}
        </Text>
        <Text size="caption">{props.project}</Text>
        <Text dimColor size="caption">
          {props.age}
        </Text>
      </Box>
      {props.isOpen ? (
        <Text weight="semibold" size="heading" dimColor={props.isBusy || props.isEnded}>
          {props.question}
        </Text>
      ) : (
        <Text dimColor={props.kind === 'report' || props.isBusy || props.isEnded}>{props.question}</Text>
      )}
    </Box>
  )
}

export default Slot
