export type Decision = {
  id: string
  project: string
  session: string
  isBlocking: boolean
  isBroken: boolean
  question: string
  options: string[]
  recommend: number
  reason: string
  blocked: string
}

declare module 'claude-code' {
  interface PluginState {
    'decision-rack': {
      units: Shaped<Decision[]>
      // '' = 첫 미답 줄을 자동으로 연다. '-' = 모든 줄을 닫는다. 그 밖 = 그 번호의 줄을 연다
      openId: string
      // 결정 번호 → 사용자가 고른 답. 입력창에 썼고 아직 처리되지 않은 것
      answers: Record<string, string>
    }
  }
}
