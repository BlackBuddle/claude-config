export type Decision = {
  id: string
  // 대기열 파일의 전체 경로. 답을 이 파일에 쓴다
  path: string
  project: string
  // 결정을 올린 세션의 번호. mod가 쓴다. 답은 이 세션에 전달된다
  session: string
  // 결정을 올린 세션을 앱에서 여는 주소. mod가 쓴다. 없으면 빈 문자열
  link: string
  // 결정을 올린 세션의 프로젝트. mod가 쓴다. 패널이 "이 프로젝트"를 가리는 데 쓴다
  root: string
  isBlocking: boolean
  isBroken: boolean
  question: string
  options: string[]
  // 선택지마다 "고르면 일어나는 일" 1줄. options와 순서가 같다. 없으면 빈 문자열
  effects: string[]
  // 판단에 필요한 사실의 요약. 줄마다 1개. 없으면 빈 목록
  background: string[]
  recommend: number
  reason: string
  blocked: string
  // 사용자가 고른 답. 없으면 빈 문자열
  answer: string
  // 답한 시각 (ms). 없으면 0. 이 시각부터 취소 시간을 잰다
  answeredAt: number
  // 결정을 올린 세션이 답을 받았는가
  isDelivered: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'decision-rack': {
      units: Shaped<Decision[]>
      // '' = 첫 미답 줄을 자동으로 연다. 그 밖 = 그 번호의 줄을 연다
      openId: string
      // 결정 번호 → 이 세션의 패널에서 답한 결정 1줄. 이 세션의 다음 입력에 참고 글로 붙인다
      notes: Record<string, string>
      // 값의 뜻은 없다. 취소 시간이 흐르는 동안 패널을 다시 그리게 한다
      tick: number
    }
  }
}
