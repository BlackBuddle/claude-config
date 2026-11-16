import type { SessionMessage, ToolUseSummary } from 'claude-code'

// 대화에서 칸의 신호를 뽑는다 (PLAN 7절). 입출력이 없다

// 답의 표시 줄 (PLAN 7.1 신호 3). 줄 맨 앞(글머리표 뒤)에 있어야 한다
export const MARK = /^(결재|알림|확인)\s*[:：]\s*(.*)$/

export const CARD_TOOL = 'AskUserQuestion'

// $.session.messages()가 주는 최대 개수 (엔진 타입의 설명)
export const MAX_MESSAGES = 4096

// 앱의 질문 상자. 터미널 세션에는 없다
export const ASK_BOX_TOOL = 'mcp__ccd_turn__wrap_up'

// 대화에서 뽑은 신호. kind가 undefined이면 기다림이 없다
export type Signals = {
  kind: 'request' | 'notice' | undefined
  lines: string[]
  options: string[]
  reports: string[]
}

export type Asked = { question: string; options: string[] }

export type Marked = { mark: string; rest: string }

export function unique(lines: string[]): string[] {
  return [...new Set(lines)]
}

export function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
}

// 답의 줄에서 코드 울타리 안의 줄을 빼고 글머리표·강조를 뗀다
// 백틱은 남긴다: "`결재:` 줄을 쓴다" 같은 설명 줄이 신호가 되지 않게 한다. 칸에 보일 글에서만 뗀다 (markOf)
export function plainLines(answer: string): string[] {
  let isFenced = false
  const lines: string[] = []
  for (const raw of answer.split('\n')) {
    if (raw.trim().startsWith('```')) {
      isFenced = !isFenced
      continue
    }
    if (isFenced) continue
    const line = raw
      .replace(/\*/g, '')
      .replace(/^[\s>\-•]*(\d+[.)]\s+)?/, '')
      .trim()
    if (line !== '') lines.push(line)
  }

  return lines
}

export function markOf(line: string): Marked | undefined {
  const found = MARK.exec(line)

  return found ? { mark: found[1] ?? '', rest: unticked(found[2] ?? '') } : undefined
}

export function unticked(text: string): string {
  return text.replace(/`/g, '').trim()
}

// 선택 카드의 첫 질문과 그 선택지
export function cardAsk(input: Record<string, unknown>): Asked | undefined {
  const first = (Array.isArray(input.questions) ? input.questions[0] : undefined) as
    | { question?: unknown; options?: unknown }
    | undefined
  if (typeof first?.question !== 'string') return undefined
  const options = Array.isArray(first.options) ? first.options : []

  return {
    question: first.question,
    options: options.map(option => String((option as { label?: unknown })?.label ?? '')),
  }
}

// 질문 상자의 질문(ask)과 버튼 글(actions[].label). 앱 동작 버튼은 글이 없을 수 있다
export function askBoxAsk(input: Record<string, unknown>): Asked | undefined {
  if (typeof input.ask !== 'string' || input.ask.trim() === '') return undefined
  const actions = Array.isArray(input.actions) ? input.actions : []

  return {
    question: input.ask,
    options: strings(actions.map(action => (action as { label?: unknown })?.label)),
  }
}

// 턴 안의 질문: 답하지 않은 선택 카드 (신호 1), 질문 상자 (신호 2)
// 답한 선택 카드는 이미 끝난 기다림이다. 결과(text)가 없는 카드만 센다
export function asksOf(uses: readonly ToolUseSummary[]): Asked[] {
  return uses.flatMap(use => {
    if (use.tool === CARD_TOOL && use.text === undefined) return cardAsk(use.input) ?? []
    if (use.tool === ASK_BOX_TOOL) return askBoxAsk(use.input) ?? []

    return []
  })
}

// 마지막 답의 글과 그 턴의 도구 호출에서 신호를 뽑는다 (PLAN 7.2)
// 표시 줄은 턴의 모든 글(turnText)에서 찾는다. AI가 표시 줄을 턴 중간에 써도 놓치지 않는다 (2026-11-15 사용자 결정)
// 물음표 줄은 마지막 답에서만 찾는다
export function signalsOf(
  answer: string,
  uses: readonly ToolUseSummary[] = [],
  turnText = '',
): Signals {
  const lines = plainLines(answer)
  const asks = asksOf(uses)
  const marked = unique(plainLines(`${turnText}\n${answer}`))
    .map(markOf)
    .filter((m): m is Marked => m !== undefined)
  const waits: Marked[] = [
    ...asks.map(ask => {
      const own = markOf(ask.question)

      return { mark: own?.mark === '결재' ? '결재' : '알림', rest: own?.rest ?? unticked(ask.question) }
    }),
    ...marked.filter(m => m.mark !== '확인'),
  ].filter(wait => wait.rest !== '')
  const last = lines[lines.length - 1]
  // 물음표 줄은 다른 신호가 없을 때만 쓴다 (Q6)
  if (waits.length === 0 && last !== undefined && /[?？]$/.test(last)) {
    waits.push({ mark: '알림', rest: unticked(last) })
  }

  return {
    kind: waits.length === 0 ? undefined : waits.some(w => w.mark === '결재') ? 'request' : 'notice',
    lines: unique(waits.map(w => w.rest)),
    options: asks.flatMap(ask => ask.options).filter(option => option !== ''),
    reports: unique(marked.filter(m => m.mark === '확인' && m.rest !== '').map(m => m.rest)),
  }
}

// 대화의 마지막 턴의 assistant 메시지. from은 turn.start 때의 메시지 수다
// from이 없으면(세션 시작) 마지막 사용자 입력 뒤로 본다. 턴 안에 끼어든 알림이 턴을 자르므로 from을 먼저 쓴다
// messages()는 최근 4096개만 준다. 그 한도에 닿으면 from의 자리가 밀리므로 쓰지 않는다
export function lastTurn(
  messages: readonly SessionMessage[],
  from?: number,
): {
  text: string
  allText: string
  uses: ToolUseSummary[]
} {
  const isFromUsable = from !== undefined && from <= messages.length && messages.length < MAX_MESSAGES
  const start = isFromUsable
    ? from
    : messages.findLastIndex(
        message => message.role === 'user' && (message.toolResults ?? []).length === 0,
      ) + 1
  const turn = messages.slice(start).filter(message => message.role === 'assistant')

  return {
    text: turn.findLast(message => message.text !== '')?.text ?? '',
    allText: turn.map(message => message.text).join('\n'),
    uses: turn.flatMap(message => message.toolUses),
  }
}
