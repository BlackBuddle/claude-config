import { expect, test } from 'claude-code/testing'

import { DEFAULT_FRAMES, FRAMES, catState, catSvg } from './agents'

// 디자인 패키지의 원본 SVG 64개(유형 4 x 상태 4 x 프레임 4) 길이. 같은 칸을 같은 순서로 찍었는지 본다.
const GOLDEN: Record<string, number> = {"Explore_done_0":7009,"Explore_done_1":6984,"Explore_done_2":7009,"Explore_done_3":6984,"Explore_fail_0":6998,"Explore_fail_1":7004,"Explore_fail_2":6963,"Explore_fail_3":7004,"Explore_idle_0":6166,"Explore_idle_1":6108,"Explore_idle_2":6343,"Explore_idle_3":6502,"Explore_run_0":6613,"Explore_run_1":6605,"Explore_run_2":6669,"Explore_run_3":6106,"Plan_done_0":7009,"Plan_done_1":6984,"Plan_done_2":7009,"Plan_done_3":6984,"Plan_fail_0":7055,"Plan_fail_1":7061,"Plan_fail_2":7020,"Plan_fail_3":7061,"Plan_idle_0":6223,"Plan_idle_1":6165,"Plan_idle_2":6400,"Plan_idle_3":6559,"Plan_run_0":6670,"Plan_run_1":6662,"Plan_run_2":6669,"Plan_run_3":6163,"default_done_0":7121,"default_done_1":7040,"default_done_2":7121,"default_done_3":7040,"default_fail_0":6768,"default_fail_1":6774,"default_fail_2":6733,"default_fail_3":6774,"default_idle_0":5936,"default_idle_1":5878,"default_idle_2":6113,"default_idle_3":6272,"default_run_0":6383,"default_run_1":6375,"default_run_2":6439,"default_run_3":5876,"general-purpose_done_0":7237,"general-purpose_done_1":7212,"general-purpose_done_2":7237,"general-purpose_done_3":7212,"general-purpose_fail_0":6884,"general-purpose_fail_1":6890,"general-purpose_fail_2":6849,"general-purpose_fail_3":6890,"general-purpose_idle_0":6051,"general-purpose_idle_1":5993,"general-purpose_idle_2":6228,"general-purpose_idle_3":6387,"general-purpose_run_0":6497,"general-purpose_run_1":6490,"general-purpose_run_2":6553,"general-purpose_run_3":5991}

test('고양이 64장은 원본 도트판과 같은 길이로 만들어진다', () => {
  for (const [key, len] of Object.entries(GOLDEN)) {
    const [kind, state, f] = key.split('_')
    const svg = catSvg(state as any, Number(f), kind)
    expect(svg.length).toBe(len)
    expect(svg.length).toBeLessThan(131072) // Svg 요소의 한도
  }
  // 모르는 유형은 기본 고양이, 프레임은 4로 돌아간다
  expect(catSvg('run', 4, 'Explore')).toBe(catSvg('run', 0, 'Explore'))
})

test('에이전트 상태는 고양이 상태 네 가지로 빠짐없이 옮겨진다', () => {
  expect(catState('running')).toBe('run')
  expect(catState('pending')).toBe('run')
  expect(catState('completed')).toBe('done')
  expect(catState('failed')).toBe('fail')
  expect(catState('killed')).toBe('fail')
  expect(catState('idle')).toBe('idle')
  expect(catState('waiting')).toBe('idle')
})

test('캐릭터는 한 글자이고 두 칸이 될 수 있는 글자를 쓰지 않는다', () => {
  const ambiguous = /[àáæè-êìíðòó÷-úüþ]/ // 동아시아 모호 폭(Latin-1)
  for (const set of [...Object.values(FRAMES), DEFAULT_FRAMES]) {
    for (const ch of set) {
      expect([...ch].length).toBe(1)
      expect(ambiguous.test(ch)).toBe(false)
    }
  }
})
