import type { Decision, Kind, State } from '../types'
import { strings } from './signals'
import type { Signals } from './signals'

// 칸 파일의 해석과 다음 상태의 계산. 입출력이 없다

export const SESSION_LINK_FORMAT = /^claude:\/\/claude\.ai\/epitaxy\/local_[0-9a-f-]+$/

// 급한 순서. 이 순서로 쌓고, 이 순서로 줄에 쓴다
export const KIND_ORDER: Kind[] = ['request', 'notice', 'report']

export const STATES: State[] = ['waiting', 'busy', 'closed']

export const MAX_QUESTION_CHARS = 60

export const CIRCLED = '①②③④⑤⑥⑦⑧⑨'

// 결재는 빨강, 알림은 노랑, 확인은 초록이다 (2026-11-15 사용자 결정)
export const KIND_LOOK = {
  request: { color: 'error', label: '결재' },
  notice: { color: 'warning', label: '알림' },
  report: { color: 'success', label: '확인' },
} as const

export type UnitFile = Record<string, unknown>

export function slashed(path: string): string {
  return path.replace(/\\/g, '/')
}

export function clip(text: string): string {
  return text.length > MAX_QUESTION_CHARS ? `${text.slice(0, MAX_QUESTION_CHARS)}…` : text
}

// 선택지를 1줄로 쓴다: '① JSON 파일 (추천)  ② SQLite'
export function optionsLine(unit: Decision): string {
  return unit.options.map((label, i) => `${CIRCLED[i] ?? `${i + 1}.`} ${label}`).join('  ')
}

// 배경은 글자 1개 또는 줄의 목록이다. 줄 앞의 글머리표는 패널이 그리므로 뗀다
export function backgroundLines(raw: unknown): string[] {
  const lines = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split('\n') : []

  return lines.map(line => line.replace(/^\s*[-*•]\s*/, '').trim()).filter(line => line !== '')
}

export function brokenUnit(path: string, why: string): Decision {
  return {
    id: slashed(path).split('/').pop()?.replace(/\.json$/, '') ?? path,
    path,
    project: '?',
    kind: 'request',
    state: 'waiting',
    raisedAt: 0,
    session: '',
    link: '',
    root: '',
    isBroken: true,
    question: '읽지 못했다',
    options: [],
    background: [],
    error: why,
  }
}

export function parseDecision(path: string, text: string): Decision {
  try {
    const raw = JSON.parse(text)
    const kind: Kind = KIND_ORDER.includes(raw?.kind) ? raw.kind : 'request'
    // 확인 칸은 질문 대신 줄 목록이다
    const lines = kind === 'report' ? strings(raw.lines) : [raw?.question]
    if (typeof lines[0] !== 'string') return brokenUnit(path, kind === 'report' ? 'lines가 없다' : 'question이 없다')

    return {
      ...brokenUnit(path, ''),
      project: String(raw.project ?? '?'),
      kind,
      state: STATES.includes(raw.state) ? raw.state : 'waiting',
      raisedAt: typeof raw.raisedAt === 'number' ? raw.raisedAt : 0,
      session: String(raw.session ?? ''),
      link: SESSION_LINK_FORMAT.test(String(raw.link)) ? String(raw.link) : '',
      root: String(raw.root ?? ''),
      isBroken: false,
      question: lines[0],
      options: strings(raw.options),
      background: kind === 'report' ? lines.slice(1) : backgroundLines(raw.background),
    }
  } catch (error) {
    return brokenUnit(path, String(error))
  }
}

// 파일의 다른 값은 그대로 둔다. 값이 undefined인 키는 지운다
export function patchDecisionText(text: string, patch: Record<string, unknown>): string {
  return `${JSON.stringify({ ...JSON.parse(text), ...patch }, null, 2)}\n`
}

// 급한 종류를 위에 쌓는다
export function byUrgency(a: Decision, b: Decision): number {
  return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id)
}

export function visibleOf(list: Decision[]): Decision[] {
  return list.filter(unit => unit.state !== 'closed')
}

// 상태 줄은 사용자를 기다리는 칸만 센다. 진행 중인 칸은 세지 않는다 (Q3)
export function countOf(list: Decision[], kind: Kind): number {
  return list.filter(unit => unit.kind === kind && !unit.isBroken && unit.state !== 'busy').length
}

// 상태 줄의 글이다. 0인 종류는 쓰지 않는다. 칸이 없으면 undefined이다 (상태 줄을 지운다)
export function statusText(shown: Decision[]): string | undefined {
  const parts = KIND_ORDER.filter(kind => countOf(shown, kind) > 0).map(
    kind => `${KIND_LOOK[kind].label} ${countOf(shown, kind)}`,
  )

  return parts.length > 0 ? parts.join(' · ') : undefined
}

// 칸의 나이. 시간대에 기대지 않게 지금과의 차이로 쓴다. 앱을 다시 켠 뒤 낡은 칸을 알아보게 한다
export function ageText(now: number, raisedAt: number): string {
  const minutes = Math.floor((now - raisedAt) / 60000)
  if (raisedAt <= 0) return ''
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`

  return `${Math.floor(minutes / 1440)}일 전`
}

// 고른 칸이 없으면 이 세션의 칸을 먼저 연다. 다른 세션에서 이동해 온 사용자가 그 칸을 바로 본다
export function openUnitId(stored: string, shown: Decision[], sessionId: string): string | undefined {
  return (
    shown.find(unit => unit.id === stored) ??
    shown.find(unit => unit.session === sessionId) ??
    shown[0]
  )?.id
}

// 사용자가 봐야 하는 새 칸: 이 프로젝트의 기다리는 결재·알림이고, 이 세션의 칸이 아니다
export function needsAttention(unit: Decision, project: string, sessionId: string): boolean {
  return (
    unit.kind !== 'report' &&
    !unit.isBroken &&
    unit.state === 'waiting' &&
    unit.root !== '' &&
    unit.root === project &&
    unit.session !== sessionId
  )
}

// 이전 칸과 신호로 새 기다림 칸을 만든다. 신호가 없으면 undefined이다
// waiting이 이어지면 raisedAt을 그대로 둔다. 새 기다림이면 지금 시각이다 (같은 세션의 두 번째 기다림도 다시 알린다)
export function nextWait(
  prev: UnitFile | undefined,
  signals: Signals,
  now: number,
  stamp: UnitFile,
): UnitFile | undefined {
  if (signals.kind === undefined) return undefined
  const isSame = prev?.state === 'waiting' && typeof prev.raisedAt === 'number'

  return {
    state: 'waiting',
    raisedAt: isSame ? prev.raisedAt : now,
    kind: signals.kind,
    question: clip(signals.lines[0] ?? ''),
    background: signals.lines.slice(1),
    options: signals.options,
    ...stamp,
  }
}

// 확인 줄을 확인 칸에 더한다. 같은 글은 더하지 않는다. 닫힌 칸이면 빈 목록에서 새로 시작한다
export function nextReport(
  prev: UnitFile | undefined,
  reports: string[],
  now: number,
  stamp: UnitFile,
): UnitFile | undefined {
  const isOpen = prev !== undefined && prev.state !== 'closed'
  const old = isOpen ? strings(prev.lines) : []
  const added = reports.filter(line => !old.includes(line))
  if (added.length === 0) return undefined

  return {
    state: 'waiting',
    raisedAt: isOpen && typeof prev.raisedAt === 'number' ? prev.raisedAt : now,
    kind: 'report',
    lines: [...old, ...added],
    ...stamp,
  }
}

// 띠의 줄 순서: 결재함 줄을 맨 위(ponytail 줄 위)에 둔다. 다른 줄의 순서는 그대로다 (2026-11-15 사용자 요청)
export function rackFirst<T extends { plugin: string }>(rows: readonly T[]): T[] {
  const isMine = (row: T) => row.plugin === 'decision-rack'

  return [...rows.filter(isMine), ...rows.filter(row => !isMine(row))]
}

// 대기열 폴더에서 읽은 파일 1개: 수정 시각, 크기, 해석한 칸
export type CachedFile = { mtimeMs: number; size: number; unit: Decision }

// 지워도 되는 파일: 닫혔고(closed), 읽을 수 있고, 마지막으로 바뀐 지 keepMs가 지났다
export function staleClosedNames(
  files: ReadonlyMap<string, CachedFile>,
  now: number,
  keepMs: number,
): string[] {
  return [...files.entries()]
    .filter(([, file]) => file.unit.state === 'closed' && !file.unit.isBroken && now - file.mtimeMs > keepMs)
    .map(([name]) => name)
}

