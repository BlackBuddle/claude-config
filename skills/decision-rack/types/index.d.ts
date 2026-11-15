// 결재: 세션이 멈추고 답을 기다린다 (빨강). 알림: 선택이 필요하다 (노랑). 확인: 이미 진행했다 (초록)
export type Kind = 'request' | 'notice' | 'report'

export type Decision = {
  id: string
  // 대기열 파일의 전체 경로
  path: string
  project: string
  kind: Kind
  // 결정을 올린 세션의 번호. mod가 쓴다. 이 세션에 사용자가 입력하면 칸을 내린다
  session: string
  // 결정을 올린 세션을 앱에서 여는 주소. mod가 쓴다. 없으면 빈 문자열
  link: string
  // 결정을 올린 세션의 프로젝트. mod가 쓴다. 패널이 "이 프로젝트"를 가리는 데 쓴다
  root: string
  isBroken: boolean
  question: string
  options: string[]
  // 판단에 필요한 사실의 요약 1~2줄. 없으면 빈 목록. 전체 자료는 세션의 대화에 있다
  background: string[]
  recommend: number
  // 읽지 못한 칸의 오류 내용. 그 밖에는 빈 문자열
  error: string
  // 결재함에서 내린 칸인가. 사용자가 그 세션에 입력했거나 확인을 눌렀다
  isWithdrawn: boolean
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
