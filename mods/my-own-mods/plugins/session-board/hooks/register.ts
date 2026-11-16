// session-board: 여러 세션의 상태를 오른쪽 패널에 모아 보여 준다. 진행 중 / 응답 대기 / 완료·유휴.
// 모드는 세션마다 따로 돌고 다른 세션 목록을 주는 API 가 없다. 그래서 세션마다 자기 상태를 파일 하나에 쓰고,
// 패널이 그 폴더를 읽어 모은다. 세션 하나가 파일 하나만 쓰므로 쓰기가 겹치지 않는다.
// 왼쪽 사이드바 항목에는 모드가 그릴 수 없다. 뱃지는 패널 안 카드에 단다.
// 세션을 열면 패널이 같이 열린다(넓은 창에서만 그려진다). "접기" 버튼은 패널을 좁은 너비로 다시 열고 개수 알약만 그린다.
// 호스트가 소스에서 on(...) 과 $.noun.method(...) 를 읽으므로 literal 로 쓰고, $ 를 받는 도우미는 최상위 함수로 둔다.

import type { Register } from 'claude-code'

const PANE_ID = 'session-board'
const TICK_MS = 5_000 // 패널이 열려 있으면 5초마다 폴더를 다시 읽는다
const BEAT_EVERY = 6 // 6틱(30초)마다 살아 있다고 다시 기록한다
const STALE_MS = 90_000 // 90초 넘게 기록이 없으면 죽은 세션으로 보고 숨긴다
const PURGE_MS = 24 * 60 * 60 * 1000 // 하루 넘은 파일은 시작할 때 지운다

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
}

// 색은 my-own-mods 의 다른 모드와 같다. 앱 테마는 읽을 수 없어 고정 색을 쓴다.
const C = { ink: '#14172B', dim: '#5B6080', line: '#E3E6F2', soft: '#EEF0F8', white: '#FFFFFF', indigo: '#4F6BFF', amber: '#FBBF24' }

// ---- 순수 함수(시험 대상) -------------------------------------------------------

export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}초`
  if (s < 3600) return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`
  return `${Math.floor(s / 3600)}시간 ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}분`
}

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
    }
  } catch {
    return null
  }
}

export type Group = 'running' | 'waiting' | 'idle' | 'hidden'
export function groupOf(r: Rec, now: number): Group {
  if (r.state === 'ended' || now - r.updatedAt > STALE_MS) return 'hidden'
  return r.state
}

export type Badge = { text: string; main: boolean }
/** 카드에 달 뱃지. 첫 번째가 알약(주), 나머지는 흐린 글자(보조). */
export function badges(r: Rec, now: number): Badge[] {
  const progress = r.total > 0 ? `${r.done}/${r.total} 단계` : ''
  const elapsed = r.turnStartedAt !== null ? `경과 ${fmtDur(now - r.turnStartedAt)}` : ''
  const list: string[] =
    r.state === 'waiting'
      ? [`${r.waitFor ?? '응답'} 대기`, `대기 ${fmtDur(now - r.since)}`, progress]
      : r.state === 'running'
        ? progress ? [progress, elapsed] : [elapsed]
        : [`${fmtDur(now - r.since)} 전`, progress && `${progress}`]
  return list.filter(t => t !== '').map((text, i) => ({ text, main: i === 0 }))
}

export function barSvg(done: number, total: number, color: string, w = 160): string {
  const fill = total > 0 ? Math.round((w * Math.min(done, total)) / total) : 0
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 6"><rect width="${w}" height="6" rx="3" fill="${C.line}"/>${fill > 0 ? `<rect width="${fill}" height="6" rx="3" fill="${color}"/>` : ''}</svg>`
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
    const files = (await $.fs.list(dir)).filter((f: any) => f.kind === 'file' && f.name.endsWith('.json'))
    const recs = await Promise.all(files.map((f: any) => $.fs.read(`${dir}/${f.name}`).then(parseRec, () => null)))
    // 내 기록은 파일보다 메모리가 최신이다
    board = [...(me ? [me] : []), ...recs.filter((r): r is Rec => r !== null && r.id !== me?.id)]
  } catch {
    // 폴더가 아직 없으면 빈 목록
  }
}

async function purge($: any, now: number) {
  try {
    for (const f of await $.fs.list(dir)) {
      if (f.kind !== 'file' || !f.name.endsWith('.json') || now - f.mtimeMs <= PURGE_MS) continue
      const p = `${dir}/${f.name}`
      await $.process.run(/^[A-Za-z]:/.test(p) ? ['cmd', '/c', 'del', '/q', p.replaceAll('/', '\\')] : ['rm', '-f', p])
    }
  } catch {
    // 지우지 못해도 STALE_MS 로 숨겨지니 괜찮다
  }
}

async function onTick($: any) {
  tick += 1
  if (tick % BEAT_EVERY === 0) await save($)
  if (isOpen) {
    await refresh($)
    $.ui.invalidate('ui.render')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    dir = home ? `${home}/.claude/session-board` : ''
    const cwd = await $.session.cwd()
    const now = await $.clock.now()
    me = { id: await $.session.id(), name: cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd, state: 'idle', since: now, turnStartedAt: null, waitFor: null, done: 0, total: 0, step: '', updatedAt: now, appId: (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')) ?? null }
    await $.command.register({ name: 'session_board', description: '세션 상태판(진행 중 / 응답 대기 / 완료)을 열거나 닫습니다' })
    await purge($, now)
    await save($)
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

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await go($, 'idle')
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
    const result = await next(e)
    if (me?.state === 'waiting') await go($, 'running') // 질문에 답했거나, 승인되어 도구가 끝났다
    return result
  })

  on('session.end', async ($, e, next) => {
    ticker?.cancel()
    await save($, { state: 'ended' })
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => {
    const { Box, Text, Svg, Button } = $.ui.resolve(e) as any
    const now = Date.now()
    const shown = board.map(r => ({ r, g: groupOf(r, now) })).filter(x => x.g !== 'hidden')
    const fold = Box({ key: 'fold', children: [Button({ key: 'fold-btn', label: folded ? '◂ 펼치기' : '접기 ▸', variant: 'secondary', onPress: () => setFolded($, !folded) })] })
    if (folded) {
      // 접은 상태: 묶음마다 알약 하나(개수만). 응답 대기가 있으면 호박색 알약이 눈에 띈다.
      const pills = GROUPS.map(g => ({ g, n: shown.filter(x => x.g === g.key).length }))
        .filter(x => x.n > 0)
        .map(x => Box({ key: x.g.key, children: [Text({ bold: true, color: x.g.fg, backgroundColor: x.g.bg, children: ` ${x.g.short} ${x.n} ` })] }))
      return Box({ flexDirection: 'column', gap: 1, children: [fold, ...(pills.length > 0 ? pills : [Text({ key: 'none', dimColor: true, children: '세션 없음' })])] })
    }
    if (shown.length === 0) {
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
      // 그림을 그릴 수 있는 화면(데스크톱): 세션마다 파스텔 카드. 응답 대기는 오래 기다린 것부터, 나머지는 최근 상태가 바뀐 것부터.
      const sections = GROUPS.map(g => ({
        g,
        rows: shown
          .filter(x => x.g === g.key)
          .map(x => x.r)
          .sort((a, b) => (g.key === 'waiting' ? a.since - b.since : b.since - a.since)),
      })).filter(s => s.rows.length > 0)
      return Box({
        flexDirection: 'column',
        gap: 1,
        children: [fold, desktopBoard($.ui.resolve(e), sections, now), Text({ key: 'total', dimColor: true, children: `세션 ${shown.length}개 · 이름을 누르면 이동합니다` })],
      })
    }
    const body: any[] = [fold]
    for (const g of GROUPS) {
      const rows = shown
        .filter(x => x.g === g.key)
        .map(x => x.r)
        // 대기는 오래 기다린 것부터, 나머지는 최근 상태가 바뀐 것부터
        .sort((a, b) => (g.key === 'waiting' ? a.since - b.since : b.since - a.since))
      if (rows.length === 0) continue
      body.push(
        Box({
          key: `g-${g.key}`,
          flexDirection: 'column',
          gap: 1,
          marginTop: 1,
          children: [Box({ key: 'h', children: [Text({ bold: true, color: g.fg, backgroundColor: g.bg, children: ` ${g.title} · ${rows.length} ` })] }), ...rows.map(r => card(Box, Text, Svg, r, g.key, now))],
        }),
      )
    }
    body.push(Text({ key: 'total', dimColor: true, children: `세션 ${shown.length}개 · 열린 곳에서만 갱신됩니다` }))
    return Box({ flexDirection: 'column', children: body })
  })
}

// ---- 데스크톱: 세션마다 파스텔 카드. 우주비행사 고양이 아바타 + 상태 알약 + 진척 구슬 ----
// 이름은 호스트 Link 로 그려 누르면 그 세션으로 이동한다(앱 링크). 이미지는 눌리지 않아 눌리는 곳은 이름뿐이다.
// 고양이는 agent-panel 의 캐릭터에서 상태 셋(달리는 / 깃발 든 / 조는)만 작은 조각으로 옮겨 왔다.
const BW = 226 // 카드 아랫줄 이미지 폭: 패널 안쪽 폭(약 270) 에서 아바타 자리 들여쓰기(약 40)를 뺀 값. 넘으면 이미지가 줄어 글씨가 작아진다
const P = { indigoText: '#3F5BEF', amberText: '#92400E', mute: '#B6BACF', tag: '#9AA0BC' }
const SANS = "'Noto Sans KR','Malgun Gothic',system-ui,sans-serif"
const MONO = "'JetBrains Mono',Consolas,monospace"
type Run = { t: string; fill: string; weight?: number; mono?: boolean }
const isWide = (ch: string) => /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch)
const tw = (s: string, size: number, mono = false) => [...s].reduce((n, ch) => n + (isWide(ch) ? size : size * (mono ? 0.6 : 0.56)), 0)
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** 폭을 넘으면 끝을 줄이고 …을 붙인다. */
function clip(s: string, max: number, size: number): string {
  if (tw(s, size) <= max) return s
  let o = s
  while (o.length > 1 && tw(`${o}…`, size) > max) o = o.slice(0, -1)
  return `${o}…`
}
const rs = (list: Run[], x: number, y: number, size: number, anchor = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" xml:space="preserve"${anchor ? ` text-anchor="${anchor}"` : ''}>${list.map(r => `<tspan fill="${r.fill}" font-family="${r.mono ? MONO : SANS}" font-weight="${r.weight ?? 400}">${xml(r.t)}</tspan>`).join('')}</text>`

type Mood = 'running' | 'waiting' | 'idle'
type Skin = { tint: string; edge: string; bubble: string; pill: string; text: string; bead: string; cat: 'run' | 'flag' | 'zz'; alt: string }
// 상태마다 파스텔 한 벌: 카드 바탕·테두리, 아바타 동그라미, 알약, 구슬 색. 응답 대기만 따뜻한 호박색이라 눈에 띈다.
const SKIN: Record<Mood, Skin> = {
  running: { tint: '#F5F7FF', edge: '#D6DDFF', bubble: '#E4E9FF', pill: '#E4E9FF', text: P.indigoText, bead: C.indigo, cat: 'run', alt: '달리는' },
  waiting: { tint: '#FFFBEB', edge: '#F6D58A', bubble: '#FEF3C7', pill: '#FEF3C7', text: P.amberText, bead: C.amber, cat: 'flag', alt: '깃발 든' },
  idle: { tint: '#FAFAFD', edge: '#E3E6F2', bubble: '#EEF0F8', pill: '#EEF0F8', text: C.dim, bead: P.mute, cat: 'zz', alt: '조는' },
}
// 24x24 도트 고양이(agent-panel 에서 옮김). 같은 색 칸을 path 하나로 합쳐 줄였다.
const CAT = {
  run: '<symbol id="run" viewBox="0 0 24 24" shape-rendering="crispEdges"><path fill="#E5503F" d="M11 0h2v1h-2zM10 16h1v1h-1z"/><path fill="#CBCBC2" d="M11 1h2v1h-2zM8 18h8v1h-8z"/><path fill="#A9CBEA" d="M6 2h12v1h-12zM5 3h1v1h-1zM18 3h1v1h-1zM4 4h1v1h-1zM19 4h1v1h-1zM4 5h1v1h-1zM19 5h1v1h-1zM4 6h1v1h-1zM19 6h1v1h-1zM4 7h1v1h-1zM19 7h1v1h-1zM4 8h1v1h-1zM19 8h1v1h-1zM4 9h1v1h-1zM19 9h1v1h-1zM4 10h1v1h-1zM19 10h1v1h-1zM4 11h1v1h-1zM19 11h1v1h-1zM5 12h1v1h-1zM18 12h1v1h-1zM6 13h12v1h-12z"/><path fill="#F2994A" d="M6 3h1v1h-1zM17 3h1v1h-1zM5 4h1v1h-1zM7 4h3v1h-3zM11 4h1v1h-1zM13 4h1v1h-1zM15 4h4v1h-4zM6 5h4v1h-4zM11 5h3v1h-3zM15 5h4v1h-4zM6 6h13v1h-13zM5 7h3v1h-3zM10 7h4v1h-4zM16 7h3v1h-3zM5 8h3v1h-3zM10 8h4v1h-4zM16 8h3v1h-3zM5 9h3v1h-3zM10 9h4v1h-4zM16 9h3v1h-3zM5 10h1v1h-1zM7 10h2v1h-2zM15 10h2v1h-2zM18 10h1v1h-1zM5 11h1v1h-1zM7 11h2v1h-2zM15 11h2v1h-2zM18 11h1v1h-1zM6 12h3v1h-3zM15 12h3v1h-3zM5 17h1v1h-1zM5 18h3v1h-3z"/><path fill="#E3F0FB" d="M7 3h10v1h-10z"/><path fill="#FFD35A" d="M2 4h1v1h-1zM1 5h3v1h-3zM2 6h1v1h-1zM21 18h1v1h-1zM20 19h3v1h-3zM21 20h1v1h-1z"/><path fill="#FFFFFF" d="M6 4h1v1h-1zM5 5h1v1h-1zM5 6h1v1h-1zM8 7h1v1h-1zM14 7h1v1h-1z"/><path fill="#C9702A" d="M10 4h1v1h-1zM12 4h1v1h-1zM14 4h1v1h-1zM10 5h1v1h-1zM14 5h1v1h-1zM3 16h2v1h-2z"/><path fill="#2A2523" d="M9 7h1v1h-1zM15 7h1v1h-1zM8 8h2v1h-2zM14 8h2v1h-2zM8 9h2v1h-2zM14 9h2v1h-2zM10 11h1v1h-1zM13 11h1v1h-1zM11 12h2v1h-2z"/><path fill="#F29A9A" d="M6 10h1v1h-1zM11 10h2v1h-2zM17 10h1v1h-1zM6 11h1v1h-1zM17 11h1v1h-1z"/><path fill="#FFE3BD" d="M9 10h2v1h-2zM13 10h2v1h-2zM9 11h1v1h-1zM11 11h2v1h-2zM14 11h1v1h-1zM9 12h2v1h-2zM13 12h2v1h-2z"/><path fill="#4C8DE0" d="M6 14h12v1h-12zM13 16h1v1h-1zM6 17h1v1h-1zM17 17h1v1h-1zM8 21h3v1h-3zM13 21h3v1h-3z"/><path fill="#F4F4F0" d="M8 15h8v1h-8zM6 16h4v1h-4zM11 16h2v1h-2zM14 16h4v1h-4zM7 17h10v1h-10zM8 19h3v1h-3zM13 19h3v1h-3zM8 20h3v1h-3zM13 20h3v1h-3z"/></symbol>',
  flag: '<symbol id="flag" viewBox="0 0 24 24" shape-rendering="crispEdges"><path fill="#CBCBC2" d="M11 0h2v1h-2zM8 17h8v1h-8z"/><path fill="#A9CBEA" d="M6 1h12v1h-12zM5 2h1v1h-1zM18 2h1v1h-1zM4 3h1v1h-1zM19 3h1v1h-1zM4 4h1v1h-1zM19 4h1v1h-1zM4 5h1v1h-1zM19 5h1v1h-1zM4 6h1v1h-1zM19 6h1v1h-1zM4 7h1v1h-1zM19 7h1v1h-1zM4 8h1v1h-1zM19 8h1v1h-1zM4 9h1v1h-1zM19 9h1v1h-1zM4 10h1v1h-1zM19 10h1v1h-1zM5 11h1v1h-1zM18 11h1v1h-1zM6 12h12v1h-12z"/><path fill="#F2994A" d="M6 2h1v1h-1zM17 2h1v1h-1zM5 3h1v1h-1zM7 3h3v1h-3zM11 3h1v1h-1zM13 3h1v1h-1zM15 3h4v1h-4zM6 4h4v1h-4zM11 4h3v1h-3zM15 4h4v1h-4zM6 5h13v1h-13zM5 6h14v1h-14zM5 7h4v1h-4zM10 7h5v1h-5zM16 7h3v1h-3zM5 8h3v1h-3zM9 8h1v1h-1zM11 8h3v1h-3zM15 8h1v1h-1zM17 8h2v1h-2zM5 9h1v1h-1zM7 9h2v1h-2zM15 9h2v1h-2zM18 9h1v1h-1zM5 10h1v1h-1zM7 10h2v1h-2zM15 10h2v1h-2zM18 10h1v1h-1zM6 11h3v1h-3zM15 11h3v1h-3zM5 14h1v1h-1zM5 15h1v1h-1zM6 17h2v1h-2z"/><path fill="#E3F0FB" d="M7 2h10v1h-10z"/><path fill="#2A2523" d="M21 2h1v1h-1zM21 3h1v1h-1zM21 4h1v1h-1zM21 5h1v1h-1zM21 6h1v1h-1zM9 7h1v1h-1zM15 7h1v1h-1zM21 7h1v1h-1zM8 8h1v1h-1zM10 8h1v1h-1zM14 8h1v1h-1zM16 8h1v1h-1zM21 8h1v1h-1zM21 9h1v1h-1zM10 10h4v1h-4zM21 10h1v1h-1zM10 11h1v1h-1zM13 11h1v1h-1zM21 11h1v1h-1zM21 12h1v1h-1zM21 13h1v1h-1zM21 14h1v1h-1z"/><path fill="#E5503F" d="M22 2h2v1h-2zM22 3h2v1h-2zM22 4h2v1h-2zM23 5h1v1h-1zM10 15h1v1h-1z"/><path fill="#FFFFFF" d="M6 3h1v1h-1zM5 4h1v1h-1zM5 5h1v1h-1z"/><path fill="#C9702A" d="M10 3h1v1h-1zM12 3h1v1h-1zM14 3h1v1h-1zM10 4h1v1h-1zM14 4h1v1h-1zM4 13h1v1h-1z"/><path fill="#FFD35A" d="M2 5h1v1h-1zM1 6h3v1h-3zM2 7h1v1h-1zM22 20h1v1h-1zM21 21h3v1h-3zM22 22h1v1h-1z"/><path fill="#F29A9A" d="M6 9h1v1h-1zM11 9h2v1h-2zM17 9h1v1h-1zM6 10h1v1h-1zM17 10h1v1h-1zM11 11h2v1h-2z"/><path fill="#FFE3BD" d="M9 9h2v1h-2zM13 9h2v1h-2zM9 10h1v1h-1zM14 10h1v1h-1zM9 11h1v1h-1zM14 11h1v1h-1z"/><path fill="#4C8DE0" d="M6 13h12v1h-12zM13 15h1v1h-1zM6 16h1v1h-1zM8 19h3v1h-3zM13 19h3v1h-3z"/><path fill="#F4F4F0" d="M8 14h8v1h-8zM6 15h4v1h-4zM11 15h2v1h-2zM14 15h2v1h-2zM7 16h9v1h-9zM8 18h3v1h-3zM13 18h3v1h-3z"/></symbol>',
  zz: '<symbol id="zz" viewBox="0 0 24 24" shape-rendering="crispEdges"><path fill="#E5503F" d="M11 1h2v1h-2zM10 17h1v1h-1z"/><path fill="#CBCBC2" d="M11 2h2v1h-2zM8 19h8v1h-8z"/><path fill="#A9CBEA" d="M6 3h12v1h-12zM5 4h1v1h-1zM18 4h1v1h-1zM4 5h1v1h-1zM4 6h1v1h-1zM19 6h1v1h-1zM4 7h1v1h-1zM4 8h1v1h-1zM19 8h1v1h-1zM4 9h1v1h-1zM19 9h1v1h-1zM4 10h1v1h-1zM19 10h1v1h-1zM4 11h1v1h-1zM19 11h1v1h-1zM4 12h1v1h-1zM19 12h1v1h-1zM5 13h1v1h-1zM18 13h1v1h-1zM6 14h12v1h-12z"/><path fill="#F2994A" d="M6 4h1v1h-1zM17 4h1v1h-1zM5 5h1v1h-1zM7 5h3v1h-3zM11 5h1v1h-1zM13 5h1v1h-1zM15 5h4v1h-4zM6 6h4v1h-4zM11 6h3v1h-3zM15 6h4v1h-4zM6 7h13v1h-13zM5 8h14v1h-14zM5 9h3v1h-3zM9 9h1v1h-1zM11 9h3v1h-3zM15 9h1v1h-1zM17 9h2v1h-2zM5 10h4v1h-4zM10 10h5v1h-5zM16 10h3v1h-3zM5 11h1v1h-1zM7 11h2v1h-2zM15 11h2v1h-2zM18 11h1v1h-1zM5 12h1v1h-1zM7 12h2v1h-2zM15 12h2v1h-2zM18 12h1v1h-1zM6 13h3v1h-3zM15 13h3v1h-3zM5 17h1v1h-1zM5 18h1v1h-1z"/><path fill="#E3F0FB" d="M7 4h10v1h-10z"/><path fill="#FFFFFF" d="M6 5h1v1h-1zM5 6h1v1h-1zM5 7h1v1h-1z"/><path fill="#C9702A" d="M10 5h1v1h-1zM12 5h1v1h-1zM14 5h1v1h-1zM10 6h1v1h-1zM14 6h1v1h-1zM4 16h1v1h-1z"/><path fill="#8D9CF0" d="M19 5h3v1h-3zM20 6h1v1h-1zM19 7h3v1h-3z"/><path fill="#2A2523" d="M8 9h1v1h-1zM10 9h1v1h-1zM14 9h1v1h-1zM16 9h1v1h-1zM9 10h1v1h-1zM15 10h1v1h-1zM11 12h2v1h-2zM11 13h2v1h-2z"/><path fill="#F29A9A" d="M6 11h1v1h-1zM11 11h2v1h-2zM17 11h1v1h-1zM6 12h1v1h-1zM17 12h1v1h-1z"/><path fill="#FFE3BD" d="M9 11h2v1h-2zM13 11h2v1h-2zM9 12h2v1h-2zM13 12h2v1h-2zM9 13h2v1h-2zM13 13h2v1h-2z"/><path fill="#4C8DE0" d="M6 15h12v1h-12zM13 17h1v1h-1zM6 19h1v1h-1zM17 19h1v1h-1zM8 21h3v1h-3zM13 21h3v1h-3z"/><path fill="#F4F4F0" d="M8 16h8v1h-8zM8 17h2v1h-2zM11 17h2v1h-2zM14 17h2v1h-2zM6 18h12v1h-12zM7 19h1v1h-1zM16 19h1v1h-1zM8 20h3v1h-3zM13 20h3v1h-3z"/></symbol>',
}

/** 앱 링크: 눌러 열면 앱이 그 세션으로 이동한다. 앱 번호를 모르면(이전 버전 기록) null. */
export const appLink = (r: Rec): string | null => (r.appId ? `claude://claude.ai/epitaxy/${r.appId}` : null)

/** 상태에 맞는 고양이가 파스텔 동그라미 안에 있는 36x36 아바타. 필요한 고양이 하나만 담는다. */
export function avatarSvg(g: Mood): string {
  const s = SKIN[g]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><defs>${CAT[s.cat]}</defs><circle cx="18" cy="18" r="17" fill="${s.bubble}"/><use href="#${s.cat}" x="4" y="5" width="28" height="28"/></svg>`
}

/** 묶음 머리글: 제목과 개수 알약. */
const headSvg = (title: string, n: number, g: Mood) => {
  const s = SKIN[g]
  const nw = tw(String(n), 10.5, true) + 10
  const nx = 2 + tw(title, 13) + 6
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BW + 16}" height="26" viewBox="0 0 ${BW + 16} 26">${rs([{ t: title, fill: C.ink, weight: 700 }], 2, 18, 13)}<rect x="${nx}" y="6" width="${nw}" height="15" rx="7.5" fill="${s.pill}"/>${rs([{ t: String(n), fill: s.text, weight: 700, mono: true }], nx + nw / 2, 17, 10.5, 'middle')}</svg>`
}
const DOT = '#D3D8EC' // 아직 안 한 단계: 연한 파스텔 바탕에서도 보이는 진한 회색
/** "이 세션" 작은 알약. 글자 배경으로 그리면 호스트 글씨 크기라 너무 커서 이미지로 그린다. */
const mePill = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 15"><rect width="44" height="15" rx="7.5" fill="${C.soft}"/>${rs([{ t: '이 세션', fill: C.dim, weight: 700 }], 22, 11, 10.5, 'middle')}</svg>`

const SW = 92 // 상태바 이미지 폭
const SH = 32 // 고양이 아바타와 같은 높이: 이름 | 상태바 | 이 세션 이 한 줄에 놓인다

/** 상태바: 위에 상태 글자(+짧은 시간), 아래에 점점 채워지는 얇은 막대와 done/total. 끝에 현재 위치 동그라미. */
export function infoSvg(r: Rec, g: Mood, now: number): { svg: string; h: number } {
  const s = SKIN[g]
  const label: Run[] =
    g === 'waiting'
      ? [{ t: `${r.waitFor ?? '응답'} 대기`, fill: s.text, weight: 700 }, { t: ` ${fmtDur(now - r.since)}`, fill: C.dim }]
      : g === 'running'
        ? [{ t: '작업 중', fill: s.text, weight: 700 }, ...(r.turnStartedAt !== null ? [{ t: ` ${fmtDur(now - r.turnStartedAt)}`, fill: C.dim }] : [])]
        : [{ t: '쉬는 중', fill: C.dim, weight: 700 }, { t: ` ${fmtDur(now - r.since)}`, fill: C.dim }]
  // 폭을 넘으면 시간(뒤 조각)부터 뺀다.
  const fitted = label.length > 1 && label.reduce((n, x) => n + tw(x.t, 11), 0) > SW ? label.slice(0, 1) : label
  const parts: string[] = [rs(fitted.length === 1 ? [{ ...fitted[0], t: clip(fitted[0].t, SW, 11) }] : fitted, 0, r.total > 0 ? 12 : 20, 11)]
  if (r.total > 0) {
    const room = 52
    const y = 19
    const live = g !== 'idle' && r.done < r.total
    // 끝낸 만큼 채운다. 0단계여도 시작했음이 보이도록 작은 끝부분을 채우고, 끝에는 현재 위치 동그라미를 단다.
    const fill = r.done > 0 ? Math.max(5, Math.round((room * Math.min(r.done, r.total)) / r.total)) : live ? 5 : 0
    parts.push(`<rect x="0" y="${y}" width="${room}" height="4" rx="2" fill="${DOT}"/>`)
    if (fill > 0) parts.push(`<rect x="0" y="${y}" width="${fill}" height="4" rx="2" fill="${s.bead}"/>`)
    if (live) parts.push(`<circle cx="${Math.max(3.5, fill)}" cy="${y + 2}" r="3.5" fill="${C.white}" stroke="${s.bead}" stroke-width="1.5"/>`)
    parts.push(rs([{ t: `${r.done}/${r.total}`, fill: C.dim, mono: true }], SW, y + 5, 10.5, 'end'))
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}">${parts.join('')}</svg>`, h: SH }
}

/** 세션 하나의 줄: 고양이 · 이름(링크) | 상태바 | 이 세션. 한 줄에 놓아 세션 하나가 한 줄만 차지한다. */
function sessionCard(t: any, r: Rec, g: Mood, now: number, isMe: boolean) {
  const { Box, Text, Svg, Link } = t
  const s = SKIN[g]
  const href = isMe ? null : appLink(r)
  const name = clip(r.name, 150, 14)
  const info = infoSvg(r, g, now)
  // 이미지 크기를 고정한다: 크기를 안 주면 패널을 넓힐 때 이미지가 폭에 맞춰 끝없이 커진다.
  return Box({
    key: r.id,
    alignItems: 'center',
    gap: 1,
    backgroundColor: g === 'waiting' ? s.tint : undefined, // 줄은 가볍게 두고, 응답 대기 줄만 연한 호박색 바탕으로 눈에 띄게 한다
    paddingX: 1,
    children: [
      Svg({ key: 'av', source: avatarSvg(g), alt: `${s.alt} 고양이`, width: 32, height: 32 }),
      href !== null && typeof Link === 'function' ? Link({ key: 'ln', href, label: name }) : Text({ key: 'nm', color: C.ink, children: name }),
      Box({ key: 'fl', flexGrow: 1 }),
      Svg({ key: 'info', source: info.svg, alt: `${s.alt} 상태: ${r.state}${r.total > 0 ? `, 진척 ${r.done}/${r.total}` : ''}${r.step !== '' ? `, ${r.step}` : ''}`, width: SW, height: SH }),
      // 이 세션 알약 자리는 모든 줄이 같은 크기로 잡아(빈 줄은 빈 이미지) 상태바가 줄마다 같은 곳에 서게 한다.
      Svg({ key: 'me', source: isMe ? mePill : mePlace, alt: isMe ? '이 세션' : '', width: 44, height: 15 }),
    ],
  })
}

const mePlace = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 15"></svg>'
/** 줄 사이 구분선. 폭을 안 주면 이미지가 패널 폭에 맞춰져 상자 끝까지 닿는다(높이는 비율대로 약 6px 이하라 선은 가늘다). */
const hairline = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 8"><rect y="3.5" width="600" height="1" fill="${C.line}"/></svg>`

/** 흰 상자 하나에 묶음 머리글과 세션 줄을 쌓는다(앱 테마와 관계없이 읽히도록 흰 바탕). 줄 사이는 얇은 구분선. */
function desktopBoard(t: any, sections: { g: (typeof GROUPS)[number]; rows: Rec[] }[], now: number) {
  const { Box, Svg } = t
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
      ...sec.rows.flatMap((r, i) => [i > 0 ? Svg({ key: `d-${r.id}`, source: hairline, alt: '구분선' }) : null, sessionCard(t, r, sec.g.key, now, me?.id === r.id)]),
    ]),
  })
}

const GROUPS = [
  { key: 'running', title: '진행 중', short: '진행', bg: C.indigo, fg: C.white },
  { key: 'waiting', title: '응답 대기', short: '대기', bg: C.amber, fg: C.ink },
  { key: 'idle', title: '완료·유휴', short: '유휴', bg: C.soft, fg: C.dim },
] as const

// 흰 카드 하나. 이름 / 뱃지 줄 / 진척 막대 / 지금 하는 단계.
function card(Box: any, Text: any, Svg: any, r: Rec, g: 'running' | 'waiting' | 'idle', now: number) {
  const tone = g === 'running' ? C.indigo : g === 'waiting' ? C.amber : C.dim
  const pillText = g === 'waiting' ? C.ink : g === 'running' ? C.white : C.dim
  const pillBg = g === 'idle' ? C.soft : tone
  const isMe = me?.id === r.id
  const pills = badges(r, now).map((b, i) =>
    b.main ? Text({ key: `b${i}`, bold: true, color: pillText, backgroundColor: pillBg, children: ` ${b.text} ` }) : Text({ key: `b${i}`, color: C.dim, children: b.text }),
  )
  const children: any[] = [
    Box({ key: 'top', gap: 1, children: [Text({ key: 'n', bold: true, color: C.ink, wrap: 'truncate-end', children: r.name }), isMe ? Text({ key: 'me', color: C.dim, children: '이 세션' }) : null] }),
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
  return Box({ key: r.id, flexDirection: 'column', backgroundColor: C.white, borderStyle: 'round', borderColor: g === 'waiting' ? C.amber : C.line, paddingX: 1, children })
}
