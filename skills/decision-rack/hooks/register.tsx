import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  RenderChildren,
  SessionMessage,
  ToolUseSummary,
} from 'claude-code'

import type { Decision, Kind, State } from '../types'

// 결재함은 "어느 세션이 사용자를 기다리는가"를 보이는 곳이다. 결정은 그 세션의 대화에서 한다 (2026-11-15 사용자 결정)
// 판 2: 칸은 mod가 대화에서 뽑는다. AI는 칸의 파일을 쓰지 않는다. 파일은 지우지 않고 상태를 덮어쓴다 (PLAN 5·6절)

// 패널의 제목은 이 번호로 처음 열 때 정해진다. 제목을 바꾸면 이 번호도 바꾼다
const PANE = 'approval-box'
const TITLE = '결재함'
// 처음 열 때의 폭 (글자 칸 수). 요청일 뿐이다: 사용자가 끌어서 바꾼 폭이 있으면 앱은 그 폭을 쓴다
// 49는 사용자가 패널을 끌어 놓은 폭을 잰 값이다 (2026-11-15. 대화 영역이 107칸일 때)
const PANE_COLUMNS = 49
// 폴더가 그대로이면 목록 1번만 읽는다
const POLL_MS = 2000
const OPEN_AUTO = ''
// 판 1의 파일은 바로 위 폴더에 있다. 옛 mod가 새 파일을 잘못 읽지 않게 폴더를 나눈다 (D3)
const QUEUE_SUFFIX = '/.claude/decisions/v2'
// 패널은 이 이름 모양의 파일만 읽는다. 세션마다 기다림 칸 1개와 확인 칸 1개다 (Q5)
const UNIT_FILE = /^[0-9a-f]{8}-(wait|report)\.json$/
// 더블 클릭의 두 번째 클릭을 이동으로 다루지 않는다
const DOUBLE_CLICK_MS = 500
// 데스크톱 앱이 세션을 여는 주소. 이 값을 OS에 넘기므로 파일의 값이 정확히 이 형식일 때만 쓴다
const SESSION_LINK = 'claude://claude.ai/epitaxy/'
const SESSION_LINK_FORMAT = /^claude:\/\/claude\.ai\/epitaxy\/local_[0-9a-f-]+$/
// 급한 순서. 이 순서로 쌓고, 이 순서로 줄에 쓴다
const KIND_ORDER: Kind[] = ['request', 'notice', 'report']
const STATES: State[] = ['waiting', 'busy', 'closed']
// 펴진 칸은 짧게 쓴다: 요약은 이 줄 수까지만 보여준다. 전체 자료는 세션의 대화에 있다 (2026-11-15 사용자 결정)
const MAX_SUMMARY_LINES = 2
const MAX_QUESTION_CHARS = 60
const CIRCLED = '①②③④⑤⑥⑦⑧⑨'
// 답의 표시 줄 (PLAN 7.1 신호 3). 줄 맨 앞(글머리표 뒤)에 있어야 한다
const MARK = /^(결재|알림|확인)\s*[:：]\s*(.*)$/
const CARD_TOOL = 'AskUserQuestion'
// 앱의 질문 상자. 터미널 세션에는 없다
const ASK_BOX_TOOL = 'mcp__ccd_turn__wrap_up'
// 사용자가 직접 넣은 입력의 출처: 터미널의 Enter, 원격 조작, 앱(SDK)의 입력
// 백그라운드 작업의 알림, 다른 세션의 메시지, 예약 실행은 사용자의 답이 아니다
const USER_ORIGINS = new Set(['composer', 'bridge', 'sdk'])
// 사용자가 끝낸 세션만 칸을 닫는다. 앱 종료(other)와 이어받기(resume)는 칸을 남긴다 (D2)
const CLOSING_ENDS = new Set(['prompt_input_exit', 'clear', 'logout'])
// 결재는 빨강, 알림은 노랑, 확인은 초록이다 (2026-11-15 사용자 결정)
const KIND_LOOK = {
  request: { color: 'error', label: '결재' },
  notice: { color: 'warning', label: '알림' },
  report: { color: 'success', label: '확인' },
} as const

const units = atom({ plugin: 'decision-rack', key: 'units' } as const, [], {
  shape: 'units-4',
})
const openId = atom({ plugin: 'decision-rack', key: 'openId' } as const, OPEN_AUTO)
const isDismissed = atom({ plugin: 'decision-rack', key: 'isDismissed' } as const, false)

// 대화에서 뽑은 신호. kind가 undefined이면 기다림이 없다
export type Signals = {
  kind: 'request' | 'notice' | undefined
  lines: string[]
  options: string[]
  reports: string[]
}

type Asked = { question: string; options: string[] }
type Marked = { mark: string; rest: string }
type UnitFile = Record<string, unknown>

// ── 계산: 입출력 없음 ──

function slashed(path: string): string {
  return path.replace(/\\/g, '/')
}

function unique(lines: string[]): string[] {
  return [...new Set(lines)]
}

function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
}

function clip(text: string): string {
  return text.length > MAX_QUESTION_CHARS ? `${text.slice(0, MAX_QUESTION_CHARS)}…` : text
}

// 선택지를 1줄로 쓴다: '① JSON 파일 (추천)  ② SQLite'
function optionsLine(unit: Decision): string {
  return unit.options.map((label, i) => `${CIRCLED[i] ?? `${i + 1}.`} ${label}`).join('  ')
}

// 배경은 글자 1개 또는 줄의 목록이다. 줄 앞의 글머리표는 패널이 그리므로 뗀다
function backgroundLines(raw: unknown): string[] {
  const lines = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split('\n') : []

  return lines.map(line => line.replace(/^\s*[-*•]\s*/, '').trim()).filter(line => line !== '')
}

// 답의 줄에서 코드 울타리 안의 줄을 빼고 글머리표·강조를 뗀다
function plainLines(answer: string): string[] {
  let isFenced = false
  const lines: string[] = []
  for (const raw of answer.split('\n')) {
    if (raw.trim().startsWith('```')) {
      isFenced = !isFenced
      continue
    }
    if (isFenced) continue
    const line = raw
      .replace(/[*`]/g, '')
      .replace(/^[\s>\-•]*(\d+[.)]\s+)?/, '')
      .trim()
    if (line !== '') lines.push(line)
  }

  return lines
}

function markOf(line: string): Marked | undefined {
  const found = MARK.exec(line)

  return found ? { mark: found[1] ?? '', rest: (found[2] ?? '').trim() } : undefined
}

// 선택 카드의 첫 질문과 그 선택지
function cardAsk(input: Record<string, unknown>): Asked | undefined {
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
function askBoxAsk(input: Record<string, unknown>): Asked | undefined {
  if (typeof input.ask !== 'string' || input.ask.trim() === '') return undefined
  const actions = Array.isArray(input.actions) ? input.actions : []

  return {
    question: input.ask,
    options: strings(actions.map(action => (action as { label?: unknown })?.label)),
  }
}

// 턴 안의 질문: 답하지 않은 선택 카드 (신호 1), 질문 상자 (신호 2)
// 답한 선택 카드는 이미 끝난 기다림이다. 결과(text)가 없는 카드만 센다
function asksOf(uses: readonly ToolUseSummary[]): Asked[] {
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

      return { mark: own?.mark === '결재' ? '결재' : '알림', rest: own?.rest ?? ask.question.trim() }
    }),
    ...marked.filter(m => m.mark !== '확인'),
  ].filter(wait => wait.rest !== '')
  const last = lines[lines.length - 1]
  // 물음표 줄은 다른 신호가 없을 때만 쓴다 (Q6)
  if (waits.length === 0 && last !== undefined && /[?？]$/.test(last)) {
    waits.push({ mark: '알림', rest: last })
  }

  return {
    kind: waits.length === 0 ? undefined : waits.some(w => w.mark === '결재') ? 'request' : 'notice',
    lines: unique(waits.map(w => w.rest)),
    options: asks.flatMap(ask => ask.options).filter(option => option !== ''),
    reports: unique(marked.filter(m => m.mark === '확인' && m.rest !== '').map(m => m.rest)),
  }
}

// 대화의 마지막 턴: 마지막 사용자 입력 뒤의 assistant 메시지. 도구 결과만 든 사용자 메시지는 턴의 일부다
export function lastTurn(messages: readonly SessionMessage[]): {
  text: string
  allText: string
  uses: ToolUseSummary[]
} {
  const start = messages.findLastIndex(
    message => message.role === 'user' && (message.toolResults ?? []).length === 0,
  )
  const turn = messages.slice(start + 1).filter(message => message.role === 'assistant')

  return {
    text: turn.findLast(message => message.text !== '')?.text ?? '',
    allText: turn.map(message => message.text).join('\n'),
    uses: turn.flatMap(message => message.toolUses),
  }
}

function brokenUnit(path: string, why: string): Decision {
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

function parseDecision(path: string, text: string): Decision {
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
function patchDecisionText(text: string, patch: Record<string, unknown>): string {
  return `${JSON.stringify({ ...JSON.parse(text), ...patch }, null, 2)}\n`
}

// 급한 종류를 위에 쌓는다
function byUrgency(a: Decision, b: Decision): number {
  return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id)
}

function visibleOf(list: Decision[]): Decision[] {
  return list.filter(unit => unit.state !== 'closed')
}

// 상태 줄은 사용자를 기다리는 칸만 센다. 진행 중인 칸은 세지 않는다 (Q3)
function countOf(list: Decision[], kind: Kind): number {
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
function openUnitId(stored: string, shown: Decision[], sessionId: string): string | undefined {
  return (
    shown.find(unit => unit.id === stored) ??
    shown.find(unit => unit.session === sessionId) ??
    shown[0]
  )?.id
}

// 사용자가 봐야 하는 새 칸: 이 프로젝트의 기다리는 결재·알림이고, 이 세션의 칸이 아니다
function needsAttention(unit: Decision, project: string, sessionId: string): boolean {
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
function nextWait(
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
function nextReport(
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

// ── 입출력: 대기열 폴더 ──

// 폴더가 바뀌지 않으면 파일을 다시 읽지 않는다. 리로드 뒤에는 한 번 다시 읽는다
let lastSignature = '\0'
// 앞의 읽기가 끝나지 않으면 타이머의 읽기가 겹친다. 겹친 읽기는 건너뛴다
let isRefreshing = false
let cachedQueueDir: string | undefined
let cachedProject: string | undefined
// Client(slot.tsx)를 그리지 못하는 화면에서는 제목 버튼으로 대신한다
let hasClientFault = false
// 터미널의 REPL인가. 앱 세션 안에서 띄운 claude는 앱의 세션 주소(환경 변수)를 물려받는다. 그 주소를 쓰면 엉뚱한 세션으로 간다
// shortcut: -p 실행(surface null)은 가리지 못한다. 앱 세션의 surface 값을 확인하면 그때 조건을 좁힌다
let isTerminal = false
// 지금 턴이 사용자 입력으로 시작했는가. 신호 없이 끝난 사용자 턴만 칸을 닫는다 (D4)
let isUserTurn = false
// 이미 알린 기다림 (id:raisedAt). 같은 기다림으로 패널을 2번 열지 않는다
const announcedKeys = new Set<string>()
// 방금 편 칸과 그 시각. 접힌 칸을 더블 클릭해도 이동하지 않게 한다
let lastOpened = { id: '', at: 0 }

async function queueDir($: EngineInterface): Promise<string> {
  if (cachedQueueDir !== undefined) return cachedQueueDir
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  cachedQueueDir = `${slashed(home)}${QUEUE_SUFFIX}`

  return cachedQueueDir
}

async function unitPath(
  $: EngineInterface,
  sessionId: string,
  part: 'wait' | 'report',
): Promise<string> {
  return `${await queueDir($)}/${sessionId.slice(0, 8)}-${part}.json`
}

// 워크트리의 세션도 같은 프로젝트로 묶는다. 그래서 git의 공용 폴더를 쓴다. git이 없으면 세션의 폴더다
async function projectKey($: EngineInterface): Promise<string> {
  if (cachedProject !== undefined) return cachedProject
  const root = await $.session.root().catch(() => '')
  const git = await $.process
    .run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root })
    .catch(() => undefined)
  const dir = git?.exitCode === 0 && git.stdout.trim() !== '' ? git.stdout.trim() : root
  cachedProject = slashed(dir).toLowerCase()

  return cachedProject
}

// 패널의 Link는 claude:// 주소를 열지 않는다. 그래서 OS의 주소 처리기로 연다
// shortcut: Windows 전용이다. 다른 OS를 쓰게 되면 open/xdg-open을 더한다
async function openSessionLink($: EngineInterface, link: string): Promise<void> {
  await $.process.run(['rundll32', 'url.dll,FileProtocolHandler', link])
}

async function patchFile(
  $: EngineInterface,
  path: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await $.fs.write(path, patchDecisionText(await $.fs.read(path), patch))
}

// 없거나 깨진 파일은 undefined이다
async function readUnit($: EngineInterface, path: string): Promise<UnitFile | undefined> {
  try {
    const raw = JSON.parse(await $.fs.read(path))

    return typeof raw === 'object' && raw !== null ? raw : undefined
  } catch {
    return undefined
  }
}

// 내용이 같으면 쓰지 않는다. 쓰면 모든 세션의 패널이 폴더를 다시 읽는다
async function writeUnit(
  $: EngineInterface,
  path: string,
  next: UnitFile,
  prev: UnitFile | undefined,
): Promise<void> {
  if (JSON.stringify(next) === JSON.stringify(prev)) return
  await $.fs.write(path, `${JSON.stringify(next, null, 2)}\n`)
}

// 이 세션의 칸이 from 상태 중 하나이면 to로 바꾼다
async function setState(
  $: EngineInterface,
  sessionId: string,
  part: 'wait' | 'report',
  from: State[],
  to: State,
): Promise<void> {
  const path = await unitPath($, sessionId, part)
  const prev = await readUnit($, path)
  if (prev === undefined || !from.includes(prev.state as State)) return
  await writeUnit($, path, { ...prev, state: to }, prev)
}

// 칸에 쓰는 주인 세션의 표시: 프로젝트, 세션 번호, 앱에서 여는 주소
async function ownerStamp($: EngineInterface): Promise<UnitFile> {
  const hostId = isTerminal ? undefined : await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
  const root = slashed(await $.session.root().catch(() => ''))

  return {
    project: root.split('/').filter(Boolean).pop() ?? '?',
    root: await projectKey($),
    session: await $.session.id(),
    link: hostId ? `${SESSION_LINK}${hostId}` : undefined,
  }
}

// 같은 앱 세션이 이어받기 등으로 새 세션 번호를 받으면 옛 번호의 기다림 칸은 주인이 없다. 그 칸을 닫는다
// shortcut: 앱 세션 안에서 띄운 claude -p도 같은 주소를 물려받아 부모의 칸을 닫을 수 있다. 부모는 턴 끝에 다시 판정한다
async function closeOrphans($: EngineInterface, link: unknown, sessionId: string): Promise<void> {
  if (typeof link !== 'string') return
  const orphans = (await read($, units)).filter(
    unit =>
      unit.id.endsWith('-wait') &&
      unit.link === link &&
      unit.session !== sessionId &&
      unit.state !== 'closed' &&
      !unit.isBroken,
  )
  await Promise.all(orphans.map(unit => patchFile($, unit.path, { state: 'closed' })))
}

// 신호로 이 세션의 칸 2개를 고친다. 신호가 없으면 isQuietCloses일 때만 기다림 칸을 닫는다 (D4)
async function sync($: EngineInterface, signals: Signals, isQuietCloses: boolean): Promise<void> {
  const sessionId = await $.session.id()
  const now = await $.clock.now()
  const stamp = await ownerStamp($)
  const waitPath = await unitPath($, sessionId, 'wait')
  const reportPath = await unitPath($, sessionId, 'report')
  const prevWait = await readUnit($, waitPath)
  const prevReport = await readUnit($, reportPath)

  const wait = nextWait(prevWait, signals, now, stamp)
  if (wait !== undefined) await writeUnit($, waitPath, wait, prevWait)
  else if (isQuietCloses && prevWait !== undefined && prevWait.state !== 'closed') {
    await writeUnit($, waitPath, { ...prevWait, state: 'closed' }, prevWait)
  }
  const report = nextReport(prevReport, signals.reports, now, stamp)
  if (report !== undefined) await writeUnit($, reportPath, report, prevReport)
  await closeOrphans($, stamp.link, sessionId)
  await refresh($, true)
}

// 새 기다림이 오면 패널을 열고 알린다. 사용자는 명령을 치지 않는다
async function announce($: EngineInterface, list: Decision[]): Promise<void> {
  const project = await projectKey($)
  const sessionId = await $.session.id()
  const fresh = list.filter(
    unit =>
      needsAttention(unit, project, sessionId) && !announcedKeys.has(`${unit.id}:${unit.raisedAt}`),
  )
  if (fresh.length === 0) return

  for (const unit of fresh) announcedKeys.add(`${unit.id}:${unit.raisedAt}`)
  await openPane($)
  void $.ui.toast(`결재함에 ${fresh.length}개가 왔다`)
}

async function openPane($: EngineInterface): Promise<void> {
  await update($, isDismissed, () => false)
  void $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
}

async function refresh($: EngineInterface, isForced = false): Promise<void> {
  const dir = await queueDir($)
  try {
    const entries = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
    const files = entries.filter(f => f.kind === 'file' && UNIT_FILE.test(f.name))
    const signature = files.map(f => `${f.name}:${f.mtimeMs}`).join('|')
    if (!isForced && signature === lastSignature) return

    const list = await Promise.all(
      files.map(async f => {
        const path = `${dir}/${f.name}`

        return parseDecision(path, await $.fs.read(path).catch(() => ''))
      }),
    )
    list.sort(byUrgency)
    await update($, units, () => list)
    lastSignature = signature
    await announce($, list)
  } catch (error) {
    // 오류를 숨기면 패널이 "결재할 것이 없다"로 보인다. 기다리는 세션을 사용자가 알 수 없다
    lastSignature = '\0'
    await update($, units, () => [brokenUnit(dir, String(error))])
  }
}

// ── 훅 ──

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isTerminal = e.surface === 'terminal'
    // 이전 판은 개수를 상태 줄에 썼다. 상태 줄은 누를 수 없어서 띠로 옮겼다. 남은 글을 지운다
    $.ui.status(undefined)
    await $.command.register({
      name: 'decisions',
      description: '결재함 패널을 연다',
    })
    // 결재함은 모든 세션에 늘 보인다. 칸이 없어도 연다
    // 이 훅은 mod를 다시 읽을 때도 실행된다. 사용자가 닫아 둔 패널은 다시 열지 않는다
    if (!(await read($, isDismissed))) {
      void $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
    }
    await projectKey($)
    await refresh($)
    // 다시 연 세션과 다시 읽은 mod는 마지막 답으로 다시 판정한다. 신호가 없어도 닫지 않는다
    const turn = lastTurn(await $.session.messages().catch(() => []))
    await sync($, signalsOf(turn.text, turn.uses, turn.allText), false).catch(() => undefined)
    $.clock.every(POLL_MS, () => {
      if (isRefreshing) return
      isRefreshing = true
      void refresh($).finally(() => {
        isRefreshing = false
      })
    })

    return next(e)
  })

  // 사용자가 세션을 끝냈다. 기다림 칸만 닫는다. 확인 칸은 사용자가 확인을 눌러야 닫힌다 (D2)
  on('session.end', async ($, e, next) => {
    if (CLOSING_ENDS.has(e.reason)) {
      await setState($, e.sessionId, 'wait', ['waiting', 'busy'], 'closed').catch(() => undefined)
    }

    return next(e)
  })

  on('command.run', { command: 'decisions' }, async $ => {
    await refresh($, true)
    await openPane($)

    return { text: '결재함을 열었다.' }
  })

  // 사용자가 이 세션에 직접 입력했다. 기다림 칸을 흐리게 한다 (Q3). 답인지는 턴 끝에 정한다
  on('prompt.submit', async ($, e, next) => {
    // 출처가 없는 입력은 사용자의 입력으로 본다
    const origin = (e.origin as { kind?: string } | undefined)?.kind
    isUserTurn = origin === undefined || USER_ORIGINS.has(origin)
    if (isUserTurn) {
      await setState($, await $.session.id(), 'wait', ['waiting'], 'busy')
        .then(() => refresh($, true))
        .catch(() => undefined)
    }

    return next(e)
  })

  // 턴이 끝났다. 하위 에이전트의 턴은 판정하지 않는다. 실패해도 턴의 결과는 바꾸지 않는다
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const wasUserTurn = isUserTurn
    isUserTurn = false
    const judged =
      e.reason === 'answer'
        ? $.session
            .messages()
            .then(messages => {
              const turn = lastTurn(messages)

              return sync($, signalsOf(e.answer, turn.uses, turn.allText), wasUserTurn)
            })
        : // 중단·오류·거절: 다시 판정하지 않는다. 사용자가 아직 답하지 않은 것이다
          $.session
            .id()
            .then(id => setState($, id, 'wait', ['busy'], 'waiting'))
            .then(() => refresh($, true))
    await judged.catch(() => undefined)

    return result
  })

  // 선택 카드가 떠 있는 동안 기다린다. 답하면 진행 중이다. 파일 쓰기 실패는 도구 호출을 막지 않는다
  on('tool.call', { tool: CARD_TOOL }, async ($, e, next) => {
    const ask = cardAsk(e as unknown as Record<string, unknown>)
    if (ask !== undefined) {
      await sync($, signalsOf('', [{ tool_use_id: '', tool: CARD_TOOL, input: e as never }]), false).catch(
        () => undefined,
      )
    }
    const result = await next(e)
    if (ask !== undefined) {
      await setState($, await $.session.id(), 'wait', ['waiting'], 'busy')
        .then(() => refresh($, true))
        .catch(() => undefined)
    }

    return result
  })

  // 사용자가 패널을 직접 닫았다. 다시 부를 때까지 스스로 열지 않는다
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      await update($, isDismissed, () => true)
    }

    return next(e)
  })

  // 칸의 윗부분(slot.tsx)을 눌렀다: 접힌 칸은 편다. 펴진 칸은 그 칸의 세션으로 이동한다
  on('ui.message', async ($, e, next) => {
    const id = (e.data as { id?: unknown } | null)?.id
    const shown = visibleOf(await read($, units))
    const unit = shown.find(one => one.id === id)
    if (unit) {
      const open = openUnitId(await read($, openId), shown, await $.session.id())
      const now = await $.clock.now()
      const isDoubleClick = lastOpened.id === unit.id && now - lastOpened.at < DOUBLE_CLICK_MS
      if (open !== unit.id) {
        await update($, openId, () => unit.id)
        lastOpened = { id: unit.id, at: now }
      } else if (unit.link !== '' && !isDoubleClick) {
        await openSessionLink($, unit.link)
      }
    }

    return next(e)
  })

  // 패널이 닫혀 있으면 프롬프트 위 띠에 개수와 여는 단추를 보인다. 상태 줄은 누를 수 없다 (2026-11-15 사용자 결정)
  // 패널은 30칸(창의 약 22%)보다 좁아지지 않고 앱은 위젯 요청을 무시한다. 그래서 접힌 모양 대신 닫고 띠를 쓴다
  // 모양은 ponytail 띠에 맞춘다: 줄 전체 폭, 간격 2, 오른쪽 끝의 글자 단추 (상위 세션 3차 디자인)
  // 앱이 단추 안 글자색을 지운다. 그래서 색 점은 단추 밖의 글자로 둔다. 0인 종류는 쓰지 않는다
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = visibleOf(await read($, units))
    if (e.props.hasSurvey || statusText(shown) === undefined || !(await read($, isDismissed))) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" alignItems="center" gap={2} width={e.props.bodyColumns}>
        {KIND_ORDER.filter(kind => countOf(shown, kind) > 0).map(kind => (
          <Box key={`count:${kind}`} flexDirection="row" gap={1}>
            <Text color={KIND_LOOK[kind].color}>●</Text>
            <Text>{`${KIND_LOOK[kind].label} ${countOf(shown, kind)}`}</Text>
          </Box>
        ))}
        <Box flexGrow={1} />
        <Button key="open-rack" plain label="결재함" onPress={() => openPane($)} />
      </Box>
    )
  })

  // 결재함 줄을 띠의 맨 위(ponytail 줄 위)에 둔다. 다른 줄은 순서를 바꾸지 않는다 (2026-11-15 사용자 요청)
  on('ui.render', { component: 'AbovePromptList' }, ($, e, next) => {
    const isMine = (row: { plugin: string }) => row.plugin === 'decision-rack'
    const rows = [...e.props.rows.filter(isMine), ...e.props.rows.filter(row => !isMine(row))]

    return next({ ...e, props: { ...e.props, rows } })
  })

  on('ui.fault', ($, e, next) => {
    hasClientFault = true

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Client = !hasClientFault && 'Client' in table ? table.Client : undefined
    const shown = visibleOf(await read($, units))
    const sessionId = await $.session.id()
    const project = await projectKey($)
    const now = await $.clock.now()
    const open = openUnitId(await read($, openId), shown, sessionId)
    const own = shown.filter(unit => unit.root !== '' && unit.root === project)
    const others = shown.filter(unit => !own.includes(unit))

    // 확인(초록) 칸을 읽었다. 세션에는 아무것도 보내지 않는다. 칸만 닫는다
    const acknowledge = (picked: Decision[]) => async () => {
      await Promise.all(picked.map(unit => patchFile($, unit.path, { state: 'closed' })))
      await update($, openId, () => OPEN_AUTO)
      await refresh($, true)
    }

    // 펴진 칸의 내용: 요약 1~2줄과 선택지 1줄. 답하는 버튼은 없다. 답은 그 칸의 세션에서 한다
    const detail = (unit: Decision) => (
      <Box flexDirection="column" gap="xs" paddingTop="xs">
        {unit.background.slice(0, MAX_SUMMARY_LINES).map(line => (
          <Text>{line}</Text>
        ))}
        {unit.options.length > 0 && (
          <Text dimColor size="caption">
            {optionsLine(unit)}
          </Text>
        )}
        {unit.isBroken && (
          <Text dimColor size="caption">
            {unit.error}
          </Text>
        )}
        {unit.link === '' && !unit.isBroken && (
          <Text color="warning" size="caption">
            앱에서 연 세션이 아니다. 이동이 안 된다.
          </Text>
        )}
      </Box>
    )

    const slot = (body: RenderChildren) => (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="subtle"
        borderDimColor
        paddingX="md"
        paddingY="sm"
      >
        {body}
      </Box>
    )

    const row = (unit: Decision) => {
      const isOpen = open === unit.id
      const isBusy = unit.state === 'busy'
      const look = KIND_LOOK[unit.kind]
      const age = ageText(now, unit.raisedAt)
      const head = Client ? (
        <Client
          key={`slot:${unit.id}`}
          module="./slot.tsx"
          flexGrow={1}
          props={{
            id: unit.id,
            kind: unit.kind,
            isBroken: unit.isBroken,
            isBusy,
            project: unit.project,
            age,
            question: unit.question,
            isOpen,
          }}
        />
      ) : (
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" gap="sm" alignItems="center">
            <Text color={look.color} size="caption" weight="semibold" dimColor={isBusy}>
              ● {unit.isBroken ? '오류' : isBusy ? '진행 중' : look.label}
            </Text>
            <Text size="caption">
              {unit.project} {age}
            </Text>
          </Box>
          {isOpen ? (
            <Text weight="semibold" size="heading" dimColor={isBusy}>
              {unit.question}
            </Text>
          ) : (
            <Button key={unit.id} plain onPress={() => update($, openId, () => unit.id)}>
              {unit.question}
            </Button>
          )}
        </Box>
      )

      return slot(
        <Box flexDirection="column" gap="xs">
          {/* 좁은 패널에서 긴 질문이 "확인" 단추를 밖으로 밀었다. 글 쪽만 줄어들게 한다 (2026-11-15 사용자 보고) */}
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              {head}
            </Box>
            {unit.kind === 'report' && !unit.isBroken && (
              <Box flexShrink={0}>
                <Button key={`${unit.id}:ok`} onPress={acknowledge([unit])}>
                  확인
                </Button>
              </Box>
            )}
          </Box>
          {isOpen && detail(unit)}
        </Box>,
      )
    }

    // 묶음 1개: 제목 줄과 칸들. 확인 칸이 2개 이상이면 "모두 확인"을 둔다
    const section = (title: string, rows: Decision[]) => {
      const reports = rows.filter(unit => unit.kind === 'report' && !unit.isBroken)

      return (
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text dimColor size="caption" weight="semibold">
              {title} {rows.length}
            </Text>
            {reports.length > 1 && (
              <Button key={`confirm-all:${title}`} onPress={acknowledge(reports)}>
                {`확인 ${reports.length}개 모두 확인`}
              </Button>
            )}
          </Box>
          {rows.map(row)}
        </Box>
      )
    }

    if (shown.length === 0) {
      return (
        <Box padding="md">
          <Text dimColor>기다리는 세션이 없다. 세션이 사용자를 기다리면 여기에 쌓인다.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding="md" gap="md">
        {own.length > 0 && section('이 프로젝트', own)}
        {others.length > 0 && section(own.length > 0 ? '다른 프로젝트' : '세션', others)}
      </Box>
    )
  })
}
