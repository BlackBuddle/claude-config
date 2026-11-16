// agent-panel: 하위 에이전트를 세션 보드 패널 아래에 칸 하나씩 보여 준다. 실행 중인 것이 위다.
//   칸: 고양이 | ● 상태 · 시간 / 이름 / 유형 · 호출 수 · 마지막 도구
// Svg 요소가 있는 화면(데스크톱 등)에서는 칸마다 우주비행사 고양이를 그리고, 없는 화면(터미널)은 글자 얼굴을 쓴다.
// 패널을 못 그리는 좁은 창에서는 아무것도 그리지 않는다(relay-band 의 "하위 N" 칸이 대신한다).
// 호스트가 소스에서 on(...) 과 $.noun.method(...) 를 읽으므로 literal 로 쓰고, $ 를 받는 도우미는 최상위 함수로 둔다.
// 세션 보드 플러그인의 모듈이다. 오른쪽 패널을 하나로 쓰려고 옮겼다 (2026-11-16 사용자 결정)

import type { Register } from 'claude-code'

import { fmtDur } from './art'
import { bandTick } from './band'

// 세션 보드와 같은 패널을 쓴다
const PANE_ID = 'session-board'
// 고양이 프레임 간격. 설계는 140ms 였지만 갱신 비용을 아직 못 재서 250ms 로 시작한다. 부드러우면 줄이고, 버거우면 늘린다.
const FRAME_MS = 250
const LIST_EVERY = 20 // 프레임 20개마다(5초) 목록을 다시 읽는다
const KEEP = 20 // shortcut: 끝난 에이전트는 최근 20개만 남긴다
// 24칸 도트를 정확히 2배로 그린다. 36px(1.5배)는 선 굵기가 고르지 않고 표정이 뭉개졌다.
const CAT_PX = 48

type A = {
  id: string
  name: string
  type: string
  status: string
  startedAt: number
  endedAt: number | null
  calls: number
  lastTool: string
}

const agents = new Map<string, A>()
let frame = 0
let ticker: { cancel: () => void } | null = null
let autoOpened = false

// 유형마다 표정 순서가 다르다. 한 글자(한 코드포인트)이고 동아시아 모호 폭이 아닌 글자만 쓴다(ö ô õ o).
// ò ó 는 한국어 터미널에서 두 칸이 될 수 있어 뺐다.
export const FRAMES: Record<string, string[]> = {
  Explore: ['õ', 'ö', 'ô', 'ö'], // 두리번
  Plan: ['õ', 'õ', 'ö', 'ô'], // 골똘
  'general-purpose': ['ö', 'ö', 'ö', 'o'], // 깜빡
}
export const DEFAULT_FRAMES = ['ö', 'ö', 'o', 'o']

const LABEL: Record<string, string> = {
  pending: '준비',
  running: '실행 중',
  waiting: '대기',
  idle: '대기',
  completed: '완료',
  failed: '실패',
  killed: '중단',
}
const isLive = (status: string) => status === 'running' || status === 'pending'
// 상태는 기호(윗줄)와 단어(아랫줄)와 색, 세 가지로 말한다. 테마 색 이름을 쓴다.
const COLOR: Record<string, string> = { running: 'suggestion', pending: 'suggestion', completed: 'success', failed: 'error', killed: 'warning' }

// ---- 우주비행사 고양이 (24x24 도트, 원본 캐릭터) --------------------------------
// 격자에 색 칸을 찍고, 같은 줄에서 이어진 같은 색을 rect 하나로 합쳐 SVG 를 만든다. 유형은 소품과 포인트 색만 바꾼다.

export type CatState = 'run' | 'done' | 'fail' | 'idle'
const G = 24
const KIND_COLOR: Record<string, string> = { Explore: '#1FB5AA', Plan: '#8C6CF0', 'general-purpose': '#F0653F', default: '#4C8DE0' }
const FUR = '#F2994A'
const FUR_D = '#C9702A'
const CREAM = '#FFE3BD'
const PINK = '#F29A9A'
const SUIT = '#F4F4F0'
const SHADE = '#CBCBC2'
const FRAME_C = '#A9CBEA'
const GLASS = '#E3F0FB'
const GLASS_F = '#F6FAFD'
const DARK = '#2A2523'
const WHITE = '#FFFFFF'
const RED = '#E5503F'
const BLUE = '#4C8DE0'
const YEL = '#FFD35A'
const ZC = '#8D9CF0'
type Pt = [number, number]
type Deco = ['star', number, number] | ['flag', number] | ['drop', number] | ['zz', number]

const catCache = new Map<string, string>()

export function catSvg(state: CatState, frameNo: number, kind: string): string {
  const f = ((frameNo % 4) + 4) % 4
  const key = `${kind}|${state}|${f}`
  const hit = catCache.get(key)
  if (hit !== undefined) return hit

  const px = new Map<number, string>()
  const put = (x: number, y: number, c: string) => {
    if (x >= 0 && x < G && y >= 0 && y < G) px.set(y * G + x, c)
  }
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) put(x + i, y + j, c)
  }
  const pts = (list: Pt[], c: string, ox = 0, oy = 0) => {
    for (const [x, y] of list) put(x + ox, y + oy, c)
  }

  const ac = KIND_COLOR[kind] ?? KIND_COLOR.default
  let dy = 0
  let dx = 0
  let legs: Pt = [0, 0]
  let tail = 0
  let eye = 'open'
  let mouth = 'w'
  let fog = false
  let arm: Pt = [0, 0]
  let deco: Deco[] = []

  if (state === 'run') {
    dy = [0, -1, 0, -1][f]
    legs = ([[1, 0], [0, 0], [0, 1], [0, 0]] as Pt[])[f]
    tail = [0, 1, 0, -1][f]
    arm = ([[1, -1], [0, 0], [-1, 1], [0, 0]] as Pt[])[f]
    eye = f === 3 ? 'blink' : 'open'
    deco = [['star', 2, 4 + [0, 1, 2, 1][f]], ['star', 21, 18 + [2, 1, 0, 1][f]]]
  } else if (state === 'done') {
    dy = [0, -2, 0, -2][f]
    legs = f === 0 || f === 2 ? [0, 0] : [1, 1]
    tail = [1, -1, 1, -1][f]
    eye = 'happy'
    mouth = 'open'
    arm = [0, -4]
    deco = [['flag', f], ['star', 2, 5 + (f % 2)], ['star', 22, 21]]
  } else if (state === 'fail') {
    dx = [-1, 0, 1, 0][f]
    dy = [0, 0, 1, 0][f]
    legs = ([[0, 1], [1, 1], [1, 0], [1, 1]] as Pt[])[f]
    tail = [1, -1, 1, -1][f]
    eye = 'x'
    mouth = 'wavy'
    fog = true
    arm = ([[-3, 0], [0, -3], [-3, 0], [0, -3]] as Pt[])[f]
    deco = [['drop', f]]
  } else {
    dy = [0, 0, 1, 0][f]
    legs = [1, 1]
    tail = [0, 0, 1, 0][f]
    eye = 'shut'
    mouth = f === 1 || f === 2 ? 'o' : 'w'
    arm = [1, 1]
    deco = [['zz', f]]
  }

  const ox = dx
  const oy = dy
  // 꼬리
  const tp: Pt[] = [[7, 19], [6, 19], [5, 18], [5, 17], [4, 16]]
  tp.forEach(([x, y], i) => put(x + ox, y + oy + (i >= 2 ? tail : 0), FUR))
  put(4 + ox, 16 + oy + tail, FUR_D)
  if (tail > 0) put(3 + ox, 16 + oy + tail, FUR_D)
  // 다리
  ;[8, 13].forEach((x, i) => {
    rect(x + ox, 20 + oy - legs[i], 3, 2, SUIT)
    rect(x + ox, 22 + oy - legs[i], 3, 1, ac)
  })
  // 몸
  rect(8 + ox, 16 + oy, 8, 4, SUIT)
  rect(8 + ox, 19 + oy, 8, 1, SHADE)
  put(10 + ox, 17 + oy, RED)
  put(13 + ox, 17 + oy, BLUE)
  if (kind === 'general-purpose') pts([[11, 17], [12, 17], [11, 18], [12, 16]], YEL, ox, oy)
  // 팔
  const ly = 17 + oy + arm[0]
  const ry = 17 + oy + arm[1]
  rect(6 + ox, ly, 2, 2, SUIT)
  put(6 + ox, ly + 1, ac)
  rect(16 + ox, ry, 2, 2, SUIT)
  put(17 + ox, ry + 1, ac)
  if (state !== 'done') {
    if (kind === 'Explore') {
      pts([[18, 16], [19, 15], [20, 14], [21, 13]], ac, ox, oy)
      pts([[21, 12], [22, 12], [22, 13]], SHADE, ox, oy)
    } else if (kind === 'Plan') {
      rect(18 + ox, 15 + oy, 3, 5, WHITE)
      rect(18 + ox, 15 + oy, 3, 1, ac)
      pts([[19, 17], [20, 17], [19, 18]], ac, ox, oy)
    }
  }
  // 목 고리
  rect(6 + ox, 15 + oy, 12, 1, ac)
  // 안테나(그 밖의 유형)
  if (kind !== 'Explore' && kind !== 'Plan' && kind !== 'general-purpose') {
    pts([[11, 2], [12, 2]], SHADE, ox, oy)
    pts([[11, 1], [12, 1]], RED, ox, oy)
  }
  // 헬멧 바탕
  const glass = fog ? GLASS_F : GLASS
  for (let y = 3; y < 15; y += 1) {
    const inset = y === 3 || y === 14 ? 2 : y === 4 || y === 13 ? 1 : 0
    rect(4 + inset + ox, y + oy, 16 - 2 * inset, 1, glass)
  }
  // 귀
  pts([[6, 4], [5, 5], [6, 5], [7, 5], [17, 4], [16, 5], [17, 5], [18, 5]], FUR, ox, oy)
  pts([[6, 5], [17, 5]], PINK, ox, oy)
  // 얼굴
  for (let y = 5; y < 14; y += 1) {
    const inset = y === 5 || y === 13 ? 1 : 0
    rect(5 + inset + ox, y + oy, 14 - 2 * inset, 1, FUR)
  }
  pts([[10, 5], [12, 5], [14, 5], [10, 6], [14, 6]], FUR_D, ox, oy)
  rect(9 + ox, 11 + oy, 6, 3, CREAM)
  pts([[6, 11], [17, 11], [6, 12], [17, 12]], PINK, ox, oy)
  // 눈
  if (eye === 'open') {
    rect(8 + ox, 8 + oy, 2, 3, DARK)
    rect(14 + ox, 8 + oy, 2, 3, DARK)
    put(8 + ox, 8 + oy, WHITE)
    put(14 + ox, 8 + oy, WHITE)
  } else if (eye === 'blink') {
    rect(8 + ox, 10 + oy, 3, 1, DARK)
    rect(14 + ox, 10 + oy, 3, 1, DARK)
  } else if (eye === 'happy') {
    pts([[8, 10], [9, 9], [10, 10], [14, 10], [15, 9], [16, 10]], DARK, ox, oy)
  } else if (eye === 'shut') {
    pts([[8, 9], [9, 10], [10, 9], [14, 9], [15, 10], [16, 9]], DARK, ox, oy)
  } else if (eye === 'x') {
    pts([[8, 8], [10, 8], [9, 9], [8, 10], [10, 10], [14, 8], [16, 8], [15, 9], [14, 10], [16, 10]], DARK, ox, oy)
  }
  // 코·입
  pts([[11, 11], [12, 11]], PINK, ox, oy)
  if (mouth === 'w') pts([[10, 12], [11, 13], [12, 13], [13, 12]], DARK, ox, oy)
  else if (mouth === 'open') {
    rect(10 + ox, 12 + oy, 4, 2, DARK)
    pts([[11, 13], [12, 13]], PINK, ox, oy)
  } else if (mouth === 'wavy') pts([[10, 13], [11, 12], [12, 13], [13, 12]], DARK, ox, oy)
  else if (mouth === 'o') rect(11 + ox, 12 + oy, 2, 2, DARK)
  // 헬멧 테두리
  for (let y = 3; y < 15; y += 1) {
    const inset = y === 3 || y === 14 ? 2 : y === 4 || y === 13 ? 1 : 0
    const xl = 4 + inset
    const xr = 19 - inset
    if (y === 3 || y === 14) rect(xl + ox, y + oy, xr - xl + 1, 1, FRAME_C)
    else {
      put(xl + ox, y + oy, FRAME_C)
      put(xr + ox, y + oy, FRAME_C)
    }
  }
  if (fog) pts([[14, 4], [14, 5], [13, 6], [13, 7]], DARK, ox, oy)
  // 하이라이트
  pts([[5, 6], [5, 7], [6, 5]], WHITE, ox, oy)
  // 몸 밖 장식
  for (const d of deco) {
    if (d[0] === 'star') {
      const [, x, y] = d
      pts([[x, y - 1], [x - 1, y], [x, y], [x + 1, y], [x, y + 1]], YEL)
    } else if (d[0] === 'flag') {
      rect(21, 4 + oy, 1, 13, DARK)
      const wv = [0, 1, 0, -1][d[1]]
      rect(22, 4 + oy, 2, 3, RED)
      if (wv === 1) put(23, 7 + oy, RED)
      else if (wv === -1) put(23, 3 + oy, RED)
    } else if (d[0] === 'drop') {
      pts([[20, 5], [20, 6]], '#7CC4FF')
    } else {
      const z = (x: number, y: number, s: number) => {
        rect(x, y, s, 1, ZC)
        rect(x, y + s - 1, s, 1, ZC)
        for (let k = 0; k < s - 2; k += 1) put(x + s - 2 - k, y + 1 + k, ZC)
      }
      if (d[1] === 1) z(19, 5, 3)
      else if (d[1] === 2) {
        z(19, 4, 4)
        z(22, 1, 2)
      } else if (d[1] === 3) {
        z(20, 3, 4)
        z(22, 0, 2)
      }
    }
  }

  // 같은 줄에서 이어진 같은 색을 rect 하나로 합친다.
  let rects = ''
  for (let y = 0; y < G; y += 1) {
    let x = 0
    while (x < G) {
      const c = px.get(y * G + x)
      if (c === undefined) {
        x += 1
        continue
      }
      let x2 = x
      while (x2 + 1 < G && px.get(y * G + x2 + 1) === c) x2 += 1
      rects += `<rect x="${x}" y="${y}" width="${x2 - x + 1}" height="1" fill="${c}"/>`
      x = x2 + 1
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G} ${G}" shape-rendering="crispEdges">${rects}</svg>`
  catCache.set(key, svg)
  return svg
}

/** 에이전트 상태를 고양이 상태로 옮긴다. 대기·중단 같은 그 밖의 상태도 빠짐없이 받는다. */
export function catState(status: string): CatState {
  return isLive(status) ? 'run' : status === 'completed' ? 'done' : status === 'failed' || status === 'killed' ? 'fail' : 'idle'
}

/** 고양이를 움직이는 타이머를 건다. 세션 보드의 session.start 가 부른다(한 모듈은 같은 이벤트를 조건 없이 두 번 걸 수 없다). */
export function startAgentTicker($: any) {
  ticker?.cancel()
  ticker = $.clock.every(FRAME_MS, () => step($))
}

/** 하위 에이전트의 도구 호출만 센다. 호출은 막지도 바꾸지도 않는다. 세션 보드의 tool.call 이 부른다. */
export function countAgentCall(e: any) {
  const id = e.agentId as string | undefined
  const a = id ? agents.get(id) : undefined
  // 하위 에이전트가 결과를 돌려주는 내부 호출은 작업으로 세지 않는다.
  if (a && e.tool !== 'SubagentHandback') {
    a.calls += 1
    a.lastTool = String(e.tool ?? '-')
  }
}

export const register: Register = on => {
  on('agent.spawn', async ($, e, next) => {
    const result: any = await next(e)
    if (result?.agentId) {
      agents.set(result.agentId, {
        id: result.agentId,
        name: String((e as any).description ?? '') || result.agentId,
        type: String((e as any).subagentType ?? ''),
        status: 'running',
        startedAt: await $.clock.now(),
        endedAt: null,
        calls: 0,
        lastTool: '-',
      })
      // 첫 하위 에이전트가 시작하면 세션 보드 패널을 한 번 연다. 이미 열려 있으면 그대로다
      if (!autoOpened) {
        autoOpened = true
        await $.ui.open({ id: PANE_ID, title: '세션' })
      }
      $.ui.invalidate('ui.render')
    }
    await bandTick($) // 띠의 "하위 N" 도 다시 센다 (한 모듈은 agent.spawn 을 조건 없이 두 번 걸 수 없다)
    return result
  })

  // 세션 보드(아래 모듈)를 먼저 그리고 그 아래에 하위 에이전트 묶음을 붙인다. 에이전트가 없으면 세션 보드만이다
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const board: any = await next(e)
    const all = [...agents.values()]
    if (all.length === 0) return board
    const t = $.ui.resolve(e) as any
    const { Box, Text } = t
    const now = Date.now()
    const anyLive = all.some(a => isLive(a.status))
    // 실행 중을 위에, 그 안에서는 늦게 시작한 것부터. 끝난 것은 늦게 끝난 것부터
    const ordered = [...all.filter(a => isLive(a.status)).sort((a, b) => b.startedAt - a.startedAt), ...all.filter(a => !isLive(a.status)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))]
    const section = Box({
      key: 'agents',
      flexDirection: 'column',
      gap: 'xs',
      children: [
        Text({ key: 'h', dimColor: true, size: 'caption', weight: 'semibold', children: `하위 에이전트 ${all.length} · 호출 ${all.reduce((n, a) => n + a.calls, 0)}회` }),
        ...ordered.map(a => agentSlot(t, a, now, anyLive)),
      ],
    })
    return Box({ flexDirection: 'column', gap: 'md', children: [Box({ key: 'board', flexDirection: 'column', children: [board] }), section] })
  })
}

/**
 * 에이전트 하나의 칸(결재함 틀, 세션 보드 칸과 같은 모양): 고양이 | 머리글(● 상태 · 시간) 위, 이름 가운데, 유형·호출 아래.
 * 색은 테마의 뜻 색이다. Svg 가 없는 화면(터미널)은 고양이 대신 글자 얼굴을 머리글 앞에 둔다.
 */
function agentSlot(t: any, a: A, now: number, animate: boolean) {
  const { Box, Text, Svg } = t
  const time = fmtDur((a.endedAt ?? now) - a.startedAt)
  const set = FRAMES[a.type] ?? DEFAULT_FRAMES
  const face = Svg ? '●' : isLive(a.status) ? set[Math.floor(frame / 2) % set.length] : a.status === 'completed' ? '✓' : a.status === 'failed' ? '✗' : '·'
  const text = Box({
    key: 'text',
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    children: [
      Box({
        key: 'head',
        flexDirection: 'row',
        gap: 'sm',
        children: [
          Text({ key: 'st', color: COLOR[a.status], size: 'caption', weight: 'semibold', children: `${face} ${LABEL[a.status] ?? a.status}` }),
          Text({ key: 'tm', size: 'caption', dimColor: true, children: time }),
        ],
      }),
      // 실패한 에이전트는 이름도 오류 색으로 쓴다
      Text({ key: 'nm', color: a.status === 'failed' ? 'error' : undefined, wrap: 'truncate-end', children: a.name }),
      Text({ key: 'sub', size: 'caption', dimColor: true, wrap: 'truncate-end', children: `${a.type || '-'} · ${a.calls === 0 ? '호출 없음' : `호출 ${a.calls}회 · ${a.lastTool}`}` }),
    ],
  })
  const st = catState(a.status)
  // 움직임은 실행 중인 에이전트가 있을 때만 갱신된다. 아무도 일하지 않으면 정해진 한 프레임으로 멈춘다. 대기는 절반 속도.
  const f = animate ? (st === 'idle' ? Math.floor(frame / 2) : frame) : 1
  const kind = FRAMES[a.type] ? a.type : 'default'
  const cat = Svg ? Box({ key: 'cat', flexShrink: 0, children: [Svg({ source: catSvg(st, f, kind), alt: `우주비행사 고양이 (${LABEL[a.status] ?? a.status})`, width: CAT_PX, height: CAT_PX })] }) : null
  return Box({
    key: a.id,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'sm',
    borderStyle: 'single',
    borderColor: 'subtle',
    borderDimColor: true,
    paddingX: 'md',
    paddingY: 'sm',
    children: [cat, text],
  })
}

// 한 프레임: 캐릭터를 한 칸 넘기고, 가끔 목록을 읽어 상태를 맞춘다.
async function step($: any) {
  frame += 1
  const anyLive = [...agents.values()].some(a => isLive(a.status))
  if (frame % LIST_EVERY === 0) await syncList($)
  if (anyLive || frame % LIST_EVERY === 0) $.ui.invalidate('ui.render')
}

async function syncList($: any) {
  try {
    const list: any[] = await $.agent.list()
    const now = await $.clock.now()
    for (const info of list) {
      let a = agents.get(info.id)
      if (!a) {
        a = { id: info.id, name: info.description || info.id, type: info.type ?? '', status: info.status, startedAt: now, endedAt: null, calls: 0, lastTool: '-' }
        agents.set(info.id, a)
      }
      a.status = info.status
      if (!isLive(a.status) && a.endedAt === null) a.endedAt = now
    }
    const finished = [...agents.values()].filter(a => a.endedAt !== null).sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0))
    for (const old of finished.slice(KEEP)) agents.delete(old.id)
  } catch {
    // 목록을 못 읽으면 이전 값을 둔다
  }
}
