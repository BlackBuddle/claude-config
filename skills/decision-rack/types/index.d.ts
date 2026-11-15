// 결재: 되돌리기 어려운 결정 (빨강). 알림: 그 밖에 사용자가 할 일 (노랑). 확인: 이미 진행했다 (초록)
export type Kind = 'request' | 'notice' | 'report'

// waiting: 세션이 사용자를 기다린다. busy: 사용자가 답했고 세션이 일한다 (흐리게). closed: 끝났다 (숨긴다)
export type State = 'waiting' | 'busy' | 'closed'

export type Decision = {
  // 파일 이름에서 .json을 뗀 것: <세션 번호 앞 8자>-wait 또는 -report
  id: string
  // 대기열 파일의 전체 경로
  path: string
  project: string
  kind: Kind
  state: State
  // waiting이 새로 시작된 시각 (ms). 알림 키와 칸의 시간 표시에 쓴다
  raisedAt: number
  // 칸의 주인 세션의 번호
  session: string
  // 주인 세션을 앱에서 여는 주소. 터미널 세션은 빈 문자열
  link: string
  // 주인 세션의 프로젝트 키. 패널이 "이 프로젝트"를 가리는 데 쓴다
  root: string
  isBroken: boolean
  question: string
  options: string[]
  // 질문 아래의 줄. 확인 칸은 첫 줄 다음의 줄들
  background: string[]
  // 읽지 못한 칸의 오류 내용. 그 밖에는 빈 문자열
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    'decision-rack': {
      units: Shaped<Decision[]>
      // '' = 첫 칸을 자동으로 연다. 그 밖 = 그 번호의 칸을 연다
      openId: string
      // 사용자가 패널을 직접 닫았는가. 닫았으면 세션 시작과 리로드 때 다시 열지 않는다
      isDismissed: boolean
    }
  }
}
