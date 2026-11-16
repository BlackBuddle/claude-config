import { expect, test } from 'claude-code/testing'

import { applyPlan, appLink, avatarSvg, badges, barSvg, fmtDur, groupOf, infoSvg, parseRec, progress, type Rec } from './register'

const NOW = 1_000_000_000_000
const rec = (p: Partial<Rec> = {}): Rec => ({ id: 's1', name: '프로젝트', state: 'idle', since: NOW, turnStartedAt: null, waitFor: null, done: 0, total: 0, step: '', updatedAt: NOW, appId: null, root: '', ask: null, report: null, askClosedAt: 0, reportClosedAt: 0, ...p })

test('상태바는 상태 글자와 점점 채워지는 막대를 한 덩어리(아바타 높이)로 그리고, 작업 목록이 없으면 막대를 그리지 않는다', () => {
  const run = infoSvg(rec({ state: 'running', turnStartedAt: NOW - 252_000, done: 3, total: 7, step: '시험 작성' }), 'running', NOW)
  for (const t of ['>작업 중</tspan>', '> 4분 12초</tspan>', '>3/7</tspan>']) expect(run.svg).toContain(t)
  expect(run.h).toBe(32) // 고양이 아바타와 같은 높이라 이름 | 상태바 | 이 세션 이 한 줄이다
  expect(run.svg).not.toContain('rx="7.5"') // 알약은 쓰지 않는다
  expect(run.svg.indexOf('작업 중')).toBeLessThan(run.svg.indexOf('rx="2"')) // 상태 글자 → 막대
  // 끝낸 3/7 만큼 채우고(막대 폭 52 의 3/7), 끝에 현재 위치 동그라미가 있다
  expect(run.svg).toContain(`width="${Math.round((52 * 3) / 7)}" height="4" rx="2" fill="#4F6BFF"`)
  expect(run.svg).toContain('<circle')
  // 0/8 이어도 시작했음이 보이는 작은 끝부분과 동그라미가 있다
  const zero = infoSvg(rec({ state: 'running', done: 0, total: 8 }), 'running', NOW).svg
  expect(zero).toContain('width="5" height="4" rx="2" fill="#4F6BFF"')
  expect(zero).toContain('<circle')
  // 유휴 세션은 채운 만큼만 보이고 동그라미가 없다
  const idleDone = infoSvg(rec({ state: 'idle', since: NOW - 11_000, done: 2, total: 2 }), 'idle', NOW)
  expect(idleDone.svg).toContain('> 11초</tspan>')
  expect(idleDone.svg).not.toContain('<circle')

  const wait = infoSvg(rec({ state: 'waiting', waitFor: 'Bash 승인', since: NOW - 65_000 }), 'notice', NOW)
  expect(wait.svg).toContain('>Bash 승인 대기</tspan>') // 폭이 모자라면 시간은 빠지고 상태 글자는 남는다
  expect(wait.svg).not.toContain('rx="2"') // 작업 목록이 없다
  expect(wait.svg).not.toContain('0/0')
})

test('고양이 아바타는 상태마다 다르고, 앱 링크는 앱 세션 번호로 만든다', () => {
  expect(avatarSvg('running')).toContain('use href="#run"')
  for (const g of ['request', 'notice', 'report'] as const) expect(avatarSvg(g)).toContain('use href="#flag"') // 사용자를 기다리는 세 묶음은 깃발 든 고양이
  expect(avatarSvg('idle')).toContain('use href="#zz"')
  expect(avatarSvg('running')).not.toContain('id="flag"') // 필요한 고양이 하나만 담는다
  expect(appLink(rec({ appId: 'local_abc-123' }))).toBe('claude://claude.ai/epitaxy/local_abc-123')
  expect(appLink(rec())).toBeNull() // 이전 버전 기록에는 번호가 없다
  expect(parseRec(JSON.stringify({ ...rec(), appId: 'local_x' }))?.appId).toBe('local_x')
  expect(parseRec(JSON.stringify(rec()))?.appId).toBeNull()
})

test('시간은 초, 분, 시간 단위로 줄여 쓴다', () => {
  expect(fmtDur(5_000)).toBe('5초')
  expect(fmtDur(252_000)).toBe('4분 12초')
  expect(fmtDur(3_900_000)).toBe('1시간 05분')
  expect(fmtDur(-1)).toBe('0초')
})

test('깨진 기록 파일은 버리고, 모양이 맞으면 읽는다', () => {
  expect(parseRec('not json')).toBeNull()
  expect(parseRec('{"id":"a"}')).toBeNull()
  expect(parseRec(JSON.stringify({ ...rec(), state: 'zzz' }))).toBeNull()
  expect(parseRec({ base64: 'x' })).toBeNull()
  expect(parseRec(JSON.stringify(rec({ state: 'running', done: 2, total: 5 })))?.total).toBe(5)
})

test('90초 넘게 기록이 없거나 끝난 세션은 숨긴다', () => {
  expect(groupOf(rec({ state: 'running' }), NOW + 89_000)).toBe('running')
  expect(groupOf(rec({ state: 'running' }), NOW + 91_000)).toBe('hidden')
  expect(groupOf(rec({ state: 'ended' }), NOW)).toBe('hidden')
  expect(groupOf(rec({ state: 'waiting' }), NOW)).toBe('notice') // 권한 승인 대기는 알림과 합친다
})

test('뱃지는 진척도, 경과 시간, 대기 사유를 담는다', () => {
  const run = badges(rec({ state: 'running', done: 3, total: 7, turnStartedAt: NOW - 252_000 }), NOW)
  expect(run.map(b => b.text)).toEqual(['3/7 단계', '경과 4분 12초'])
  expect(run[0].main).toBe(true)
  expect(run[1].main).toBe(false)

  const wait = badges(rec({ state: 'waiting', waitFor: 'Bash 승인', since: NOW - 65_000, done: 1, total: 4 }), NOW)
  expect(wait.map(b => b.text)).toEqual(['Bash 승인 대기', '대기 1분 05초', '1/4 단계'])

  const idle = badges(rec({ state: 'idle', since: NOW - 300_000 }), NOW)
  expect(idle.map(b => b.text)).toEqual(['5분 00초 전'])

  // 작업 목록이 없으면 경과 시간이 주 뱃지
  expect(badges(rec({ state: 'running', turnStartedAt: NOW - 3_000 }), NOW).map(b => b.text)).toEqual(['경과 3초'])
})

test('앱의 작업 목록(update_plan)은 통째 교체와 한 단계씩 고침을 모두 따라간다', () => {
  const items = [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'pending' }, { content: 'c', status: 'pending' }]
  let plan = applyPlan([], { items })
  expect(progress(plan)).toEqual({ total: 3, done: 0, step: 'a' })
  plan = applyPlan(plan, { advance: true }) // a 끝, b 시작
  expect(progress(plan)).toEqual({ total: 3, done: 1, step: 'b' })
  plan = applyPlan(plan, { done: [2], start: 3 }) // 번호는 1부터
  expect(progress(plan)).toEqual({ total: 3, done: 2, step: 'c' })
  plan = applyPlan(plan, { advance: true })
  expect(progress(plan)).toEqual({ total: 3, done: 3, step: '' })
  // 목록이 없을 때 오는 고침 호출과 범위를 벗어난 번호는 무시한다
  expect(applyPlan([], { advance: true, done: [9], start: 0 })).toEqual([])
  expect(items[0].status).toBe('in_progress') // 받은 목록을 바꾸지 않는다
})

test('앱 작업 목록 호출이 오면 기록의 done/total/step 이 바뀐다', async ($, on) => {
  const writes: any[] = []
  on('env.get', () => ({ value: 'C:/home' }))
  on('session.cwd', () => ({ value: 'C:/work/p' }))
  on('session.id', () => ({ value: 'me' }))
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: {} }) as any)
  on('command.register', () => ({ value: { command: 'session_board' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('store.get', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }) as any)
  on('fs.write', (_, e: any) => {
    writes.push(JSON.parse(e.text))
    return { value: undefined } as any
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: '조사', status: 'in_progress' }, { content: '구현', status: 'pending' }] } as any)
  expect(writes.at(-1)).toMatchObject({ done: 0, total: 2, step: '조사' })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as any)
  expect(writes.at(-1)).toMatchObject({ done: 1, total: 2, step: '구현' })
})

test('진척 막대는 채움 길이가 단계 비율과 같고 한도를 넘지 않는다', () => {
  expect(barSvg(1, 4, '#4F6BFF', 160)).toContain('width="40"')
  expect(barSvg(9, 4, '#4F6BFF', 160)).toContain('width="160" height="6" rx="3" fill="#4F6BFF"')
  expect(barSvg(0, 4, '#4F6BFF')).not.toContain('#4F6BFF')
})

test('승인 대화상자와 질문은 대기로 기록하고, 풀리면 진행 중으로 돌아간다', async ($, on) => {
  const states: [string, string | null][] = []
  on('env.get', () => ({ value: 'C:/home' }))
  on('session.cwd', () => ({ value: 'C:/work/p' }))
  on('session.id', () => ({ value: 'me' }))
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: {} }) as any)
  on('command.register', () => ({ value: { command: 'session_board' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('store.get', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }) as any)
  on('fs.write', (_, e: any) => {
    const r = JSON.parse(e.text)
    states.push([r.state, r.waitFor])
    return { value: undefined } as any
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.check', () => ({ decision: 'ask' }) as any)
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(states).toContainEqual(['waiting', 'Bash 승인'])
  expect(states.at(-1)).toEqual(['running', null])

  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  expect(states).toContainEqual(['waiting', '답변'])
  expect(states.at(-1)).toEqual(['running', null])
})

// 세션 시작부터 패널까지: 작업 목록과 질문 대기를 파일에 쓰고, 패널이 폴더의 다른 세션과 함께 그린다.
test('내 상태를 파일에 쓰고, 패널은 다른 세션 기록과 함께 그린다', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  const other = JSON.stringify(rec({ id: 'other', name: '다른 프로젝트', state: 'running', done: 2, total: 5, step: '시험 실행', turnStartedAt: Date.now() - 60_000, since: Date.now() - 60_000, updatedAt: Date.now() }))
  on('env.get', () => ({ value: 'C:/home' }))
  on('session.cwd', () => ({ value: 'C:/work/내 프로젝트' }))
  on('session.id', () => ({ value: 'me' }))
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: {} }) as any)
  on('command.register', () => ({ value: { command: 'session_board' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('store.get', () => ({ value: undefined }))
  on('fs.write', (_, e: any) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined } as any
  })
  on('fs.list', () => ({ value: [{ name: 'other.json', kind: 'file', size: 1, mtimeMs: Date.now(), isLink: false }] }) as any)
  on('fs.read', () => ({ value: other }) as any)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // Windows 에서는 엔진이 경로 구분자를 \ 로 바꿔 넘긴다
  expect(writes.at(-1)?.path.replaceAll('\\', '/')).toBe('C:/home/.claude/session-board/me.json')
  expect(JSON.parse(writes.at(-1)!.text).name).toBe('내 프로젝트')

  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'completed', activeForm: 'a 중' }, { content: 'b', status: 'in_progress', activeForm: 'b 하는 중' }, { content: 'c', status: 'pending', activeForm: 'c' }] })
  const saved = JSON.parse(writes.at(-1)!.text)
  expect([saved.done, saved.total, saved.step]).toEqual([1, 3, 'b 하는 중'])

  // 세션을 열 때 패널이 같이 열렸으니 따로 명령을 칠 필요가 없다
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-board', component: 'Pane', requestId: 'session-board', props: { title: '세션', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} }, surface } as any)
    if (surface === 'terminal') {
      const found = await Promise.all([/2\/5 단계/, /1\/3 단계/, /지금: 시험 실행/].map(async text => (await ui.find({ type: 'Text', text }))?.text !== undefined))
      expect([surface, ...found]).toEqual([surface, true, true, true])
      expect(await ui.find({ type: 'Button', text: /다른 프로젝트/ })).toBeTruthy() // 이름은 누르면 펴지는 단추다
    } else {
      // 데스크톱은 카드를 이미지 한 장으로 그린다. 이미지 안의 글자는 infoSvg 시험이 지킨다.
      expect(await ui.find({ type: 'Svg' })).toBeTruthy()
      expect((await ui.find({ type: 'Text', text: /세션 \d+개/ }))?.text).toBeDefined()
    }
    await ui.unmount()
  }
})

test('앱(SDK) 세션처럼 isInteractive 가 false 여도 패널을 열고, 명령은 그려지는 패널만 닫는다', async ($, on) => {
  let opens = 0
  let closes = 0
  let panes: any[] = []
  on('env.get', () => ({ value: 'C:/home' }))
  on('session.cwd', () => ({ value: 'C:/work/p' }))
  on('session.id', () => ({ value: 'me' }))
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: {} }) as any)
  on('command.register', () => ({ value: { command: 'session_board' } }))
  on('store.get', () => ({ value: undefined }))
  on('fs.write', () => ({ value: undefined }) as any)
  on('fs.list', () => ({ value: [] }) as any)
  on('ui.open', () => {
    opens += 1
    return { value: { isPlaced: false } } // 화면이 아직 안 붙었거나 창이 좁다
  })
  on('ui.close', () => {
    closes += 1
    return { value: undefined } as any
  })
  on('ui.panes', () => ({ value: panes }) as any)
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: null, isInteractive: false } as any)
  expect(opens).toBe(1)

  // 아직 못 그리는 패널이면 닫지 않고 사용자가 시킨 열기로 다시 연다
  panes = [{ id: 'session-board', isPlaced: false }]
  await $.command.run({ command: 'session_board', args: '' } as any)
  expect([opens, closes]).toEqual([2, 0])

  // 그려지고 있으면 닫는다
  panes = [{ id: 'session-board', isPlaced: true }]
  await $.command.run({ command: 'session_board', args: '' } as any)
  expect([opens, closes]).toEqual([2, 1])
})

test('세션을 열면 패널이 같이 열리고, 접기를 누르면 좁은 너비로 다시 열어 요약 알약만 그린다', async ($, on) => {
  const opens: any[] = []
  let closes = 0
  const stored: any[] = []
  const waiting = JSON.stringify(rec({ id: 'w', name: '대기 중', state: 'waiting', waitFor: '답변', since: Date.now(), updatedAt: Date.now() }))
  on('env.get', () => ({ value: 'C:/home' }))
  on('session.cwd', () => ({ value: 'C:/work/p' }))
  on('session.id', () => ({ value: 'me' }))
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: {} }) as any)
  on('command.register', () => ({ value: { command: 'session_board' } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e: any) => {
    stored.push(e.value)
    return { value: undefined } as any
  })
  on('ui.open', (_, e: any) => {
    opens.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    closes += 1
    return { value: undefined } as any
  })
  on('fs.write', () => ({ value: undefined }) as any)
  on('fs.list', () => ({ value: [{ name: 'w.json', kind: 'file', size: 1, mtimeMs: Date.now(), isLink: false }] }) as any)
  on('fs.read', () => ({ value: waiting }) as any)
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opens.length).toBe(1)
  expect(opens[0].columns).toBe(40) // 펼친 상태는 줄 하나가 들어가는 너비를 바란다(상한은 걸 수 없다)

  const props = { title: '세션', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} }
  const ui = await $.ui.mount({ plugin: 'session-board', component: 'Pane', requestId: 'session-board', props, surface: 'desktop' } as any)
  expect(await ui.find({ type: 'Svg' })).toBeTruthy() // 펼친 데스크톱 패널은 카드 이미지
  expect((await ui.find({ type: 'Text', text: /세션 \d+개/ }))?.text).toBeDefined()

  await ui.press({ key: 'fold-btn' })
  expect(closes).toBe(1)
  expect(opens.length).toBe(2)
  expect(opens[1].columns).toBe(16)
  expect(stored).toEqual([true])
  // 접으면 묶음 카드 대신 개수 알약만 남는다
  expect((await ui.find({ type: 'Text', text: /알림 1/ }))?.text).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /대기 중/ })).toBeUndefined()

  // 펼치기: 다시 기본 너비
  await ui.press({ key: 'fold-btn' })
  expect(opens[2].columns).toBe(40)
  expect(stored).toEqual([true, false])
  await ui.unmount()
})

// ---- 결재함 기능 이식 ----------------------------------------------------------------
type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]
const PANE = { title: '세션', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} }
const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const
const LIVE = () => Date.now()
const file = (id: string, p: Partial<Rec> = {}) => JSON.stringify(rec({ id, name: `세션-${id}`, updatedAt: LIVE(), since: LIVE(), appId: 'local_ab-12', ...p }))

// 가짜 기록 폴더: 파일 내용과 수정 시각을 바꾸는 쓰기, 실행한 명령과 알림을 모은다
function fakeBoard(on: On, files: Record<string, string>) {
  let clock = 1
  const t0 = Date.now() // 수정 시각이 너무 옛날이면 세션 시작 때의 정리가 파일을 지운다
  const mtimes: Record<string, number> = Object.fromEntries(Object.keys(files).map(f => [f, t0]))
  const seen = { ran: [] as string[][], toasts: [] as string[], opens: 0 }
  const base = (p: unknown) => String(p).replaceAll('\\', '/').split('/').pop() ?? ''
  on('env.get', (_, e: any) => ({ value: e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_me-1' : e.name === 'CLAUDE_CODE_SESSION_ID' ? undefined : 'C:/home' }) as any)
  on('session.cwd', () => ({ value: 'C:/work/p' }))
  on('session.id', () => ({ value: 'me' }))
  on('session.root', () => ({ value: 'C:/work/p' }))
  on('session.messages', () => ({ value: [] }) as any)
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: {} }) as any)
  on('command.register', () => ({ value: { command: 'session_board' } }))
  on('store.get', () => ({ value: undefined }))
  on('ui.open', () => {
    seen.opens += 1
    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_, e: any) => {
    seen.toasts.push(e.text)
    return { value: {} } as any
  })
  on('fs.list', () => ({ value: Object.keys(files).map(f => ({ name: f, kind: 'file', size: 1, mtimeMs: mtimes[f] ?? 0, isLink: false })) }) as any)
  on('fs.read', (_, e: any) => ({ value: files[base(e.path)] }) as any)
  on('fs.write', (_, e: any) => {
    files[base(e.path)] = e.text
    mtimes[base(e.path)] = t0 + ++clock
    return { value: undefined } as any
  })
  on('process.run', (_, e: any) => {
    if (e.argv[0] === 'rundll32' || e.argv[0] === 'cmd') seen.ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as any
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_, e: any) => ({ text: e.text }))
  on('turn.complete', (_, e: any) => ({ text: e.answer }))
  return seen
}

const turnOf = ($: any) => (answer: string) => $.turn.complete({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't' } as any)
const mount = ($: any, surface: 'desktop' | 'terminal' = 'desktop') => $.ui.mount({ plugin: 'session-board', component: 'Pane', requestId: 'session-board', props: PANE, surface } as any)

test('턴 끝 판정: 결재·알림이 이 세션의 기록이 되고, 신호 없는 사용자 턴은 닫는다', async ($, on) => {
  const files: Record<string, string> = {}
  fakeBoard(on, files)
  await $.session.start(START)
  const turn = turnOf($)
  const mine = () => JSON.parse(files['me.json'] ?? '{}')

  await turn('보고.\n결재: DB를 바꾼다\n결재: 표가 3개다')
  expect(mine()).toMatchObject({ state: 'idle', ask: { kind: 'request', question: 'DB를 바꾼다', background: ['표가 3개다'] }, appId: 'local_me-1' })

  await $.prompt.submit({ text: '바꿔', origin: { kind: 'composer' } } as any)
  await turn('알림: 노력 수준을 high로 바꾼다')
  expect(mine().ask).toMatchObject({ kind: 'notice' })

  await $.prompt.submit({ text: '바꿨다', origin: { kind: 'composer' } } as any)
  await turn('확인: 시험 통과\n끝냈다.')
  expect(mine().ask).toBeNull() // 신호 없이 끝난 사용자 턴은 닫는다
  expect(mine().report).toMatchObject({ lines: ['시험 통과'] }) // 확인은 눌러야 닫힌다

  // 작업 알림이 낀 턴은 사용자의 답이 아니다: 칸을 닫지 않는다
  await turn('결재: 또 묻는다')
  await $.prompt.submit({ text: '작업 알림', origin: { kind: 'task-notification' } } as any)
  await turn('진행했다.')
  expect(mine().ask).toMatchObject({ question: '또 묻는다' })
})

test('이름을 누르면 펴지고, 이동 단추는 결재함 방식(rundll32)으로 그 세션을 연다', async ($, on) => {
  const files = { 'other.json': file('other', { ask: { kind: 'request', question: '방식을 고르는가?', background: ['배경 1', '배경 2', '배경 3'], options: ['A', 'B'], at: LIVE() } }) }
  const seen = fakeBoard(on, files)
  await $.session.start(START)
  const ui = await mount($)
  expect(await ui.find({ key: 'go:other' })).toBeFalsy() // 접힌 줄에는 이동 단추가 없다
  await ui.press({ key: 'nm:other' })
  expect((await ui.find({ type: 'Text', text: /방식을 고르는가/ }))?.text).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /배경 2/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /배경 3/ })).toBeFalsy() // 배경은 2줄까지
  expect((await ui.find({ type: 'Text', text: /① A {2}② B/ }))?.text).toBeDefined() // 선택지 1줄
  await ui.press({ key: 'go:other' })
  expect(seen.ran).toEqual([['rundll32', 'url.dll,FileProtocolHandler', 'claude://claude.ai/epitaxy/local_ab-12']])
  await ui.press({ key: 'nm:other' }) // 같은 줄을 다시 누르면 접힌다
  expect(await ui.find({ key: 'go:other' })).toBeFalsy()
  await ui.unmount()
})

test('앱 번호 모양이 틀리면 이동 단추를 두지 않는다 (명령 주입 방지)', async ($, on) => {
  const seen = fakeBoard(on, { 'bad.json': file('bad', { appId: 'local_x & calc', ask: { kind: 'notice', question: 'q', background: [], options: [], at: LIVE() } }) })
  await $.session.start(START)
  const ui = await mount($)
  await ui.press({ key: 'nm:bad' })
  expect(await ui.find({ key: 'go:bad' })).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /이동이 안 된다/ }))?.text).toBeDefined()
  expect(seen.ran).toEqual([])
  await ui.unmount()
})

test('닫기: 알림·낡은 결재·끝난 세션에 있고, 살아 있는 새 결재에는 없다. 누르면 닫은 시각을 쓴다', async ($, on) => {
  const at = LIVE()
  const day = 24 * 60 * 60 * 1000
  const files: Record<string, string> = {
    'fresh.json': file('fresh', { ask: { kind: 'request', question: '새 결재', background: [], options: [], at } }),
    'old.json': file('old', { ask: { kind: 'request', question: '낡은 결재', background: [], options: [], at: at - day - 1000 } }),
    'dead.json': file('dead', { state: 'ended', ask: { kind: 'request', question: '끝난 세션의 결재', background: [], options: [], at } }),
    'note.json': file('note', { ask: { kind: 'notice', question: '알림', background: [], options: [], at } }),
  }
  fakeBoard(on, files)
  await $.session.start(START)
  const ui = await mount($)
  for (const id of ['fresh', 'old', 'dead', 'note']) await ui.press({ key: `nm:${id}` }) // 줄마다 따로 펴려면 하나씩 펴고 확인한다
  // 한 번에 하나만 펴진다: 마지막으로 편 note 만 보인다
  expect(await ui.find({ key: 'close:note' })).toBeTruthy()
  for (const [id, hasClose] of [['fresh', false], ['old', true], ['dead', true]] as const) {
    await ui.press({ key: `nm:${id}` })
    expect([id, !!(await ui.find({ key: `close:${id}` }))]).toEqual([id, hasClose])
  }
  await ui.press({ key: 'close:dead' })
  expect(JSON.parse(files['dead.json']!).askClosedAt).toBeGreaterThanOrEqual(at)
  expect(await ui.find({ type: 'Text', text: /끝난 세션의 결재/ })).toBeFalsy() // 닫으면 칸이 사라진다
  await ui.unmount()
})

test('확인(초록)을 누르면 확인 칸만 닫는다. 2개 이상이면 모두 확인이 있다', async ($, on) => {
  const at = LIVE()
  const files: Record<string, string> = {
    'r1.json': file('r1', { report: { lines: ['a 끝'], at } }),
    'r2.json': file('r2', { report: { lines: ['b 끝'], at } }),
    'r3.json': file('r3', { report: { lines: ['c 끝'], at }, ask: { kind: 'notice', question: '같이 있는 알림', background: [], options: [], at } }),
  }
  fakeBoard(on, files)
  await $.session.start(START)
  const ui = await mount($)
  expect(await ui.find({ type: 'Button', text: /2개 모두 확인/ })).toBeTruthy()
  await ui.press({ key: 'nm:r2' })
  await ui.press({ key: 'ack:r2' })
  expect(JSON.parse(files['r2.json']!).reportClosedAt).toBeGreaterThanOrEqual(at)
  await ui.press({ key: 'nm:r3' })
  await ui.press({ key: 'ack:r3' })
  expect(JSON.parse(files['r3.json']!)).toMatchObject({ ask: { question: '같이 있는 알림' } }) // 알림은 그대로
  expect(JSON.parse(files['r3.json']!).reportClosedAt).toBeGreaterThan(0)
  expect(JSON.parse(files['r3.json']!).askClosedAt).toBe(0)
  await ui.unmount()
})

test('같은 프로젝트의 새 결재가 오면 패널을 열고 토스트로 알린다. 같은 결재는 한 번만이다', async ($, on) => {
  const at = LIVE()
  const files: Record<string, string> = { 'a.json': file('a', { root: 'c:/work/p', ask: { kind: 'request', question: '결재', background: [], options: [], at } }), 'z.json': file('z', { root: 'c:/other', ask: { kind: 'request', question: '다른 프로젝트', background: [], options: [], at } }) }
  const seen = fakeBoard(on, files)
  await $.session.start(START)
  await new Promise(r => setTimeout(r, 10)) // 토스트는 기다리지 않고 부른다
  expect(seen.toasts).toEqual(['세션 보드에 결재·알림 1개가 왔다']) // 다른 프로젝트는 알리지 않는다
  const opens = seen.opens
  await $.session.start(START) // 다시 읽어도 같은 결재로 또 열지 않는다
  await new Promise(r => setTimeout(r, 10))
  expect(seen.toasts.length).toBe(1)
  expect(seen.opens).toBe(opens + 1) // 시작 때의 열기 1번만
})

test('내 기록을 다시 쓸 때 다른 세션의 패널이 쓴 닫은 시각을 잃지 않는다', async ($, on) => {
  const files: Record<string, string> = {}
  fakeBoard(on, files)
  await $.session.start(START)
  files['me.json'] = JSON.stringify({ ...JSON.parse(files['me.json']!), askClosedAt: 777, reportClosedAt: 555 })
  await $.tool.call({ tool: 'TodoWrite', todos: [] } as any)
  expect(JSON.parse(files['me.json']!)).toMatchObject({ askClosedAt: 777, reportClosedAt: 555 })
})

test('세션 끝: 사용자가 끝내면 결재·알림을 닫고, 앱 종료는 칸을 남긴다', async ($, on) => {
  const files: Record<string, string> = {}
  fakeBoard(on, files)
  on('session.end', (_, e: any) => ({ sessionId: e.sessionId }))
  await $.session.start(START)
  await turnOf($)('결재: 남는가?\n확인: 끝')
  await $.session.end({ sessionId: 'me', reason: 'other' } as any)
  expect(JSON.parse(files['me.json']!)).toMatchObject({ state: 'ended', ask: { question: '남는가?' } })
  await $.session.start(START) // 다시 열면 칸을 이어받는다
  expect(JSON.parse(files['me.json']!)).toMatchObject({ ask: { question: '남는가?' }, report: { lines: ['끝'] } })
  await $.session.end({ sessionId: 'me', reason: 'prompt_input_exit' } as any)
  expect(JSON.parse(files['me.json']!)).toMatchObject({ state: 'ended', ask: null, report: { lines: ['끝'] } }) // 확인은 눌러야 닫힌다
})

test('읽지 못한 기록 파일은 오류 줄로 보이고 닫기로 지운다', async ($, on) => {
  const seen = fakeBoard(on, { 'broken.json': '{ not json' })
  await $.session.start(START)
  const ui = await mount($)
  expect((await ui.find({ type: 'Text', text: /읽지 못했다: broken\.json/ }))?.text).toBeDefined()
  await ui.press({ key: 'x:broken.json' })
  expect(seen.ran.at(-1)?.slice(0, 3)).toEqual(['cmd', '/c', 'del'])
  await ui.unmount()
})
