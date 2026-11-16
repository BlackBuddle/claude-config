// session-board 의 그림과 머리글: 색, 고양이 아바타, 칸 머리글. 입출력이 없는 순수 함수만 둔다.

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

// 고양이는 agent-panel 의 캐릭터에서 상태 셋(달리는 / 깃발 든 / 조는)만 작은 조각으로 옮겨 왔다.
const P = { indigoText: '#3F5BEF', amberText: '#92400E', mute: '#B6BACF' }
// 그림 글자의 폭(px) 어림. 띠(band.ts)도 이것을 쓴다
export const isWide = (ch: string) => /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch)
export const tw = (s: string, size: number, mono = false, bold = false) => [...s].reduce((n, ch) => n + (isWide(ch) ? size : size * (mono ? 0.6 : 0.56)) * (bold && !mono ? 1.05 : 1), 0)
/** 폭을 넘으면 끝을 줄이고 …을 붙인다. */
function clip(s: string, max: number, size: number): string {
  if (tw(s, size) <= max) return s
  let o = s
  while (o.length > 1 && tw(`${o}…`, size) > max) o = o.slice(0, -1)
  return `${o}…`
}

type Mood = Exclude<Group, 'hidden'>
type Skin = { bubble: string; text: string; bead: string; cat: 'run' | 'flag' | 'zz'; alt: string }
// 묶음마다 파스텔 한 벌: 카드 바탕·테두리, 아바타 동그라미, 알약, 구슬 색. 결재는 빨강, 알림은 호박색, 확인은 초록 (결재함의 색 규칙)
const SKIN: Record<Mood, Skin> = {
  running: { bubble: '#E4E9FF', text: P.indigoText, bead: C.indigo, cat: 'run', alt: '달리는' },
  request: { bubble: '#FFE4E8', text: '#BE123C', bead: '#F43F5E', cat: 'flag', alt: '깃발 든' },
  notice: { bubble: '#FEF3C7', text: P.amberText, bead: C.amber, cat: 'flag', alt: '깃발 든' },
  report: { bubble: '#DEF5ED', text: '#047857', bead: '#10B981', cat: 'flag', alt: '깃발 든' },
  idle: { bubble: '#EEF0F8', text: C.dim, bead: P.mute, cat: 'zz', alt: '조는' },
}
// 24x24 도트 고양이(agent-panel 에서 옮김). 같은 색 칸을 path 하나로 합쳐 줄였다.
export const CAT = {
  run: '<symbol id="run" viewBox="0 0 24 24" shape-rendering="crispEdges"><path fill="#E5503F" d="M11 0h2v1h-2zM10 16h1v1h-1z"/><path fill="#CBCBC2" d="M11 1h2v1h-2zM8 18h8v1h-8z"/><path fill="#A9CBEA" d="M6 2h12v1h-12zM5 3h1v1h-1zM18 3h1v1h-1zM4 4h1v1h-1zM19 4h1v1h-1zM4 5h1v1h-1zM19 5h1v1h-1zM4 6h1v1h-1zM19 6h1v1h-1zM4 7h1v1h-1zM19 7h1v1h-1zM4 8h1v1h-1zM19 8h1v1h-1zM4 9h1v1h-1zM19 9h1v1h-1zM4 10h1v1h-1zM19 10h1v1h-1zM4 11h1v1h-1zM19 11h1v1h-1zM5 12h1v1h-1zM18 12h1v1h-1zM6 13h12v1h-12z"/><path fill="#F2994A" d="M6 3h1v1h-1zM17 3h1v1h-1zM5 4h1v1h-1zM7 4h3v1h-3zM11 4h1v1h-1zM13 4h1v1h-1zM15 4h4v1h-4zM6 5h4v1h-4zM11 5h3v1h-3zM15 5h4v1h-4zM6 6h13v1h-13zM5 7h3v1h-3zM10 7h4v1h-4zM16 7h3v1h-3zM5 8h3v1h-3zM10 8h4v1h-4zM16 8h3v1h-3zM5 9h3v1h-3zM10 9h4v1h-4zM16 9h3v1h-3zM5 10h1v1h-1zM7 10h2v1h-2zM15 10h2v1h-2zM18 10h1v1h-1zM5 11h1v1h-1zM7 11h2v1h-2zM15 11h2v1h-2zM18 11h1v1h-1zM6 12h3v1h-3zM15 12h3v1h-3zM5 17h1v1h-1zM5 18h3v1h-3z"/><path fill="#E3F0FB" d="M7 3h10v1h-10z"/><path fill="#FFD35A" d="M2 4h1v1h-1zM1 5h3v1h-3zM2 6h1v1h-1zM21 18h1v1h-1zM20 19h3v1h-3zM21 20h1v1h-1z"/><path fill="#FFFFFF" d="M6 4h1v1h-1zM5 5h1v1h-1zM5 6h1v1h-1zM8 7h1v1h-1zM14 7h1v1h-1z"/><path fill="#C9702A" d="M10 4h1v1h-1zM12 4h1v1h-1zM14 4h1v1h-1zM10 5h1v1h-1zM14 5h1v1h-1zM3 16h2v1h-2z"/><path fill="#2A2523" d="M9 7h1v1h-1zM15 7h1v1h-1zM8 8h2v1h-2zM14 8h2v1h-2zM8 9h2v1h-2zM14 9h2v1h-2zM10 11h1v1h-1zM13 11h1v1h-1zM11 12h2v1h-2z"/><path fill="#F29A9A" d="M6 10h1v1h-1zM11 10h2v1h-2zM17 10h1v1h-1zM6 11h1v1h-1zM17 11h1v1h-1z"/><path fill="#FFE3BD" d="M9 10h2v1h-2zM13 10h2v1h-2zM9 11h1v1h-1zM11 11h2v1h-2zM14 11h1v1h-1zM9 12h2v1h-2zM13 12h2v1h-2z"/><path fill="#4C8DE0" d="M6 14h12v1h-12zM13 16h1v1h-1zM6 17h1v1h-1zM17 17h1v1h-1zM8 21h3v1h-3zM13 21h3v1h-3z"/><path fill="#F4F4F0" d="M8 15h8v1h-8zM6 16h4v1h-4zM11 16h2v1h-2zM14 16h4v1h-4zM7 17h10v1h-10zM8 19h3v1h-3zM13 19h3v1h-3zM8 20h3v1h-3zM13 20h3v1h-3z"/></symbol>',
  flag: '<symbol id="flag" viewBox="0 0 24 24" shape-rendering="crispEdges"><path fill="#CBCBC2" d="M11 0h2v1h-2zM8 17h8v1h-8z"/><path fill="#A9CBEA" d="M6 1h12v1h-12zM5 2h1v1h-1zM18 2h1v1h-1zM4 3h1v1h-1zM19 3h1v1h-1zM4 4h1v1h-1zM19 4h1v1h-1zM4 5h1v1h-1zM19 5h1v1h-1zM4 6h1v1h-1zM19 6h1v1h-1zM4 7h1v1h-1zM19 7h1v1h-1zM4 8h1v1h-1zM19 8h1v1h-1zM4 9h1v1h-1zM19 9h1v1h-1zM4 10h1v1h-1zM19 10h1v1h-1zM5 11h1v1h-1zM18 11h1v1h-1zM6 12h12v1h-12z"/><path fill="#F2994A" d="M6 2h1v1h-1zM17 2h1v1h-1zM5 3h1v1h-1zM7 3h3v1h-3zM11 3h1v1h-1zM13 3h1v1h-1zM15 3h4v1h-4zM6 4h4v1h-4zM11 4h3v1h-3zM15 4h4v1h-4zM6 5h13v1h-13zM5 6h14v1h-14zM5 7h4v1h-4zM10 7h5v1h-5zM16 7h3v1h-3zM5 8h3v1h-3zM9 8h1v1h-1zM11 8h3v1h-3zM15 8h1v1h-1zM17 8h2v1h-2zM5 9h1v1h-1zM7 9h2v1h-2zM15 9h2v1h-2zM18 9h1v1h-1zM5 10h1v1h-1zM7 10h2v1h-2zM15 10h2v1h-2zM18 10h1v1h-1zM6 11h3v1h-3zM15 11h3v1h-3zM5 14h1v1h-1zM5 15h1v1h-1zM6 17h2v1h-2z"/><path fill="#E3F0FB" d="M7 2h10v1h-10z"/><path fill="#2A2523" d="M21 2h1v1h-1zM21 3h1v1h-1zM21 4h1v1h-1zM21 5h1v1h-1zM21 6h1v1h-1zM9 7h1v1h-1zM15 7h1v1h-1zM21 7h1v1h-1zM8 8h1v1h-1zM10 8h1v1h-1zM14 8h1v1h-1zM16 8h1v1h-1zM21 8h1v1h-1zM21 9h1v1h-1zM10 10h4v1h-4zM21 10h1v1h-1zM10 11h1v1h-1zM13 11h1v1h-1zM21 11h1v1h-1zM21 12h1v1h-1zM21 13h1v1h-1zM21 14h1v1h-1z"/><path fill="#E5503F" d="M22 2h2v1h-2zM22 3h2v1h-2zM22 4h2v1h-2zM23 5h1v1h-1zM10 15h1v1h-1z"/><path fill="#FFFFFF" d="M6 3h1v1h-1zM5 4h1v1h-1zM5 5h1v1h-1z"/><path fill="#C9702A" d="M10 3h1v1h-1zM12 3h1v1h-1zM14 3h1v1h-1zM10 4h1v1h-1zM14 4h1v1h-1zM4 13h1v1h-1z"/><path fill="#FFD35A" d="M2 5h1v1h-1zM1 6h3v1h-3zM2 7h1v1h-1zM22 20h1v1h-1zM21 21h3v1h-3zM22 22h1v1h-1z"/><path fill="#F29A9A" d="M6 9h1v1h-1zM11 9h2v1h-2zM17 9h1v1h-1zM6 10h1v1h-1zM17 10h1v1h-1zM11 11h2v1h-2z"/><path fill="#FFE3BD" d="M9 9h2v1h-2zM13 9h2v1h-2zM9 10h1v1h-1zM14 10h1v1h-1zM9 11h1v1h-1zM14 11h1v1h-1z"/><path fill="#4C8DE0" d="M6 13h12v1h-12zM13 15h1v1h-1zM6 16h1v1h-1zM8 19h3v1h-3zM13 19h3v1h-3z"/><path fill="#F4F4F0" d="M8 14h8v1h-8zM6 15h4v1h-4zM11 15h2v1h-2zM14 15h2v1h-2zM7 16h9v1h-9zM8 18h3v1h-3zM13 18h3v1h-3z"/></symbol>',
  zz: '<symbol id="zz" viewBox="0 0 24 24" shape-rendering="crispEdges"><path fill="#E5503F" d="M11 1h2v1h-2zM10 17h1v1h-1z"/><path fill="#CBCBC2" d="M11 2h2v1h-2zM8 19h8v1h-8z"/><path fill="#A9CBEA" d="M6 3h12v1h-12zM5 4h1v1h-1zM18 4h1v1h-1zM4 5h1v1h-1zM4 6h1v1h-1zM19 6h1v1h-1zM4 7h1v1h-1zM4 8h1v1h-1zM19 8h1v1h-1zM4 9h1v1h-1zM19 9h1v1h-1zM4 10h1v1h-1zM19 10h1v1h-1zM4 11h1v1h-1zM19 11h1v1h-1zM4 12h1v1h-1zM19 12h1v1h-1zM5 13h1v1h-1zM18 13h1v1h-1zM6 14h12v1h-12z"/><path fill="#F2994A" d="M6 4h1v1h-1zM17 4h1v1h-1zM5 5h1v1h-1zM7 5h3v1h-3zM11 5h1v1h-1zM13 5h1v1h-1zM15 5h4v1h-4zM6 6h4v1h-4zM11 6h3v1h-3zM15 6h4v1h-4zM6 7h13v1h-13zM5 8h14v1h-14zM5 9h3v1h-3zM9 9h1v1h-1zM11 9h3v1h-3zM15 9h1v1h-1zM17 9h2v1h-2zM5 10h4v1h-4zM10 10h5v1h-5zM16 10h3v1h-3zM5 11h1v1h-1zM7 11h2v1h-2zM15 11h2v1h-2zM18 11h1v1h-1zM5 12h1v1h-1zM7 12h2v1h-2zM15 12h2v1h-2zM18 12h1v1h-1zM6 13h3v1h-3zM15 13h3v1h-3zM5 17h1v1h-1zM5 18h1v1h-1z"/><path fill="#E3F0FB" d="M7 4h10v1h-10z"/><path fill="#FFFFFF" d="M6 5h1v1h-1zM5 6h1v1h-1zM5 7h1v1h-1z"/><path fill="#C9702A" d="M10 5h1v1h-1zM12 5h1v1h-1zM14 5h1v1h-1zM10 6h1v1h-1zM14 6h1v1h-1zM4 16h1v1h-1z"/><path fill="#8D9CF0" d="M19 5h3v1h-3zM20 6h1v1h-1zM19 7h3v1h-3z"/><path fill="#2A2523" d="M8 9h1v1h-1zM10 9h1v1h-1zM14 9h1v1h-1zM16 9h1v1h-1zM9 10h1v1h-1zM15 10h1v1h-1zM11 12h2v1h-2zM11 13h2v1h-2z"/><path fill="#F29A9A" d="M6 11h1v1h-1zM11 11h2v1h-2zM17 11h1v1h-1zM6 12h1v1h-1zM17 12h1v1h-1z"/><path fill="#FFE3BD" d="M9 11h2v1h-2zM13 11h2v1h-2zM9 12h2v1h-2zM13 12h2v1h-2zM9 13h2v1h-2zM13 13h2v1h-2z"/><path fill="#4C8DE0" d="M6 15h12v1h-12zM13 17h1v1h-1zM6 19h1v1h-1zM17 19h1v1h-1zM8 21h3v1h-3zM13 21h3v1h-3z"/><path fill="#F4F4F0" d="M8 16h8v1h-8zM8 17h2v1h-2zM11 17h2v1h-2zM14 17h2v1h-2zM6 18h12v1h-12zM7 19h1v1h-1zM16 19h1v1h-1zM8 20h3v1h-3zM13 20h3v1h-3z"/></symbol>',
}


/** 상태에 맞는 고양이가 파스텔 동그라미 안에 있는 36x36 아바타. 필요한 고양이 하나만 담는다. */
export function avatarSvg(g: Mood): string {
  const s = SKIN[g]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><defs>${CAT[s.cat]}</defs><circle cx="18" cy="18" r="17" fill="${s.bubble}"/><use href="#${s.cat}" x="4" y="5" width="28" height="28"/></svg>`
}

/** 세션 칸 머리글: 상태 글자, 뜻 색, 시간. 색은 앱 테마의 뜻 색이라 어두운 테마도 따라간다 (결재함 틀, 2026-11-16 사용자 결정 B안). */
export type Head = { label: string; color: 'error' | 'warning' | 'success' | 'suggestion' | undefined; time: string; dim: boolean }

/** 칸의 머리글을 정한다. 작업 목록이 있으면 시간 뒤에 단계(3/7 단계)를 붙인다. */
export function headOf(r: Rec, g: Mood, now: number): Head {
  const ask = openAsk(r)
  const report = openReport(r)
  const dur = (at: number) => fmtDur(now - at)
  const steps = r.total > 0 ? ` · ${r.done}/${r.total} 단계` : ''
  if (isDead(r, now)) return { label: deadLabel(r), color: undefined, time: ask || report ? dur((ask ?? report)!.at) : '', dim: true }
  if (g === 'request' || g === 'notice') {
    const color = g === 'request' ? 'error' : 'warning'
    if (r.state === 'waiting') return { label: `${r.waitFor ?? '응답'} 대기`, color, time: dur(r.since) + steps, dim: false }
    return { label: `${KIND_LABEL[g]}${ask && now - ask.at > OLD_ASK_MS ? ' 낡음' : ''}`, color, time: dur(ask?.at ?? r.since) + steps, dim: false }
  }
  if (g === 'report') return { label: '확인', color: 'success', time: dur(report?.at ?? r.since) + steps, dim: false }
  if (g === 'running') return { label: '작업 중', color: 'suggestion', time: (r.turnStartedAt !== null ? dur(r.turnStartedAt) : '') + steps, dim: false }
  return { label: '쉬는 중', color: undefined, time: dur(r.since) + steps, dim: true }
}

export { C, SKIN, clip }
export type { Mood }
