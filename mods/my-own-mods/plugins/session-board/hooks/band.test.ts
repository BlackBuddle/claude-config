import { expect, test } from 'claude-code/testing'

import { askPillSvg, asksText, bandCatSvg, bandSvg, barsOf, dailyBudget, detailRows, fit, gauge, panelSvg } from './band'

// 시안 3번과 같은 상태: 컨텍스트 31%, 주 15%(오늘 7/19%p), 턴 11초
const sample: any = {
  verify: { tone: 'ok', text: '✓ 검증 2' },
  children: 0,
  context: { percent: 31, tokens: 311020, window: 1000000 },
  week: { percent: 15, mark: 27, today: '7/19%p', todayTone: 'mute', reset: '11/18 06:00', weight: 0.3, recommended: 19, pace: -6 },
  turn: { text: '11초', live: false },
  cache: { tone: 'mute', alert: null, clock: '18:12', since: '마지막 답변 + 60분 · 11/12' },
  history: [12, 20, 31],
  lastTurn: '9초',
  lastVerify: '없음',
}

test('밴드는 폭이 좁아지면 하위 → 턴 → 오늘 권장 순으로 숨기고 게이지는 끝까지 남긴다', () => {
  const full = bandSvg(sample, 2000)
  expect(full.hidden).toBe(0)
  for (const t of ['>컨텍스트</tspan>', '>주</tspan>', '>31%</tspan>', '>15%</tspan>', '>오늘 </tspan>', '>7/19%p</tspan>', '>턴 </tspan>', '>하위 </tspan>']) expect(full.svg).toContain(t)
  const noChildren = bandSvg(sample, Math.floor(full.w * 1.12) - 1) // 이미지는 12% 키워 그려서 기준 폭도 같은 배율이다
  expect(noChildren.hidden).toBe(1)
  expect(noChildren.svg).not.toContain('>하위 </tspan>')
  expect(noChildren.svg).toContain('>턴 </tspan>')
  const tiny = bandSvg(sample, 100)
  expect(tiny.hidden).toBe(4) // 마지막 단계는 오류가 아닌 검증 칸(✓ 검증 2)도 숨긴다
  for (const t of ['>하위 </tspan>', '>턴 </tspan>', '>오늘 </tspan>', '>7/19%p</tspan>']) expect(tiny.svg).not.toContain(t)
  expect(tiny.svg).toContain('>컨텍스트</tspan>') // 게이지는 남는다
  expect(tiny.svg).toContain('>주</tspan>')
})

test('밴드의 고양이는 상태에 따라 달라지고 필요한 고양이 하나만 담는다', () => {
  expect(bandSvg(sample, 2000).svg).toContain('use href="#zz"') // 값이 없으면 조는 고양이
  expect(bandSvg({ ...sample, mood: 'run' }, 2000).svg).toContain('use href="#run"')
  const flag = bandSvg({ ...sample, mood: 'flag' }, 2000).svg
  expect(flag).toContain('use href="#flag"')
  expect(flag).not.toContain('id="run"')
})

test('상세는 채팅창 위 자리에 들어가도록 낮고, 카드는 흰 바탕이며 경고만 호박색이다', () => {
  const { svg, h } = panelSvg(sample)
  expect(h).toBeLessThan(170)
  // 컨텍스트의 토큰과 전체는 한 줄(같은 y), 주간의 리셋과 페이스 글자도 한 줄이다
  const tokenY = /<text x="[\d.]+" y="(\d+)"[^>]*><tspan[^>]*>311,020/.exec(svg)?.[1]
  expect(svg).toMatch(new RegExp(`<text x="[\\d.]+" y="${tokenY}"[^>]*><tspan[^>]*> / 1,000,000 `))
  const resetY = /<text x="[\d.]+" y="(\d+)"[^>]*><tspan[^>]*>리셋 /.exec(svg)?.[1]
  expect(svg).toMatch(new RegExp(`<text x="[\\d.]+" y="${Number(resetY) - 1}"[^>]*><tspan[^>]*>여유 -6%p`))
  // 파스텔 바탕과 글자 알약 없이 흰 카드
  for (const tint of ['#F5F7FF', '#F1FBF6', '#FFF5F8', '#F6F4FF', '#DEF5ED']) expect(svg).not.toContain(`fill="${tint}"`)
  // 페이스가 10%p 넘게 빠르면 주간 카드가 호박색 바탕이 된다
  expect(panelSvg({ ...sample, week: { ...sample.week, pace: 14 } }).svg).toContain('fill="#FFFBEB"')
})

test('숫자용 글꼴 조각 안의 한글은 sans 글꼴로 나눠 그린다(Consolas 에는 한글이 없다)', () => {
  const { svg } = bandSvg({ ...sample, turn: { text: '1분 04초', live: false } }, 2000)
  expect(svg).toMatch(/font-family="'JetBrains Mono',Consolas,monospace"[^>]*>1<\/tspan><tspan[^>]*font-family="'Noto Sans KR'[^>]*>분<\/tspan>/)
  expect(svg).not.toMatch(/monospace"[^>]*>[^<]*[가-힣]/) // 고정폭 글꼴 조각에는 한글이 없다
})

test('컨텍스트 색 눈금은 25/50/75/90% 에서 바뀐다', () => {
  const at = (p: number) => bandSvg({ ...sample, context: { ...sample.context, percent: p } }, 2000).svg
  expect(at(10)).toContain('fill="#22B8CF"') // 시안
  expect(at(31)).toContain('fill="url(#gi)"') // 인디고 그라데이션
  expect(at(60)).toContain('fill="#F59E0B"') // 호박
  expect(at(80)).toContain('fill="#F97316"') // 주황
  expect(at(95)).toContain('fill="#F43F5E"') // 로즈
})

test('상세는 카드 둘(컨텍스트·주간 한도)만 그리고, 캐시·최근 활동·하위 에이전트·색 눈금 안내는 없다', () => {
  const { svg } = panelSvg(sample)
  for (const t of ['>컨텍스트</tspan>', '>311,020</tspan>', '> / 1,000,000 </tspan>', '>토큰</tspan>', '>주간 한도</tspan>', '>11/18 06:00</tspan>', '>오늘 권장 19%p</tspan>']) expect(svg).toContain(t)
  for (const gone of ['>하위 에이전트 </tspan>', '>캐시</tspan>', '>18:12</tspan>', '>최근 활동</tspan>', '>검증</tspan>', '>색 눈금</tspan>', '>25% 미만</tspan>']) expect(svg).not.toContain(gone)
  expect(svg).toContain('여유 -6%p') // 느리게 쓰는 중은 초록 알약
  expect(svg).toContain('stroke-dasharray') // 컨텍스트 도넛
  // 값이 없으면 숫자를 지어내지 않고 안내한다
  const empty = panelSvg({ ...sample, context: null, week: null, cache: null, history: [] }).svg
  expect(empty).toContain('아직 값을 읽지 못했습니다')
  expect(empty).toContain('주간 한도 값을 읽지 못했습니다')
  // 설명 문장은 줄였다: 추이 안내, 쉬는 날 가중치, 페이스 풀이는 카드에 없다
  for (const gone of ['추이는', '쉬는 날', '시간 흐름보다']) expect(svg).not.toContain(gone)
})

test('게이지는 6칸이고 범위를 벗어난 값도 안전하다', () => {
  expect(gauge(19)).toEqual(['▰', '▱▱▱▱▱'])
  expect(gauge(0)).toEqual(['', '▱▱▱▱▱▱'])
  expect(gauge(100)).toEqual(['▰▰▰▰▰▰', ''])
  expect(gauge(250)[0].length + gauge(250)[1].length).toBe(6)
  expect(gauge(-5)[0]).toBe('')
})

test('막대는 0~100% 눈금이고 가장 낮은 막대는 ▂ 다', () => {
  expect(barsOf([10, 19, 30])).toBe('▂▂▃')
  expect(barsOf([46])).toBe('▄') // 한 점이 꽉 찬 █ 로 그려지지 않는다
  expect(barsOf([10, 100])).toBe('▂█')
})

test('상세를 펼치면 값을 못 읽은 항목은 줄을 만들지 않는다', () => {
  const rows = detailRows(Date.now())
  const keys = rows.map(r => r[0])
  expect(keys).toContain('상태')
  expect(keys).not.toContain('주간') // 한도 값을 아직 못 읽었다
})

const DAY = 86_400_000

test('오늘 권장량은 남은 한도를 남은 날에 나눈다', () => {
  // 수요일 정오, 리셋은 4일 뒤(목·금·토·일 지나 월요일 0시 전). 평일 가중치 1, 주말 0.3.
  const wed = new Date(2026, 10, 11, 12, 0, 0).getTime() // 2026-11-11 은 수요일
  const resets = new Date(2026, 10, 16, 0, 0, 0).toISOString() // 다음 월요일 0시
  const b = dailyBudget(40, 40, resets, wed)
  // 남은 날: 수·목·금(1+1+1) + 토·일(0.3+0.3) = 3.6, 오늘 가중치 1 → (100-40)/3.6
  expect(Math.round(b!.recommended * 10) / 10).toBe(16.7)
  // 리셋을 모르면 계산하지 않는다
  expect(dailyBudget(40, 40, undefined, wed)).toBeNull()
  void DAY
})

test('리셋이 낀 마지막 날은 리셋 시각까지의 몫만 센다', () => {
  const wed = new Date(2026, 10, 11, 12, 0, 0).getTime()
  const resets = new Date(2026, 10, 16, 6, 0, 0).toISOString() // 월요일 06시: 마지막 날은 0.25 몫
  // 수·목·금(3) + 토·일(0.6) + 월(0.25) = 3.85 → (100-40)/3.85
  expect(Math.round(dailyBudget(40, 40, resets, wed)!.recommended * 10) / 10).toBe(15.6)
})

test('좁으면 번호가 큰 칸부터 숨긴다', () => {
  const segs = [
    { prio: 1, value: '✓ 검증 2' },
    { prio: 3, label: '컨텍스트', value: '43%' },
    { prio: 7, label: '캐시', value: '38분' },
    { prio: 9, label: '페이스', value: '+6%p 앞섬' },
  ]
  expect(fit(segs, 200).length).toBe(4)
  const narrow = fit(segs, 36)
  expect(narrow.map(s => s.prio)).toEqual([1, 3])
})

test('아주 좁아도 이상 칸은 남긴다', () => {
  const segs = [
    { prio: 1, value: '✓ 검증 2', level: 'ok' as const },
    { prio: 3, label: '컨텍스트', value: '⚠ 72%', level: 'warn' as const },
    { prio: 7, label: '캐시', value: '38분', level: 'mute' as const },
  ]
  expect(fit(segs, 18).map(s => s.prio)).toEqual([3])
  // 이상 칸이 없으면 번호가 작은 칸이 남는다
  expect(fit(segs.map(s => ({ ...s, level: undefined })), 18).map(s => s.prio)).toEqual([1])
})

// 아래 플러그인(ponytail 등)이 이미 띠를 그리는 경우: 내 띠가 그것을 가리지 않고 함께 그려야 한다.
test('좁으면 마지막 단계에서 오류가 아닌 검증 칸을 숨긴다. 오류 검증 칸은 남긴다', () => {
  const warned = { ...sample, verify: { tone: 'warn', text: '⚠ 검증 못함 (도구 없음)' } }
  expect(bandSvg(warned, 100).svg).not.toContain('검증 못함')
  expect(bandSvg({ ...warned, verify: { tone: 'err', text: '✗ 검증 실패' } }, 100).svg).toContain('검증 실패')
  expect(bandSvg(warned, 3000).svg).toContain('검증 못함') // 넓으면 그대로 둔다
})

test('띠의 글은 0이 아닌 종류만 쓰고, 칸이 없으면 쓰지 않는다', () => {
  expect(asksText({ request: 1, notice: 2, report: 0 })).toBe('결재 1 · 알림 2')
  expect(asksText({ request: 0, notice: 0, report: 3 })).toBe('확인 3')
  expect(asksText({ request: 0, notice: 0, report: 0 })).toBeNull()
})

test('터미널 띠 글자 칸에도 개수가 들어가고, 이상 칸이라 좁아도 남는다', () => {
  const segs = [{ prio: 0, value: '✗ 결재 1 · 알림 2', level: 'err' as const }, { prio: 2, label: '하위', value: '0', level: 'mute' as const }, { prio: 9, label: '페이스', value: '+1%p 앞섬', level: 'mute' as const }]
  expect(fit(segs, 24).map(s => s.prio)).toContain(0)
})

test('개수 알약은 띠의 경고 알약과 같은 연한 바탕·진한 점·굵은 숫자이고, 글자(결재·알림)는 쓰지 않는다', () => {
  const warn = askPillSvg('warn', 3).svg
  expect(warn).toContain('fill="#FEF3C7"') // 알림: 연한 호박 바탕
  expect(warn).toContain('<circle cx="13" cy="16" r="4" fill="#F59E0B"/>') // 진한 호박 점
  expect(warn).toMatch(/fill="#92400E"[^>]*font-weight="700">3</) // 굵은 숫자
  expect(warn).not.toContain('알림')
  expect(askPillSvg('err', 1).svg).toContain('fill="#FFE4E8"') // 결재: 로즈
  expect(askPillSvg('ok', 1).svg).toContain('fill="#DEF5ED"') // 확인: 초록
  expect(askPillSvg('warn', 12).w).toBeGreaterThan(askPillSvg('warn', 1).w) // 두 자리면 넓어진다
})

test('따로 그린 띠 그림에는 고양이가 없다', () => {
  expect(bandSvg(sample, 2000, true).svg).not.toContain('<use href="#zz"')
  expect(bandSvg(sample, 2000).svg).toContain('use href="#zz"')
  expect(bandCatSvg('flag')).toContain('use href="#flag"')
})
