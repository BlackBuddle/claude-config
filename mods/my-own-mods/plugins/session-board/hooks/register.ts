// session-board: 여러 세션의 상태를 오른쪽 패널에 모아 보여 준다. 진행 중 / 응답 대기 / 완료·유휴.
// 모드는 세션마다 따로 돌고 다른 세션 목록을 주는 API 가 없다. 그래서 세션마다 자기 상태를 파일 하나에 쓰고,
// 패널이 그 폴더를 읽어 모은다. 세션 하나가 파일 하나만 쓰므로 쓰기가 겹치지 않는다.
// 왼쪽 사이드바 항목에는 모드가 그릴 수 없다. 뱃지는 패널 안 카드에 단다.
// 세션을 열면 패널이 같이 열린다(넓은 창에서만 그려진다). "접기" 버튼은 패널을 좁은 너비로 다시 열고 개수 알약만 그린다.
// 호스트가 소스에서 on(...) 과 $.noun.method(...) 를 읽으므로 literal 로 쓰고, $ 를 받는 도우미는 최상위 함수로 둔다.

import type { Register } from 'claude-code'

import { BW, C, KIND_LABEL, SH, SKIN, SW, avatarSvg, barSvg, clip, fmtDur, hairline, headSvg, infoSvg, mePill, mePlace } from './art'
import type { Mood } from './art'
import { APP_ID_FORMAT, closable, deadLabel, purgeable, groupOf, isDead, isNestedSession, judge, openAsk, openReport, optionsLine, orphanIds, parseAsk, parseReport } from './asks'
import type { Ask, Group, Report } from './asks'
import { cardAsk, lastTurn, signalsOf } from './signals'
import type { Signals } from './signals'

export { avatarSvg, barSvg, fmtDur, groupOf, infoSvg } // 시험이 이 모듈에서 읽는다

const PANE_ID = 'session-board'
const TICK_MS = 5_000 // 5초마다 폴더를 다시 읽는다 (패널이 닫혀 있어도 새 결재를 알리려고)
const BEAT_EVERY = 6 // 6틱(30초)마다 살아 있다고 다시 기록한다
const PURGE_MS = 24 * 60 * 60 * 1000 // 하루 넘은 파일은 시작할 때 지운다
const PURGE_OPEN_MS = 7 * 24 * 60 * 60 * 1000 // 열린 결재·확인이 있는 파일은 7일까지 남긴다 (결재함과 같은 기간)
const FRESH_MS = 10_000 // 이보다 최근에 바뀐 파일은 읽기에 실패해도 오류로 치지 않는다 (쓰는 중일 수 있다)
const MAX_BACKGROUND_LINES = 2 // 펴진 칸의 배경은 이 줄 수까지만 보인다. 전체 자료는 그 세션의 대화에 있다
// 사용자가 직접 넣은 입력의 출처: 터미널·앱의 Enter(composer), 원격 조작(bridge), claude -p(sdk). 작업 알림·다른 세션의 메시지·예약 실행은 답이 아니다
const USER_ORIGINS = new Set(['composer', 'bridge', 'sdk'])
// 사용자가 끝낸 세션만 결재·알림을 닫는다. 앱 종료(other)와 이어받기(resume)는 칸을 남기고 "세션 끝남"으로 보인다
const CLOSING_ENDS = new Set(['prompt_input_exit', 'clear', 'logout'])

export type State = 'running' | 'waiting' | 'idle' | 'ended'
export type Rec = {
  id: string
  name: string
  state: State
  since: number // 지금 상태가 시작된 시각
  turnStartedAt: number | null
  waitFor: string | null
  done: number // 작업 목록 완료 단계
  total: number // 작업 목록 전체 단계
  step: string // 지금 하는 단계(작업 목록의 진행 중 항목)
  updatedAt: number
  appId: string | null // 앱 세션 번호(CLAUDE_CODE_HOST_SESSION_ID). 앱 링크 claude://claude.ai/epitaxy/<번호> 로 그 세션에 이동한다
  root: string // 프로젝트 묶음 키(git 공용 폴더). 같은 프로젝트의 새 결재만 알리려고 쓴다
  ask: Ask | null // 사용자를 기다리는 결재·알림
  report: Report | null // 사용자가 읽고 닫을 확인
  askClosedAt: number // 사용자가 결재·알림을 닫은 시각. 다른 세션의 패널이 쓴다
  reportClosedAt: number
}


// ---- 순수 함수(시험 대상) -------------------------------------------------------


/** 파일 내용이 기록 모양인지 확인한다. 깨진 파일은 null. */
export function parseRec(text: unknown): Rec | null {
  if (typeof text !== 'string') return null
  try {
    const r = JSON.parse(text)
    const okState = r.state === 'running' || r.state === 'waiting' || r.state === 'idle' || r.state === 'ended'
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || !okState || !Number.isFinite(r.since) || !Number.isFinite(r.updatedAt)) return null
    return {
      id: r.id,
      name: r.name,
      state: r.state,
      since: r.since,
      turnStartedAt: Number.isFinite(r.turnStartedAt) ? r.turnStartedAt : null,
      waitFor: typeof r.waitFor === 'string' ? r.waitFor : null,
      done: Number.isFinite(r.done) ? r.done : 0,
      total: Number.isFinite(r.total) ? r.total : 0,
      step: typeof r.step === 'string' ? r.step : '',
      updatedAt: r.updatedAt,
      appId: typeof r.appId === 'string' && r.appId !== '' ? r.appId : null, // 이전 버전의 기록에는 없다
      root: typeof r.root === 'string' ? r.root : '',
      ask: parseAsk(r.ask),
      report: parseReport(r.report),
      askClosedAt: Number.isFinite(r.askClosedAt) ? r.askClosedAt : 0,
      reportClosedAt: Number.isFinite(r.reportClosedAt) ? r.reportClosedAt : 0,
    }
  } catch {
    return null
  }
}


export type Badge = { text: string; main: boolean }
/** 카드에 달 뱃지. 첫 번째가 알약(주), 나머지는 흐린 글자(보조). */
export function badges(r: Rec, now: number): Badge[] {
  const progress = r.total > 0 ? `${r.done}/${r.total} 단계` : ''
  const elapsed = r.turnStartedAt !== null ? `경과 ${fmtDur(now - r.turnStartedAt)}` : ''
  const ask = openAsk(r)
  const waitFor = `${r.waitFor ?? '응답'} 대기`
  let list: string[]
  if (isDead(r, now)) list = [deadLabel(r), ask ? `${KIND_LABEL[ask.kind]} ${fmtDur(now - ask.at)}` : '']
  else if (ask && r.state !== 'running') list = [r.state === 'waiting' ? waitFor : KIND_LABEL[ask.kind], `대기 ${fmtDur(now - ask.at)}`, progress]
  else if (r.state === 'waiting') list = [waitFor, `대기 ${fmtDur(now - r.since)}`, progress]
  else if (r.state === 'running') list = progress ? [progress, elapsed] : [elapsed]
  else list = [`${fmtDur(now - r.since)} 전`, progress]
  return list.filter(t => t !== '').map((text, i) => ({ text, main: i === 0 }))
}


export type PlanItem = { content: string; status: string }

/** 데스크톱 앱 작업 목록 도구(update_plan)의 호출 하나를 목록에 적용한다. items 는 통째로 바꾸고, advance/done/start 는 한 단계씩 고친다(번호는 1부터). */
export function applyPlan(plan: PlanItem[], a: any): PlanItem[] {
  const next: PlanItem[] = Array.isArray(a?.items)
    ? a.items.map((i: any) => ({ content: String(i?.content ?? ''), status: String(i?.status ?? 'pending') }))
    : plan.map(i => ({ ...i }))
  if (a?.advance === true) {
    const cur = next.findIndex(i => i.status === 'in_progress')
    if (cur >= 0) next[cur].status = 'completed'
    const nxt = next.findIndex(i => i.status === 'pending')
    if (nxt >= 0) next[nxt].status = 'in_progress'
  }
  for (const n of Array.isArray(a?.done) ? a.done : []) if (next[n - 1]) next[n - 1].status = 'completed'
  if (Number.isInteger(a?.start) && next[a.start - 1]) next[a.start - 1].status = 'in_progress'
  return next
}

/** 목록에서 기록에 쓸 진척(전체·완료·지금 단계)을 뽑는다. */
export const progress = (plan: PlanItem[]) => ({ total: plan.length, done: plan.filter(i => i.status === 'completed').length, step: plan.find(i => i.status === 'in_progress')?.content ?? '' })

const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
let plan: PlanItem[] = [] // 이 세션의 작업 목록. 한 단계씩 고치는 호출을 받으려고 기억해 둔다
const waitLabel = (tool: string) => (tool === 'AskUserQuestion' ? '답변' : tool === 'ExitPlanMode' ? '계획 승인' : `${tool} 승인`)

// ---- 세션 하나의 상태 ---------------------------------------------------------

let me: Rec | null = null
let dir = ''
let board: Rec[] = []
let isOpen = false // 패널을 열어 두려는 중(사용자가 닫으면 false)
let folded = false // 옆으로 접은 상태: 좁은 너비로 다시 열고 요약 알약만 그린다
let ticker: { cancel: () => void } | null = null
let tick = 0
let openId = '' // 펴진 세션 줄(이름을 눌러 편다). 하나만 펴진다
let broken: { name: string; why: string }[] = [] // 읽지 못한 기록 파일. 사용자가 닫기로 지운다
let isTerminal = false // 터미널 세션의 앱 번호(환경 변수)는 앱이 연 세션의 것이라 쓰면 엉뚱한 세션으로 간다
// 지금 턴에 사용자가 입력했는가. 신호 없이 끝난 사용자 턴만 결재·알림을 닫는다. 턴 끝에서만 false 로 되돌린다
let isUserTurn = false
let turnStartCount: number | undefined // 턴이 시작할 때의 메시지 수. 턴 끝에 이 뒤의 메시지만 판정한다
const announced = new Set<string>() // 이미 알린 결재 (세션:시각). 같은 결재로 패널을 두 번 열지 않는다
const parsedFiles = new Map<string, { mtimeMs: number; size: number; rec: Rec | null }>() // 수정 시각과 크기가 같으면 다시 읽지 않는다
const OPEN_COLUMNS = 40 // 펼쳤을 때 바라는 너비(줄 하나가 들어가는 만큼). 호스트에 상한을 거는 기능은 없어, 사람이 끌어 넓힌 폭이 우선한다
const FOLD_COLUMNS = 16 // 접었을 때 바라는 너비. 호스트가 지킬지는 앱에서 확인해야 한다

/** 패널을 연다. 접힌 상태면 좁은 너비를 바란다. 사용자가 시킨 열기가 아니면 넓은 창(144칸 이상)에서만 그려진다. */
async function openPane($: any) {
  const opened = await $.ui.open({ id: PANE_ID, title: '세션', columns: folded ? FOLD_COLUMNS : OPEN_COLUMNS })
  isOpen = true
  await refresh($)
  return opened
}

/** 접기/펼치기: 패널을 닫고 바뀐 너비로 다시 연다. 고른 상태는 다음 세션에도 이어진다. */
async function setFolded($: any, value: boolean) {
  folded = value
  try {
    await $.store.set('folded', value)
  } catch {
    // 저장하지 못해도 이번 세션에서는 바뀐다
  }
  await $.ui.close({ id: PANE_ID })
  await openPane($)
}

/** 내 기록을 고쳐 파일에 쓴다. 어떤 오류도 던지지 않는다: tool.call 을 쥔 훅이 이 함수 때문에 도구를 막으면 안 된다. */
async function save($: any, patch: Partial<Rec> = {}) {
  if (!me || dir === '') return
  try {
    // 다른 세션의 패널이 쓴 "닫은 시각"을 잃지 않게, 내 파일을 다시 쓰기 전에 읽어 합친다
    const disk = await $.fs.read(`${dir}/${me.id}.json`).then(parseRec, () => null)
    if (disk) {
      me.askClosedAt = Math.max(me.askClosedAt, disk.askClosedAt)
      me.reportClosedAt = Math.max(me.reportClosedAt, disk.reportClosedAt)
    }
    Object.assign(me, patch, { updatedAt: await $.clock.now() })
    await $.fs.write(`${dir}/${me.id}.json`, JSON.stringify(me))
    board = [me, ...board.filter(r => r.id !== me!.id)]
    if (isOpen) $.ui.invalidate('ui.render')
  } catch {
    // 쓰지 못하면 다음 박동(30초)에 다시 쓴다
  }
}

async function go($: any, state: State, waitFor: string | null = null) {
  if (!me || (me.state === state && me.waitFor === waitFor)) return
  try {
    await save($, { state, waitFor, since: await $.clock.now() })
  } catch {
    // 시계를 못 읽어도 도구 호출은 계속한다
  }
}

async function refresh($: any) {
  if (dir === '') return
  try {
    const now = await $.clock.now()
    const files = (await $.fs.list(dir)).filter((f: any) => f.kind === 'file' && f.name.endsWith('.json'))
    const read = await Promise.all(
      files.map(async (f: any) => {
        const cached = parsedFiles.get(f.name)
        if (cached && cached.mtimeMs === f.mtimeMs && cached.size === f.size) return { name: f.name, rec: cached.rec, isFresh: false }
        const parsed = await $.fs.read(`${dir}/${f.name}`).then(parseRec, () => null)
        // 닫기는 이 id 로 경로를 만든다. 파일 이름과 다른 id 는 엉뚱한 파일을 고치게 하므로 읽지 못한 기록으로 친다
        const rec = parsed !== null && `${parsed.id}.json` === f.name ? parsed : null
        // 쓰는 도중의 파일은 반쪽이라 읽기에 실패한다. 방금 바뀐 파일은 오류로 치지 않고 다음에 다시 읽는다
        const isFresh = now - f.mtimeMs < FRESH_MS
        if (rec !== null || !isFresh) parsedFiles.set(f.name, { mtimeMs: f.mtimeMs, size: f.size, rec })
        return { name: f.name, rec: rec as Rec | null, isFresh }
      }),
    )
    // 내 기록은 파일보다 메모리가 최신이다
    board = [...(me ? [me] : []), ...read.flatMap(x => (x.rec !== null && x.rec.id !== me?.id ? [x.rec] : []))]
    broken = read.filter(x => x.rec === null && !x.isFresh).map(x => ({ name: x.name, why: '기록 모양이 맞지 않다' }))
    await announce($)
  } catch {
    // 폴더가 아직 없으면 빈 목록
  }
}

/** 새 결재·알림이 오면 패널을 열고 알린다. 같은 프로젝트의 다른 세션이 기다릴 때만이다. */
async function announce($: any) {
  if (!me || me.root === '') return
  const now = await $.clock.now()
  const fresh = board.filter(r => {
    const ask = openAsk(r)
    return ask !== null && r.id !== me!.id && r.root === me!.root && r.state !== 'running' && !isDead(r, now) && !announced.has(`${r.id}:${ask.at}`)
  })
  if (fresh.length === 0) return
  for (const r of fresh) announced.add(`${r.id}:${openAsk(r)!.at}`)
  await openPane($)
  void $.ui.toast(`세션 보드에 결재·알림 ${fresh.length}개가 왔다`)
}

/** 이 세션이 도는 프로젝트의 키. 워크트리도 같은 프로젝트로 묶으려고 git 의 공용 폴더를 쓴다. git 이 없으면 세션 폴더다. */
async function projectRoot($: any): Promise<string> {
  const root: string = await $.session.root().catch(() => '')
  const git = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root }).catch(() => undefined)
  const found = git?.exitCode === 0 && git.stdout.trim() !== '' ? git.stdout.trim() : root
  return found.replace(/\\/g, '/').toLowerCase()
}

/** 앱 세션 번호. 터미널과 다른 세션 안에서 띄운 세션은 부모의 번호를 물려받으므로 쓰지 않는다(그 번호로 이동하면 엉뚱한 세션이다). */
async function ownerAppId($: any, sessionId: string): Promise<string | null> {
  const nested = isNestedSession(await $.env.get('CLAUDE_CODE_SESSION_ID'), sessionId)
  const id: string | undefined = isTerminal || nested ? undefined : await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
  return id ?? null
}

/** 신호로 이 세션의 결재·알림·확인을 새로 정해 쓴다. 상태(진행 중/대기/유휴)는 바꾸지 않는다. */
async function sync($: any, signals: Signals, isQuiet: boolean, patch: Partial<Rec> = {}) {
  if (!me) return
  const next = judge(me, signals, await $.clock.now(), isQuiet)
  await save($, { ...patch, ...next })
  // 같은 앱 세션이 새 세션 번호를 받았으면 옛 번호의 결재·알림은 주인이 없다. 닫는다
  for (const id of orphanIds(board, me.appId, me.id)) await closeIn($, id, { askClosedAt: await $.clock.now() })
}

/** 어느 세션의 기록 파일에 닫은 시각을 쓴다. 내 기록이면 메모리도 같이 고친다. */
async function closeIn($: any, id: string, patch: { askClosedAt?: number; reportClosedAt?: number }) {
  try {
    if (me && id === me.id) {
      await save($, patch)
      return
    }
    const path = `${dir}/${id}.json`
    await $.fs.write(path, JSON.stringify({ ...JSON.parse(await $.fs.read(path)), ...patch }))
  } catch {
    // 못 닫으면 칸이 남는다. 사용자가 다시 누른다
  }
  await refresh($)
  $.ui.invalidate('ui.render')
}

/** 칸을 연 상태를 바꾼다. 같은 줄을 다시 누르면 접는다. */
function toggle($: any, id: string) {
  openId = openId === id ? '' : id
  $.ui.invalidate('ui.render')
}

/** 그 세션으로 이동한다. 패널의 Link 는 claude:// 주소를 열지 않아서 OS 의 주소 처리기로 연다. shortcut: Windows 전용, 다른 OS 는 open/xdg-open 을 더한다. */
async function goTo($: any, r: Rec) {
  const link = appLink(r)
  if (link !== null) await $.process.run(['rundll32', 'url.dll,FileProtocolHandler', link]).catch(() => undefined)
}

/** 읽지 못한 기록 파일을 지운다. $.fs 에 지우기가 없어 cmd 의 del 을 쓰고, 파일 이름이 안전한 글자일 때만 지운다. shortcut: Windows 전용. */
async function removeBroken($: any, name: string) {
  const path = `${dir}/${name}`.replace(/\//g, '\\')
  if (/^[A-Za-z]:\\[\w .\-\\]+$/.test(path) && /^[\w.\-]+\.json$/.test(name)) await $.process.run(['cmd', '/c', 'del', '/q', path]).catch(() => undefined)
  parsedFiles.delete(name)
  await refresh($)
  $.ui.invalidate('ui.render')
}

async function purge($: any, now: number) {
  try {
    for (const f of await $.fs.list(dir)) {
      if (f.kind !== 'file' || !f.name.endsWith('.json') || now - f.mtimeMs <= PURGE_MS) continue
      const p = `${dir}/${f.name}`
      const rec = await $.fs.read(p).then(parseRec, () => null)
      if (!purgeable(rec, now - f.mtimeMs, PURGE_MS, PURGE_OPEN_MS)) continue
      await $.process.run(/^[A-Za-z]:/.test(p) ? ['cmd', '/c', 'del', '/q', p.replaceAll('/', '\\')] : ['rm', '-f', p])
    }
  } catch {
    // 지우지 못해도 STALE_MS 로 숨겨지니 괜찮다
  }
}

async function onTick($: any) {
  tick += 1
  if (tick % BEAT_EVERY === 0) await save($)
  await refresh($) // 패널이 닫혀 있어도 읽는다: 새 결재를 알려야 한다
  if (isOpen) $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    dir = home ? `${home}/.claude/session-board` : ''
    const cwd = await $.session.cwd()
    const now = await $.clock.now()
    isTerminal = e.surface === 'terminal'
    const id = await $.session.id()
    me = { id, name: cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd, state: 'idle', since: now, turnStartedAt: null, waitFor: null, done: 0, total: 0, step: '', updatedAt: now, appId: await ownerAppId($, id), root: await projectRoot($), ask: null, report: null, askClosedAt: 0, reportClosedAt: 0 }
    await $.command.register({ name: 'session_board', description: '세션 상태판(결재·알림·확인 / 진행 중 / 완료)을 열거나 닫습니다' })
    await purge($, now)
    // 다시 연 세션이나 다시 읽은 모드: 지난 기록의 칸을 이어받고 마지막 답으로 다시 판정한다. 신호가 없어도 닫지 않는다
    const before = await $.fs.read(`${dir}/${id}.json`).then(parseRec, () => null)
    if (before) me = { ...me, ask: before.ask, report: before.report, askClosedAt: before.askClosedAt, reportClosedAt: before.reportClosedAt }
    await save($)
    const messages = await $.session.messages().catch(() => [])
    turnStartCount = messages.length // 다음 턴은 이 뒤의 메시지만 판정한다
    const last = lastTurn(messages)
    // 확인 줄은 다시 더하지 않는다: 사용자가 이미 확인(닫음)한 줄이 되살아난다. 결재·알림은 아직 기다리면 다시 생겨야 한다
    await sync($, { ...signalsOf(last.text, last.uses, last.allText), reports: [] }, false).catch(() => undefined)
    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => onTick($))
    // 세션을 열면 패널도 같이 연다. 사용자가 닫으면 이번 세션에서는 다시 열지 않는다.
    // 데스크톱 앱 세션은 SDK 로 실행돼 isInteractive 가 false 이고 화면도 늦게 붙는다. 그래도 열기를 요청해 두면 화면이 붙을 때 그려진다.
    folded = (await $.store.get('folded')) === true
    await openPane($)
    return result
  })

  on('command.run', { command: 'session_board' }, async $ => {
    // 그려지고 있으면 닫는다. 열어 두려 했지만 아직 못 그리는 중이면(좁은 창), 사용자가 시킨 열기로 다시 연다
    if ((await $.ui.panes()).some(p => p.id === PANE_ID && p.isPlaced)) {
      await $.ui.close({ id: PANE_ID })
      isOpen = false
      return { text: '세션 상태판을 닫았습니다.' }
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? '세션 상태판을 열었습니다.' : '이 화면에는 패널을 놓을 자리가 없습니다.' }
  })

  // 사용자가 이 세션에 직접 입력했다. 답인지는 턴 끝에 정한다
  on('prompt.submit', async ($, e, next) => {
    const origin = (e.origin as { kind?: string } | undefined)?.kind
    if (origin === undefined || USER_ORIGINS.has(origin)) isUserTurn = true
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE_ID && e.origin.kind === 'person') isOpen = false // 사용자가 닫았다. 새 결재가 오면 다시 연다
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (me && e.agentId === undefined) {
      // /clear 는 session.start 없이 세션 id 만 바꾼다
      const id = await $.session.id()
      if (id !== me.id) me = { ...me, id }
      const t = await $.clock.now()
      const finished = me.total > 0 && me.done === me.total
      if (finished) plan = []
      await save($, { state: 'running', since: t, turnStartedAt: t, waitFor: null, ...(finished ? { done: 0, total: 0, step: '' } : {}) })
    }
    return next(e)
  })

  // 턴이 끝났다. 하위 에이전트의 턴은 판정하지 않는다. 판정이 실패해도 턴의 결과는 바꾸지 않는다
  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const wasUserTurn = isUserTurn
    const from = turnStartCount
    isUserTurn = false
    turnStartCount = undefined
    // 중단·오류·거절은 다시 판정하지 않는다: 사용자가 아직 답하지 않은 것이다
    if (e.reason === 'answer') {
      try {
        const messages = await $.session.messages()
        // 앞 턴 끝의 메시지 수가 다음 턴의 시작이다. 턴 시작 때 대화를 따로 읽지 않으려고 여기서 센다
        turnStartCount = messages.length
        const turn = lastTurn(messages, from)
        await sync($, signalsOf(e.answer, turn.uses, turn.allText), wasUserTurn, { state: 'idle', waitFor: null, since: await $.clock.now() })
      } catch {
        await go($, 'idle')
      }
    } else await go($, 'idle')
    return next(e)
  })

  // 권한 확인은 tool.call 이 next 를 부른 뒤에 일어난다. 결과가 ask 면 승인 대화상자가 뜬다 → 승인 대기.
  // 질문·계획 승인은 tool.call 이 따로 잡는다. 승인이 끝난 때를 알려 주는 이벤트는 없어서, 도구가 끝나거나(tool.call 의 next 가 돌아옴) 턴이 끝나야 풀린다.
  on('tool.check', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.tool_use_id !== undefined && result.decision === 'ask' && e.tool !== 'AskUserQuestion' && e.tool !== 'ExitPlanMode') await go($, 'waiting', waitLabel(e.tool))
    return result
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    if (e.tool === 'TodoWrite') {
      // CLI 의 작업 목록: 호출마다 목록 전체가 온다
      const raw = (e as any).todos
      plan = (Array.isArray(raw) ? raw : []).map((t: any) => ({ content: String(t?.activeForm || t?.content || ''), status: String(t?.status ?? 'pending') }))
      await save($, progress(plan))
    } else if (e.tool === PLAN_TOOL) {
      // 데스크톱 앱의 작업 목록: 목록 전체이거나 한 단계씩 고친 것
      plan = applyPlan(plan, e)
      if (plan.length > 0) await save($, progress(plan))
    }
    if (e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode') await go($, 'waiting', waitLabel(e.tool))
    // 선택 카드가 떠 있는 동안은 그 질문이 알림이다. 답하면 진행 중이다
    const isCard = e.tool === 'AskUserQuestion' && cardAsk(e as any) !== undefined
    if (isCard) await sync($, signalsOf('', [{ tool_use_id: '', tool: e.tool, input: e as never }]), false).catch(() => undefined)
    const result = await next(e)
    if (isCard) isUserTurn = true // 카드에 답한 것은 사용자의 입력이다. 이 턴이 신호 없이 끝나면 칸을 닫는다
    if (me?.state === 'waiting') await go($, 'running') // 질문에 답했거나, 승인되어 도구가 끝났다
    return result
  })

  // 사용자가 세션을 끝냈다: 결재·알림을 닫는다(확인은 사용자가 눌러야 닫힌다). 보관·앱 종료·이어받기는 칸을 남기고 "세션 끝남"으로 보인다
  on('session.end', async ($, e, next) => {
    ticker?.cancel()
    await save($, { state: 'ended', ...(CLOSING_ENDS.has(e.reason) ? { ask: null } : {}) })
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => {
    const { Box, Text, Svg, Button } = $.ui.resolve(e) as any
    const now = Date.now()
    const shown = board.map(r => ({ r, g: groupOf(r, now) })).filter(x => x.g !== 'hidden')
    const fold = Box({ key: 'fold', children: [Button({ key: 'fold-btn', label: folded ? '◂ 펼치기' : '접기 ▸', variant: 'secondary', onPress: () => setFolded($, !folded) })] })
    if (folded) {
      // 접은 상태: 묶음마다 알약 하나(개수만). 결재는 빨강, 알림은 호박색, 확인은 초록이라 눈에 띈다.
      const pills = GROUPS.map(g => ({ g, n: shown.filter(x => x.g === g.key).length }))
        .filter(x => x.n > 0)
        .map(x => Box({ key: x.g.key, children: [Text({ bold: true, color: x.g.fg, backgroundColor: x.g.bg, children: ` ${x.g.short} ${x.n} ` })] }))
      return Box({ flexDirection: 'column', gap: 1, children: [fold, ...(pills.length > 0 ? pills : [Text({ key: 'none', dimColor: true, children: '세션 없음' })])] })
    }
    if (shown.length === 0 && broken.length === 0) {
      return Box({
        flexDirection: 'column',
        children: [
          fold,
          Text({ key: 'empty', dimColor: true, children: '표시할 세션이 없습니다.' }),
          Text({ key: 'hint', dimColor: true, children: '다른 세션에도 이 모드가 켜져 있어야 보입니다. 닫으려면 /session_board 를 입력하세요.' }),
        ],
      })
    }
    if (typeof Svg === 'function' && (e as any).surface !== 'terminal') {
      // 그림을 그릴 수 있는 화면(데스크톱): 세션마다 파스텔 카드. 기다리는 칸은 오래 기다린 것부터, 나머지는 최근 상태가 바뀐 것부터.
      const sections = GROUPS.map(g => ({ g, rows: sortRows(shown.filter(x => x.g === g.key).map(x => x.r), g.key) })).filter(s => s.rows.length > 0)
      return Box({
        flexDirection: 'column',
        gap: 1,
        children: [fold, desktopBoard($, $.ui.resolve(e), sections, now), ...brokenRows($, Box, Text, Button), Text({ key: 'total', dimColor: true, children: `세션 ${shown.length}개 · 이름을 누르면 내용이 펴집니다` })],
      })
    }
    const body: any[] = [fold]
    for (const g of GROUPS) {
      const rows = sortRows(shown.filter(x => x.g === g.key).map(x => x.r), g.key)
      if (rows.length === 0) continue
      body.push(
        Box({
          key: `g-${g.key}`,
          flexDirection: 'column',
          gap: 1,
          marginTop: 1,
          children: [Box({ key: 'h', children: [Text({ bold: true, color: g.fg, backgroundColor: g.bg, children: ` ${g.title} · ${rows.length} ` })] }), ...ackAll($, Box, Button, g.key, rows), ...rows.map(r => card($, Box, Text, Svg, Button, r, g.key, now))],
        }),
      )
    }
    body.push(...brokenRows($, Box, Text, Button))
    body.push(Text({ key: 'total', dimColor: true, children: `세션 ${shown.length}개 · 열린 곳에서만 갱신됩니다` }))
    return Box({ flexDirection: 'column', children: body })
  })
}

/** 앱 링크: 눌러 열면 앱이 그 세션으로 이동한다. 앱 번호를 모르면(이전 버전 기록) null. */
// 이 값을 OS 에 넘기므로 번호가 정확한 모양일 때만 쓴다
export const appLink = (r: Rec): string | null => (r.appId !== null && APP_ID_FORMAT.test(r.appId) ? `claude://claude.ai/epitaxy/${r.appId}` : null)

/** 세션 하나의 줄: 고양이 · 이름(누르면 펴짐) | 상태바 | 이 세션. 한 줄에 놓아 세션 하나가 한 줄만 차지한다. 펴지면 그 아래에 내용이 붙는다. */
function sessionCard($: any, t: any, r: Rec, g: Mood, now: number, isMe: boolean) {
  const { Box, Svg, Button } = t
  const s = SKIN[g]
  const name = clip(r.name, 150, 14)
  const info = infoSvg(r, g, now)
  // 이미지 크기를 고정한다: 크기를 안 주면 패널을 넓힐 때 이미지가 폭에 맞춰 끝없이 커진다.
  const row = Box({
    key: 'row',
    alignItems: 'center',
    gap: 1,
    backgroundColor: g === 'request' || g === 'notice' || g === 'report' ? s.tint : undefined, // 줄은 가볍게 두고, 사용자를 기다리는 줄만 연한 바탕으로 눈에 띄게 한다
    paddingX: 1,
    children: [
      Svg({ key: 'av', source: avatarSvg(g), alt: `${s.alt} 고양이`, width: 32, height: 32 }),
      // 패널의 Link 는 claude:// 주소를 열지 않는다. 이름은 펴는 단추이고 이동은 펴진 곳의 "이동" 단추가 한다
      Button({ key: `nm:${r.id}`, plain: true, label: name, onPress: () => toggle($, r.id) }),
      Box({ key: 'fl', flexGrow: 1 }),
      Svg({ key: 'info', source: info.svg, alt: `${s.alt} 상태: ${r.state}${r.total > 0 ? `, 진척 ${r.done}/${r.total}` : ''}${r.step !== '' ? `, ${r.step}` : ''}`, width: SW, height: SH }),
      // 이 세션 알약 자리는 모든 줄이 같은 크기로 잡아(빈 줄은 빈 이미지) 상태바가 줄마다 같은 곳에 서게 한다.
      Svg({ key: 'me', source: isMe ? mePill : mePlace, alt: isMe ? '이 세션' : '', width: 44, height: 15 }),
    ],
  })
  return Box({ key: r.id, flexDirection: 'column', children: [row, openId === r.id ? detailBox($, t, r, now, isMe) : null] })
}

/** 펴진 칸의 내용: 질문, 배경 2줄, 선택지 1줄, 확인 줄, 단추(이동·확인·닫기). 답하는 단추는 없다. 답은 그 세션의 대화에서 한다. */
function detailBox($: any, t: any, r: Rec, now: number, isMe: boolean) {
  const { Box, Text, Button } = t
  const ask = openAsk(r)
  const report = openReport(r)
  const link = appLink(r)
  const kids: any[] = []
  if (ask) {
    const dim = r.state === 'running' // 진행 중이면 사용자가 이미 답했다
    kids.push(Text({ key: 'q', bold: true, dimColor: dim, children: ask.question }))
    ask.background.slice(0, MAX_BACKGROUND_LINES).forEach((line, i) => kids.push(Text({ key: `bg${i}`, children: line })))
    if (ask.options.length > 0) kids.push(Text({ key: 'op', dimColor: true, children: optionsLine(ask.options) }))
  }
  if (report) report.lines.forEach((line, i) => kids.push(Text({ key: `rp${i}`, color: SKIN.report.text, children: `✓ ${line}` })))
  if (!ask && !report) kids.push(Text({ key: 'st', dimColor: true, children: r.step !== '' ? `지금: ${r.step}` : '펼칠 내용이 없다' }))
  if (link === null && !isMe) kids.push(Text({ key: 'nolink', color: 'warning', children: '앱에서 연 세션이 아니다. 이동이 안 된다.' }))
  const buttons: any[] = []
  if (link !== null && !isMe) buttons.push(Button({ key: `go:${r.id}`, label: '이동', variant: 'secondary', onPress: () => goTo($, r) }))
  if (report) buttons.push(Button({ key: `ack:${r.id}`, label: '확인', onPress: () => closeIn($, r.id, { reportClosedAt: Date.now() }) }))
  if (closable(r, now)) buttons.push(Button({ key: `close:${r.id}`, label: '닫기', plain: true, onPress: () => closeIn($, r.id, { askClosedAt: Date.now() }) }))
  if (buttons.length > 0) kids.push(Box({ key: 'btns', gap: 1, children: buttons }))
  return Box({ key: 'detail', flexDirection: 'column', gap: 0, paddingX: 2, paddingBottom: 1, children: kids })
}

/** 읽지 못한 기록 파일의 줄. 닫기로 그 파일을 지운다. */
function brokenRows($: any, Box: any, Text: any, Button: any): any[] {
  return broken.map(b =>
    Box({ key: `bad-${b.name}`, alignItems: 'center', gap: 1, children: [Text({ key: 't', color: 'error', children: `● 읽지 못했다: ${b.name}` }), Box({ key: 'f', flexGrow: 1 }), Button({ key: `x:${b.name}`, label: '닫기', plain: true, onPress: () => removeBroken($, b.name) })] }),
  )
}

/** 확인(초록) 묶음에 칸이 둘 이상이면 "모두 확인" 단추를 둔다. */
function ackAll($: any, Box: any, Button: any, g: Group, rows: Rec[]): any[] {
  const withReport = rows.filter(r => openReport(r) !== null)
  if (g !== 'report' || withReport.length < 2) return []
  return [Box({ key: 'ack-all', children: [Button({ key: 'ack-all-btn', label: `확인 ${withReport.length}개 모두 확인`, onPress: () => Promise.all(withReport.map(r => closeIn($, r.id, { reportClosedAt: Date.now() }))) })] })]
}

/** 기다리는 칸은 오래 기다린 것부터, 나머지는 최근 상태가 바뀐 것부터. */
function sortRows(rows: Rec[], g: Group): Rec[] {
  const key = (r: Rec) => (g === 'request' || g === 'notice' ? (openAsk(r)?.at ?? r.since) : g === 'report' ? (openReport(r)?.at ?? r.since) : -r.since)
  return [...rows].sort((a, b) => key(a) - key(b))
}


/** 흰 상자 하나에 묶음 머리글과 세션 줄을 쌓는다(앱 테마와 관계없이 읽히도록 흰 바탕). 줄 사이는 얇은 구분선. */
function desktopBoard($: any, t: any, sections: { g: (typeof GROUPS)[number]; rows: Rec[] }[], now: number) {
  const { Box, Svg, Button } = t
  return Box({
    key: 'board',
    flexDirection: 'column',
    gap: 0,
    backgroundColor: C.white,
    borderStyle: 'round',
    borderColor: C.line,
    paddingX: 1,
    children: sections.flatMap(sec => [
      Svg({ key: `h-${sec.g.key}`, source: headSvg(sec.g.title, sec.rows.length, sec.g.key), alt: `${sec.g.title} ${sec.rows.length}`, width: BW + 16, height: 26 }),
      ...ackAll($, Box, Button, sec.g.key, sec.rows),
      ...sec.rows.flatMap((r, i) => [i > 0 ? Svg({ key: `d-${r.id}`, source: hairline, alt: '구분선' }) : null, sessionCard($, t, r, sec.g.key, now, me?.id === r.id)]),
    ]),
  })
}

// 급한 순서(결재 → 알림 → 확인 → 진행 중 → 유휴)로 묶는다. bg·fg 는 접은 알약과 터미널 알약의 색이다
const GROUPS = [
  { key: 'request', title: '결재', short: '결재', bg: SKIN.request.bead, fg: C.white },
  { key: 'notice', title: '알림', short: '알림', bg: C.amber, fg: C.ink },
  { key: 'report', title: '확인', short: '확인', bg: SKIN.report.bead, fg: C.white },
  { key: 'running', title: '진행 중', short: '진행', bg: C.indigo, fg: C.white },
  { key: 'idle', title: '완료·유휴', short: '유휴', bg: C.soft, fg: C.dim },
] as const

// 흰 카드 하나. 이름 / 뱃지 줄 / 진척 막대 / 지금 하는 단계 / (펴지면) 내용.
function card($: any, Box: any, Text: any, Svg: any, Button: any, r: Rec, g: Mood, now: number) {
  const gd = GROUPS.find(x => x.key === g)!
  const tone = g === 'idle' ? C.dim : gd.bg
  const pillText = gd.fg
  const pillBg = gd.bg
  const isMe = me?.id === r.id
  const pills = badges(r, now).map((b, i) =>
    b.main ? Text({ key: `b${i}`, bold: true, color: pillText, backgroundColor: pillBg, children: ` ${b.text} ` }) : Text({ key: `b${i}`, color: C.dim, children: b.text }),
  )
  const children: any[] = [
    Box({ key: 'top', gap: 1, children: [Button({ key: `nm:${r.id}`, plain: true, label: r.name, onPress: () => toggle($, r.id) }), isMe ? Text({ key: 'me', color: C.dim, children: '이 세션' }) : null] }),
    Box({ key: 'badges', gap: 1, children: pills }),
  ]
  if (r.total > 0) {
    children.push(
      Svg
        ? Box({ key: 'bar', children: [Svg({ source: barSvg(r.done, r.total, tone), alt: `진척 ${r.done}/${r.total}`, width: 160, height: 6 })] })
        : Text({ key: 'bar', color: tone, children: `${'█'.repeat(Math.round((10 * r.done) / r.total))}${'░'.repeat(10 - Math.round((10 * r.done) / r.total))}` }),
    )
  }
  if (g !== 'idle' && r.step !== '') children.push(Text({ key: 'step', color: C.dim, wrap: 'truncate-end', children: `지금: ${r.step}` }))
  if (openId === r.id) children.push(detailBox($, { Box, Text, Button }, r, now, isMe))
  return Box({ key: r.id, flexDirection: 'column', backgroundColor: C.white, borderStyle: 'round', borderColor: g === 'idle' || g === 'running' ? C.line : tone, paddingX: 1, children })
}
