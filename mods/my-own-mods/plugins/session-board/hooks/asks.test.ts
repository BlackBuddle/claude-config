import { expect, test } from 'claude-code/testing'

import { OLD_ASK_MS, STALE_MS, clipQuestion, closable, countAsks, groupOf, judge, openAsk, optionsLine, orphanIds, type Ask, type Watch } from './asks'
import { signalsOf } from './signals'

const NOW = 1_000_000_000_000
const ask = (p: Partial<Ask> = {}): Ask => ({ kind: 'request', question: '질문', background: [], options: [], at: NOW - 1000, ...p })
const watch = (p: Partial<Watch> = {}): Watch => ({ state: 'idle', updatedAt: NOW, ask: null, report: null, askClosedAt: 0, reportClosedAt: 0, ...p })

test('대화에서 신호를 뽑는다: 결재·알림·확인 표시 줄, 마지막 물음표 줄, 선택 카드, 코드 울타리 안은 신호가 아니다', () => {
  expect(signalsOf('보고.\n결재: DB를 바꾼다\n- 표가 3개다')).toMatchObject({ kind: 'request', lines: ['DB를 바꾼다'] })
  expect(signalsOf('알림: 노력 수준을 high로 바꾼다')).toMatchObject({ kind: 'notice' })
  expect(signalsOf('끝냈다.\npush하는가?')).toMatchObject({ kind: 'notice', lines: ['push하는가?'] }) // 물음표 줄은 다른 신호가 없을 때만
  expect(signalsOf('확인: 시험 13개 통과')).toMatchObject({ kind: undefined, reports: ['시험 13개 통과'] })
  expect(signalsOf('push했다.\n```\n결재: 예시\n```').kind).toBeUndefined()
  const card = signalsOf('', [{ tool_use_id: '', tool: 'AskUserQuestion', input: { questions: [{ question: '고르는가?', options: [{ label: 'A' }, { label: 'B' }] }] } } as never])
  expect(card).toMatchObject({ kind: 'notice', lines: ['고르는가?'], options: ['A', 'B'] })
  // 질문이 결재: 로 시작하면 결재다
  expect(signalsOf('', [{ tool_use_id: '', tool: 'AskUserQuestion', input: { questions: [{ question: '결재: 바꾸는가?', options: [] }] } } as never]).kind).toBe('request')
})

test('묶음은 결재 → 알림 → 확인 → 진행 중 → 유휴 순이고, 진행 중이면 이미 답한 것이다', () => {
  expect(groupOf(watch({ ask: ask() }), NOW)).toBe('request')
  expect(groupOf(watch({ ask: ask({ kind: 'notice' }) }), NOW)).toBe('notice')
  expect(groupOf(watch({ report: { lines: ['a'], at: NOW } }), NOW)).toBe('report')
  expect(groupOf(watch({ ask: ask(), report: { lines: ['a'], at: NOW } }), NOW)).toBe('request') // 둘 다 있으면 급한 쪽
  expect(groupOf(watch({ state: 'running', ask: ask() }), NOW)).toBe('running') // 결재함의 busy
  expect(groupOf(watch({ state: 'waiting' }), NOW)).toBe('notice') // 권한 승인 대기는 알림과 합친다
  expect(groupOf(watch(), NOW)).toBe('idle')
})

test('끝났거나 기록이 끊긴 세션도 칸이 있으면 남고, 칸이 없으면 숨긴다. 닫은 칸은 숨긴다', () => {
  expect(groupOf(watch({ state: 'ended', ask: ask() }), NOW)).toBe('request')
  expect(groupOf(watch({ state: 'ended' }), NOW)).toBe('hidden')
  expect(groupOf(watch({ state: 'running', updatedAt: NOW - STALE_MS - 1 }), NOW)).toBe('hidden')
  expect(groupOf(watch({ state: 'running', updatedAt: NOW - STALE_MS - 1, ask: ask({ kind: 'notice' }) }), NOW)).toBe('notice')
  const closed = watch({ ask: ask({ at: 5 }), askClosedAt: 5 })
  expect(openAsk(closed)).toBeNull()
  expect(groupOf(closed, NOW)).toBe('idle')
})

test('닫기는 알림, 끝난 세션, 24시간 넘은 결재에만 있다. 살아 있는 새 결재에는 없다', () => {
  expect(closable(watch({ ask: ask() }), NOW)).toBe(false)
  expect(closable(watch({ ask: ask({ at: NOW - OLD_ASK_MS - 1 }) }), NOW)).toBe(true) // 낡음
  expect(closable(watch({ state: 'ended', ask: ask() }), NOW)).toBe(true)
  expect(closable(watch({ ask: ask({ kind: 'notice' }) }), NOW)).toBe(true)
  expect(closable(watch({ state: 'waiting' }), NOW)).toBe(false) // 권한 승인 대기는 풀리면 사라진다
  expect(closable(watch(), NOW)).toBe(false)
})

test('판정: 새 기다림은 지금 시각, 이어지는 기다림은 처음 시각. 닫은 뒤의 기다림은 다시 열린다', () => {
  const sig = signalsOf('결재: 바꾸는가?\n결재: 배경 하나') // 표시 줄이 여러 개면 첫 줄이 질문, 나머지가 배경
  const first = judge(watch(), sig, 100, false)
  expect(first.ask).toMatchObject({ kind: 'request', question: '바꾸는가?', background: ['배경 하나'], at: 100 })
  const again = judge(watch({ ask: first.ask }), sig, 200, false)
  expect(again.ask?.at).toBe(100)
  // 사용자가 닫은 뒤(닫은 시각 150)에 같은 질문이 또 오면 새 기다림이다: at 이 닫은 시각보다 커서 다시 열린다
  const reopened = judge(watch({ ask: first.ask, askClosedAt: 150 }), sig, 300, false)
  expect(reopened.ask?.at).toBe(300)
  expect(openAsk({ ...watch(), ask: reopened.ask, askClosedAt: 150 })).not.toBeNull()
})

test('판정: 신호가 없으면 사용자 턴만 결재·알림을 닫고, 그 밖의 턴은 그대로 둔다', () => {
  const prev = watch({ ask: ask() })
  const none = signalsOf('끝냈다.')
  expect(judge(prev, none, NOW, true).ask).toBeNull()
  expect(judge(prev, none, NOW, false).ask).toEqual(prev.ask)
})

test('판정: 확인 줄은 이어 붙이고 같은 줄은 두 번 넣지 않는다. 닫은 확인은 새로 시작한다', () => {
  const one = judge(watch(), signalsOf('확인: a'), 10, false)
  expect(one.report).toEqual({ lines: ['a'], at: 10 })
  const two = judge(watch({ report: one.report }), signalsOf('확인: a\n확인: b'), 20, false)
  expect(two.report).toEqual({ lines: ['a', 'b'], at: 10 })
  const afterClose = judge(watch({ report: two.report, reportClosedAt: 15 }), signalsOf('확인: c'), 30, false)
  expect(afterClose.report).toEqual({ lines: ['c'], at: 30 })
  expect(judge(watch({ report: two.report }), signalsOf('끝냈다.'), 40, true).report).toEqual(two.report) // 확인은 눌러야 닫힌다
})

test('띠의 개수는 사용자를 기다리는 칸만 센다. 진행 중과 끝난 세션은 세지 않는다', () => {
  const list = [
    watch({ ask: ask() }),
    watch({ ask: ask({ kind: 'notice' }) }),
    watch({ state: 'waiting' }),
    watch({ report: { lines: ['a'], at: 1 } }),
    watch({ state: 'running', ask: ask() }),
    watch({ state: 'ended', ask: ask() }),
  ]
  expect(countAsks(list, NOW)).toEqual({ request: 1, notice: 2, report: 1 })
})

test('이어받기로 번호가 바뀐 세션의 옛 칸은 주인이 없다. 앱 번호가 없으면 찾지 않는다', () => {
  const rows = [
    { ...watch({ ask: ask() }), id: 'old', appId: 'local_a' },
    { ...watch({ ask: ask() }), id: 'me', appId: 'local_a' },
    { ...watch({ ask: ask() }), id: 'else', appId: 'local_b' },
    { ...watch({ state: 'ended', ask: ask() }), id: 'gone', appId: 'local_a' },
  ]
  expect(orphanIds(rows, 'local_a', 'me')).toEqual(['old'])
  expect(orphanIds(rows, null, 'me')).toEqual([])
})

test('질문은 60자에서 자르고, 선택지에 번호가 있으면 번호를 또 붙이지 않는다', () => {
  expect(clipQuestion('가'.repeat(61))).toBe(`${'가'.repeat(60)}…`)
  expect(optionsLine(['JSON 파일 (추천)', 'SQLite'])).toBe('① JSON 파일 (추천)  ② SQLite')
  expect(optionsLine(['1) a', '2) b'])).toBe('1) a  2) b')
})
