// session-board 의 그림: 색, 고양이 아바타, 상태바, 머리글 SVG. 입출력이 없는 순수 함수만 둔다.

import { OLD_ASK_MS, deadLabel, isDead, openAsk, openReport } from './asks'
import type { Group } from './asks'
import type { Rec } from './register'

// 색은 my-own-mods 의 다른 모드와 같다. 앱 테마는 읽을 수 없어 고정 색을 쓴다.
const C = { ink: '#14172B', dim: '#5B6080', line: '#E3E6F2', soft: '#EEF0F8', white: '#FFFFFF', indigo: '#4F6BFF', amber: '#FBBF24' }

export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}초`
  if (s < 3600) return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`
  return `${Math.floor(s / 3600)}시간 ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}분`
}

export const KIND_LABEL = { request: '결재', notice: '알림' } as const

export function barSvg(done: number, total: number, color: string, w = 160): string {
  const fill = total > 0 ? Math.round((w * Math.min(done, total)) / total) : 0
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 6"><rect width="${w}" height="6" rx="3" fill="${C.line}"/>${fill > 0 ? `<rect width="${fill}" height="6" rx="3" fill="${color}"/>` : ''}</svg>`
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

type Mood = Exclude<Group, 'hidden'>
type Skin = { tint: string; edge: string; bubble: string; pill: string; text: string; bead: string; cat: 'run' | 'flag' | 'zz'; alt: string }
// 묶음마다 파스텔 한 벌: 카드 바탕·테두리, 아바타 동그라미, 알약, 구슬 색. 결재는 빨강, 알림은 호박색, 확인은 초록 (결재함의 색 규칙)
const SKIN: Record<Mood, Skin> = {
  running: { tint: '#F5F7FF', edge: '#D6DDFF', bubble: '#E4E9FF', pill: '#E4E9FF', text: P.indigoText, bead: C.indigo, cat: 'run', alt: '달리는' },
  request: { tint: '#FFF1F2', edge: '#FECDD3', bubble: '#FFE4E8', pill: '#FFE4E8', text: '#BE123C', bead: '#F43F5E', cat: 'flag', alt: '깃발 든' },
  notice: { tint: '#FFFBEB', edge: '#F6D58A', bubble: '#FEF3C7', pill: '#FEF3C7', text: P.amberText, bead: C.amber, cat: 'flag', alt: '깃발 든' },
  report: { tint: '#ECFDF5', edge: '#A7F3D0', bubble: '#DEF5ED', pill: '#DEF5ED', text: '#047857', bead: '#10B981', cat: 'flag', alt: '깃발 든' },
  idle: { tint: '#FAFAFD', edge: '#E3E6F2', bubble: '#EEF0F8', pill: '#EEF0F8', text: C.dim, bead: P.mute, cat: 'zz', alt: '조는' },
}
// 24x24 도트 고양이(agent-panel 에서 옮김). 같은 색 칸을 path 하나로 합쳐 줄였다.
const CAT = {
  run: '<symbol id="run" viewBox="0 0 24 24" shape-rendering="crispEdges"><path fill="#E5503F" d="M11 0h2v1h-2zM10 16h1v1h-1z"/><path fill="#CBCBC2" d="M11 1h2v1h-2zM8 18h8v1h-8z"/><path fill="#A9CBEA" d="M6 2h12v1h-12zM5 3h1v1h-1zM18 3h1v1h-1zM4 4h1v1h-1zM19 4h1v1h-1zM4 5h1v1h-1zM19 5h1v1h-1zM4 6h1v1h-1zM19 6h1v1h-1zM4 7h1v1h-1zM19 7h1v1h-1zM4 8h1v1h-1zM19 8h1v1h-1zM4 9h1v1h-1zM19 9h1v1h-1zM4 10h1v1h-1zM19 10h1v1h-1zM4 11h1v1h-1zM19 11h1v1h-1zM5 12h1v1h-1zM18 12h1v1h-1zM6 13h12v1h-12z"/><path fill="#F2994A" d="M6 3h1v1h-1zM17 3h1v1h-1zM5 4h1v1h-1zM7 4h3v1h-3zM11 4h1v1h-1zM13 4h1v1h-1zM15 4h4v1h-4zM6 5h4v1h-4zM11 5h3v1h-3zM15 5h4v1h-4zM6 6h13v1h-13zM5 7h3v1h-3zM10 7h4v1h-4zM16 7h3v1h-3zM5 8h3v1h-3zM10 8h4v1h-4zM16 8h3v1h-3zM5 9h3v1h-3zM10 9h4v1h-4zM16 9h3v1h-3zM5 10h1v1h-1zM7 10h2v1h-2zM15 10h2v1h-2zM18 10h1v1h-1zM5 11h1v1h-1zM7 11h2v1h-2zM15 11h2v1h-2zM18 11h1v1h-1zM6 12h3v1h-3zM15 12h3v1h-3zM5 17h1v1h-1zM5 18h3v1h-3z"/><path fill="#E3F0FB" d="M7 3h10v1h-10z"/><path fill="#FFD35A" d="M2 4h1v1h-1zM1 5h3v1h-3zM2 6h1v1h-1zM21 18h1v1h-1zM20 19h3v1h-3zM21 20h1v1h-1z"/><path fill="#FFFFFF" d="M6 4h1v1h-1zM5 5h1v1h-1zM5 6h1v1h-1zM8 7h1v1h-1zM14 7h1v1h-1z"/><path fill="#C9702A" d="M10 4h1v1h-1zM12 4h1v1h-1zM14 4h1v1h-1zM10 5h1v1h-1zM14 5h1v1h-1zM3 16h2v1h-2z"/><path fill="#2A2523" d="M9 7h1v1h-1zM15 7h1v1h-1zM8 8h2v1h-2zM14 8h2v1h-2zM8 9h2v1h-2zM14 9h2v1h-2zM10 11h1v1h-1zM13 11h1v1h-1zM11 12h2v1h-2z"/><path fill="#F29A9A" d="M6 10h1v1h-1zM11 10h2v1h-2zM17 10h1v1h-1zM6 11h1v1h-1zM17 11h1v1h-1z"/><path fill="#FFE3BD" d="M9 10h2v1h-2zM13 10h2v1h-2zM9 11h1v1h-1zM11 11h2v1h-2zM14 11h1v1h-1zM9 12h2v1h-2zM13 12h2v1h-2z"/><path fill="#4C8DE0" d="M6 14h12v1h-12zM13 16h1v1h-1zM6 17h1v1h-1zM17 17h1v1h-1zM8 21h3v1h-3zM13 21h3v1h-3z"/><path fill="#F4F4F0" d="M8 15h8v1h-8zM6 16h4v1h-4zM11 16h2v1h-2zM14 16h4v1h-4zM7 17h10v1h-10zM8 19h3v1h-3zM13 19h3v1h-3zM8 20h3v1h-3zM13 20h3v1h-3z"/></symbol>',
  flag: '<symbol id="flag" viewBox="0 0 24 24" shape-rendering="crispEdges"><path fill="#CBCBC2" d="M11 0h2v1h-2zM8 17h8v1h-8z"/><path fill="#A9CBEA" d="M6 1h12v1h-12zM5 2h1v1h-1zM18 2h1v1h-1zM4 3h1v1h-1zM19 3h1v1h-1zM4 4h1v1h-1zM19 4h1v1h-1zM4 5h1v1h-1zM19 5h1v1h-1zM4 6h1v1h-1zM19 6h1v1h-1zM4 7h1v1h-1zM19 7h1v1h-1zM4 8h1v1h-1zM19 8h1v1h-1zM4 9h1v1h-1zM19 9h1v1h-1zM4 10h1v1h-1zM19 10h1v1h-1zM5 11h1v1h-1zM18 11h1v1h-1zM6 12h12v1h-12z"/><path fill="#F2994A" d="M6 2h1v1h-1zM17 2h1v1h-1zM5 3h1v1h-1zM7 3h3v1h-3zM11 3h1v1h-1zM13 3h1v1h-1zM15 3h4v1h-4zM6 4h4v1h-4zM11 4h3v1h-3zM15 4h4v1h-4zM6 5h13v1h-13zM5 6h14v1h-14zM5 7h4v1h-4zM10 7h5v1h-5zM16 7h3v1h-3zM5 8h3v1h-3zM9 8h1v1h-1zM11 8h3v1h-3zM15 8h1v1h-1zM17 8h2v1h-2zM5 9h1v1h-1zM7 9h2v1h-2zM15 9h2v1h-2zM18 9h1v1h-1zM5 10h1v1h-1zM7 10h2v1h-2zM15 10h2v1h-2zM18 10h1v1h-1zM6 11h3v1h-3zM15 11h3v1h-3zM5 14h1v1h-1zM5 15h1v1h-1zM6 17h2v1h-2z"/><path fill="#E3F0FB" d="M7 2h10v1h-10z"/><path fill="#2A2523" d="M21 2h1v1h-1zM21 3h1v1h-1zM21 4h1v1h-1zM21 5h1v1h-1zM21 6h1v1h-1zM9 7h1v1h-1zM15 7h1v1h-1zM21 7h1v1h-1zM8 8h1v1h-1zM10 8h1v1h-1zM14 8h1v1h-1zM16 8h1v1h-1zM21 8h1v1h-1zM21 9h1v1h-1zM10 10h4v1h-4zM21 10h1v1h-1zM10 11h1v1h-1zM13 11h1v1h-1zM21 11h1v1h-1zM21 12h1v1h-1zM21 13h1v1h-1zM21 14h1v1h-1z"/><path fill="#E5503F" d="M22 2h2v1h-2zM22 3h2v1h-2zM22 4h2v1h-2zM23 5h1v1h-1zM10 15h1v1h-1z"/><path fill="#FFFFFF" d="M6 3h1v1h-1zM5 4h1v1h-1zM5 5h1v1h-1z"/><path fill="#C9702A" d="M10 3h1v1h-1zM12 3h1v1h-1zM14 3h1v1h-1zM10 4h1v1h-1zM14 4h1v1h-1zM4 13h1v1h-1z"/><path fill="#FFD35A" d="M2 5h1v1h-1zM1 6h3v1h-3zM2 7h1v1h-1zM22 20h1v1h-1zM21 21h3v1h-3zM22 22h1v1h-1z"/><path fill="#F29A9A" d="M6 9h1v1h-1zM11 9h2v1h-2zM17 9h1v1h-1zM6 10h1v1h-1zM17 10h1v1h-1zM11 11h2v1h-2z"/><path fill="#FFE3BD" d="M9 9h2v1h-2zM13 9h2v1h-2zM9 10h1v1h-1zM14 10h1v1h-1zM9 11h1v1h-1zM14 11h1v1h-1z"/><path fill="#4C8DE0" d="M6 13h12v1h-12zM13 15h1v1h-1zM6 16h1v1h-1zM8 19h3v1h-3zM13 19h3v1h-3z"/><path fill="#F4F4F0" d="M8 14h8v1h-8zM6 15h4v1h-4zM11 15h2v1h-2zM14 15h2v1h-2zM7 16h9v1h-9zM8 18h3v1h-3zM13 18h3v1h-3z"/></symbol>',
  zz: '<symbol id="zz" viewBox="0 0 24 24" shape-rendering="crispEdges"><path fill="#E5503F" d="M11 1h2v1h-2zM10 17h1v1h-1z"/><path fill="#CBCBC2" d="M11 2h2v1h-2zM8 19h8v1h-8z"/><path fill="#A9CBEA" d="M6 3h12v1h-12zM5 4h1v1h-1zM18 4h1v1h-1zM4 5h1v1h-1zM4 6h1v1h-1zM19 6h1v1h-1zM4 7h1v1h-1zM4 8h1v1h-1zM19 8h1v1h-1zM4 9h1v1h-1zM19 9h1v1h-1zM4 10h1v1h-1zM19 10h1v1h-1zM4 11h1v1h-1zM19 11h1v1h-1zM4 12h1v1h-1zM19 12h1v1h-1zM5 13h1v1h-1zM18 13h1v1h-1zM6 14h12v1h-12z"/><path fill="#F2994A" d="M6 4h1v1h-1zM17 4h1v1h-1zM5 5h1v1h-1zM7 5h3v1h-3zM11 5h1v1h-1zM13 5h1v1h-1zM15 5h4v1h-4zM6 6h4v1h-4zM11 6h3v1h-3zM15 6h4v1h-4zM6 7h13v1h-13zM5 8h14v1h-14zM5 9h3v1h-3zM9 9h1v1h-1zM11 9h3v1h-3zM15 9h1v1h-1zM17 9h2v1h-2zM5 10h4v1h-4zM10 10h5v1h-5zM16 10h3v1h-3zM5 11h1v1h-1zM7 11h2v1h-2zM15 11h2v1h-2zM18 11h1v1h-1zM5 12h1v1h-1zM7 12h2v1h-2zM15 12h2v1h-2zM18 12h1v1h-1zM6 13h3v1h-3zM15 13h3v1h-3zM5 17h1v1h-1zM5 18h1v1h-1z"/><path fill="#E3F0FB" d="M7 4h10v1h-10z"/><path fill="#FFFFFF" d="M6 5h1v1h-1zM5 6h1v1h-1zM5 7h1v1h-1z"/><path fill="#C9702A" d="M10 5h1v1h-1zM12 5h1v1h-1zM14 5h1v1h-1zM10 6h1v1h-1zM14 6h1v1h-1zM4 16h1v1h-1z"/><path fill="#8D9CF0" d="M19 5h3v1h-3zM20 6h1v1h-1zM19 7h3v1h-3z"/><path fill="#2A2523" d="M8 9h1v1h-1zM10 9h1v1h-1zM14 9h1v1h-1zM16 9h1v1h-1zM9 10h1v1h-1zM15 10h1v1h-1zM11 12h2v1h-2zM11 13h2v1h-2z"/><path fill="#F29A9A" d="M6 11h1v1h-1zM11 11h2v1h-2zM17 11h1v1h-1zM6 12h1v1h-1zM17 12h1v1h-1z"/><path fill="#FFE3BD" d="M9 11h2v1h-2zM13 11h2v1h-2zM9 12h2v1h-2zM13 12h2v1h-2zM9 13h2v1h-2zM13 13h2v1h-2z"/><path fill="#4C8DE0" d="M6 15h12v1h-12zM13 17h1v1h-1zM6 19h1v1h-1zM17 19h1v1h-1zM8 21h3v1h-3zM13 21h3v1h-3z"/><path fill="#F4F4F0" d="M8 16h8v1h-8zM8 17h2v1h-2zM11 17h2v1h-2zM14 17h2v1h-2zM6 18h12v1h-12zM7 19h1v1h-1zM16 19h1v1h-1zM8 20h3v1h-3zM13 20h3v1h-3z"/></symbol>',
}


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
  const ask = openAsk(r)
  const report = openReport(r)
  const since = (at: number): Run => ({ t: ` ${fmtDur(now - at)}`, fill: C.dim })
  const label: Run[] = isDead(r, now)
    ? [{ t: deadLabel(r), fill: C.dim, weight: 700 }, ...(ask || report ? [since((ask ?? report)!.at)] : [])]
    : g === 'request' || g === 'notice'
      ? r.state === 'waiting'
        ? [{ t: `${r.waitFor ?? '응답'} 대기`, fill: s.text, weight: 700 }, since(r.since)]
        : [{ t: `${KIND_LABEL[g]}${ask && now - ask.at > OLD_ASK_MS ? ' 낡음' : ''}`, fill: s.text, weight: 700 }, since(ask?.at ?? r.since)]
      : g === 'report'
        ? [{ t: '확인', fill: s.text, weight: 700 }, since(report?.at ?? r.since)]
        : g === 'running'
          ? [{ t: '작업 중', fill: s.text, weight: 700 }, ...(r.turnStartedAt !== null ? [{ t: ` ${fmtDur(now - r.turnStartedAt)}`, fill: C.dim }] : [])]
          : [{ t: '쉬는 중', fill: C.dim, weight: 700 }, since(r.since)]
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

const mePlace = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 15"></svg>'
/** 줄 사이 구분선. 폭을 안 주면 이미지가 패널 폭에 맞춰져 상자 끝까지 닿는다(높이는 비율대로 약 6px 이하라 선은 가늘다). */
const hairline = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 8"><rect y="3.5" width="600" height="1" fill="${C.line}"/></svg>`

export { BW, C, SH, SKIN, SW, clip, hairline, headSvg, mePill, mePlace }
export type { Mood }
