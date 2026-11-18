// 사용자를 기다리는 칸(결재·알림·확인)의 판정. 입출력이 없는 순수 함수만 둔다.
// 결재함(decision-rack)의 units.ts 에서 옮겨 세션 기록 하나(state + ask + report)에 맞췄다.

import { strings } from './signals'
import type { Signals } from './signals'

export const STALE_MS = 90_000 // 90초 넘게 기록이 없으면 죽은 세션으로 본다
export const OLD_ASK_MS = 24 * 60 * 60 * 1000 // 이보다 오래된 결재는 "낡음"이라 닫을 수 있다
export const MAX_QUESTION_CHARS = 60

export type AskKind = 'request' | 'notice'
// 결재 = 이 세션에서 답해야 하는 것, 알림 = 알아야 하는 것
export type Ask = { kind: AskKind; question: string; background: string[]; options: string[]; at: number }
// 확인 = 사용자가 읽고 눌러서 닫는 보고. 결재·알림과 같이 있을 수 있어 칸을 따로 둔다
export type Report = { lines: string[]; at: number }

// 닫기는 칸을 지우지 않고 닫은 시각을 쓴다. 다른 세션의 패널이 쓰고, 주인 세션은 자기 기록을 다시 쓸 때 이 값을 읽어 합친다
export type Marks = { ask: Ask | null; report: Report | null; askClosedAt: number; reportClosedAt: number }

export type Phase = 'running' | 'waiting' | 'idle' | 'ended'
export type Watch = Marks & { state: Phase; updatedAt: number }

// 급한 순서. 이 순서로 묶고 이 순서로 보인다
export type Group = 'request' | 'notice' | 'report' | 'running' | 'hidden'

export function clipQuestion(text: string): string {
  return text.length > MAX_QUESTION_CHARS ? `${text.slice(0, MAX_QUESTION_CHARS)}…` : text
}

/** 파일의 ask 를 읽는다. 모양이 틀리면 null. */
export function parseAsk(raw: any): Ask | null {
  if (raw === null || typeof raw !== 'object') return null
  if ((raw.kind !== 'request' && raw.kind !== 'notice') || typeof raw.question !== 'string' || !Number.isFinite(raw.at)) return null
  return { kind: raw.kind, question: raw.question, background: strings(raw.background), options: strings(raw.options), at: raw.at }
}

export function parseReport(raw: any): Report | null {
  if (raw === null || typeof raw !== 'object' || !Number.isFinite(raw.at)) return null
  const lines = strings(raw.lines)
  return lines.length > 0 ? { lines, at: raw.at } : null
}

/** 닫지 않은 결재·알림. 닫은 뒤에 새로 생긴 것(at 이 더 큼)은 다시 열린 칸이다. */
export const openAsk = (r: Marks): Ask | null => (r.ask !== null && r.ask.at > r.askClosedAt ? r.ask : null)
export const openReport = (r: Marks): Report | null => (r.report !== null && r.report.at > r.reportClosedAt ? r.report : null)

/** 끝난 세션이거나 기록이 끊긴 세션. 칸은 남지만 그 세션은 더 답하지 못할 수 있다. */
export const isDead = (r: Watch, now: number): boolean => r.state === 'ended' || now - r.updatedAt > STALE_MS

/** 죽은 세션의 표시. 끝낸 세션과 기록만 끊긴 세션(절전, 앱 멈춤)을 나눈다: 끊긴 세션은 아직 살아 있을 수 있다. */
export const deadLabel = (r: Watch): string => (r.state === 'ended' ? '세션 끝남' : '응답 없음')

export function groupOf(r: Watch, now: number): Group {
  const ask = openAsk(r)
  const report = openReport(r)
  if (isDead(r, now)) return ask ? ask.kind : report ? 'report' : 'hidden'
  // 진행 중이면 사용자가 이미 답한 것이다. 칸은 두되 진행 중으로 묶는다 (결재함의 busy)
  if (ask && r.state !== 'running') return ask.kind
  // 권한 승인 대기는 알림과 같게 센다
  if (r.state === 'waiting') return 'notice'
  if (report) return 'report'
  // 쉬는 세션은 보이지 않는다: 기다리는 것과 일하는 것만 보인다. 세션 목록은 앱 사이드바에 있다 (2026-11-16 사용자 결정)
  return r.state === 'running' ? 'running' : 'hidden'
}

/**
 * 닫기 단추를 둘 칸인가. 살아 있는 새 결재에는 두지 않는다: 그 세션에서 답해야 사라진다.
 * 결재는 세션이 실제로 끝났거나(ended) 24시간이 지났을 때만 닫는다. 기록만 끊긴 세션은 절전에서 깨어난 직후일 수 있어 닫지 않는다.
 */
export function closable(r: Watch, now: number): boolean {
  const ask = openAsk(r)
  if (!ask) return false
  if (ask.kind === 'notice') return true
  return r.state === 'ended' || now - ask.at > OLD_ASK_MS
}

/** 정리 때 지워도 되는 기록인가. 열린 칸이 있으면 keepOpenMs 까지 남긴다: 사용자가 아직 보지 않았다. */
export function purgeable(r: Marks | null, ageMs: number, keepMs: number, keepOpenMs: number): boolean {
  if (ageMs <= keepMs) return false
  return r === null || (openAsk(r) === null && openReport(r) === null) || ageMs > keepOpenMs
}

/** 상태 띠의 개수: 사용자를 기다리는 칸만 센다. 진행 중인 칸과 끝난 세션은 세지 않는다. */
export function countAsks(list: Watch[], now: number): { request: number; notice: number; report: number } {
  const n = { request: 0, notice: 0, report: 0 }
  for (const r of list) {
    if (isDead(r, now)) continue
    const g = groupOf(r, now)
    if (g === 'request' || g === 'notice' || g === 'report') n[g] += 1
  }
  return n
}

/** 신호로 이 세션의 결재·알림과 확인을 새로 정한다. isQuiet 이면(사용자가 입력한 턴이 신호 없이 끝남) 결재·알림을 닫는다. */
export function judge(prev: Marks, signals: Signals, now: number, isQuiet: boolean): { ask: Ask | null; report: Report | null } {
  const old = openAsk(prev)
  const ask: Ask | null =
    signals.kind === undefined
      ? isQuiet
        ? null
        : prev.ask
      : {
          kind: signals.kind,
          question: clipQuestion(signals.lines[0] ?? ''),
          background: signals.lines.slice(1),
          options: signals.options,
          // 이어지는 기다림이면 처음 시각을 지킨다. 새 기다림이면 지금이다 (다시 알리고 낡음 계산을 새로 한다)
          at: old ? old.at : now,
        }
  const oldReport = openReport(prev)
  const lines = oldReport?.lines ?? []
  const added = signals.reports.filter(line => !lines.includes(line))
  const report: Report | null = added.length === 0 ? prev.report : { lines: [...lines, ...added], at: oldReport ? oldReport.at : now }
  return { ask, report }
}

const NUMBERED = /^\s*([①-⑳]|\d+[.)])/
const CIRCLED = '①②③④⑤⑥⑦⑧⑨'

/** 선택지를 1줄로 쓴다: '① JSON 파일 (추천)  ② SQLite'. 이름이 이미 번호로 시작하면 번호를 또 붙이지 않는다. */
export function optionsLine(options: string[]): string {
  return options.map((label, i) => (NUMBERED.test(label) ? label : `${CIRCLED[i] ?? `${i + 1}.`} ${label}`)).join('  ')
}

/** 같은 앱 세션이 이어받기 등으로 새 세션 번호를 받으면 옛 번호의 결재·알림은 주인이 없다. 그 번호들을 돌려준다. */
export function orphanIds(list: (Watch & { id: string; appId: string | null })[], appId: string | null, selfId: string): string[] {
  if (appId === null) return []
  return list.filter(r => r.appId === appId && r.id !== selfId && openAsk(r) !== null && r.state !== 'ended').map(r => r.id)
}

/** 앱 링크로 쓸 번호인가. 파일의 값이 이 모양일 때만 OS 에 넘긴다. */
export const APP_ID_FORMAT = /^local_[0-9a-f-]+$/

/** 다른 세션 안에서 띄운 세션인가 (예: 앱 세션의 Bash 가 실행한 claude -p). 부모는 자기 번호를 CLAUDE_CODE_SESSION_ID 로 물려준다. */
export const isNestedSession = (parentId: string | undefined, sessionId: string): boolean => parentId !== undefined && parentId !== '' && parentId !== sessionId
