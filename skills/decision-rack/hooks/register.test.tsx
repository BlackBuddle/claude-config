import { expect, test } from 'claude-code/testing'
import { ageText, lastTurn, rackFirst, signalsOf, statusText } from './register'

const PANE = {
  plugin: 'decision-rack',
  component: 'Pane',
  requestId: 'approval-box',
  props: {
    title: '결재함',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const SESSION = 'ab12cd34-0000-4000-8000-000000000000'
const WAIT = 'ab12cd34-wait.json'
const REPORT = 'ab12cd34-report.json'
const LINK = 'claude://claude.ai/epitaxy/local_ab-12'
const name = (path: unknown) => String(path).split(/[\\/]/).pop() ?? ''
const parsed = (files: Record<string, string>, file: string) => JSON.parse(files[file] ?? '{}')
const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

// 가짜 대기열 폴더. 쓰기는 파일 내용과 수정 시각을 바꾼다. transcript는 이 세션의 대화 기록이다
function fakeQueue(on: On, files: Record<string, string>) {
  let clock = 1
  const mtimes: Record<string, number> = Object.fromEntries(
    Object.keys(files).map(file => [file, clock]),
  )
  const opened: string[] = []
  const ran: string[][] = []
  const listed: string[] = []
  const time = { now: 100000 }
  const transcript: unknown[] = []
  // 도구가 실행되는 동안의 기다림 칸 상태 (선택 카드가 떠 있는 동안)
  const during: unknown[] = []
  on('clock.now', () => ({ value: time.now }))
  // 주기 타이머를 만든 횟수와 파일별 읽기 횟수 (검토 7번, 10번)
  const counts = { timers: 0, reads: {} as Record<string, number> }
  on('clock.every', () => {
    counts.timers += 1

    return { value: {} as never }
  })
  on('command.register', () => ({ value: { command: 'decisions' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: '/Proj' }))
  on('session.messages', () => ({ value: transcript as never }))
  // 앱 세션의 환경 변수. parent는 이 세션을 띄운 부모 세션의 번호다 (앱이 연 세션에는 없다)
  const env: { parent?: string } = {}
  on('env.get', (_, e) => ({
    value:
      e.name === 'CLAUDE_CODE_HOST_SESSION_ID'
        ? 'local_abc'
        : e.name === 'CLAUDE_CODE_SESSION_ID'
          ? env.parent
          : 'C:/Users/x',
  }))
  on('ui.open', (_, e) => {
    opened.push(`open:${e.columns}`)

    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_, e) => {
    opened.push(`toast:${e.text}`)

    return { value: {} as never }
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.list', (_, e) => {
    listed.push(String(e.path))

    return {
      value: Object.keys(files).map(file => ({
        name: file,
        kind: 'file' as const,
        size: 1,
        mtimeMs: mtimes[file] ?? 0,
        isLink: false,
      })),
    }
  })
  on('fs.read', (_, e) => {
    counts.reads[name(e.path)] = (counts.reads[name(e.path)] ?? 0) + 1

    return { value: files[name(e.path)] as never }
  })
  on('fs.write', (_, e) => {
    files[name(e.path)] = e.text
    mtimes[name(e.path)] = ++clock

    return { value: undefined as never }
  })
  on('process.run', (_, e) => {
    // 프로젝트를 찾는 git 호출은 세지 않는다
    if (e.argv[0] === 'rundll32') ran.push([...e.argv])

    return { value: { exitCode: 0, stdout: '', stderr: '' } as never }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => {
    during.push(files[WAIT] === undefined ? undefined : parsed(files, WAIT).state)

    return { result: {} }
  })
  const touch = (file: string, text: string) => {
    files[file] = text
    mtimes[file] = ++clock
  }

  return { files, opened, ran, listed, time, transcript, during, touch, counts, env }
}

const unitText = (extra: object = {}) =>
  JSON.stringify({
    state: 'waiting',
    raisedAt: 1,
    kind: 'request',
    question: 'DB를 바꾸는가?',
    background: [],
    options: ['유지한다', '바꾼다'],
    project: 'Beot',
    root: '/other',
    session: 'other-session',
    ...extra,
  })

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]

function turnOf($: Engine) {
  return (answer: string, extra: object = {}) =>
    $.turn.complete({
      answer,
      reason: 'answer',
      durationMs: 1,
      isAborted: false,
      turnId: 't',
      ...extra,
    } as never)
}

const userSays = { origin: { kind: 'composer' } }
const taskSays = { origin: { kind: 'task-notification' } }

test('신호 해석: 결재·알림·물음표·확인·코드 울타리 (시험 1~4, 16의 계산)', async () => {
  expect(signalsOf('보고.\n- **결재: DB를 바꾼다**')).toMatchObject({
    kind: 'request',
    lines: ['DB를 바꾼다'],
  })
  expect(signalsOf('알림: 노력 수준을 high로 바꾼다').kind).toBe('notice')
  // 물음표 줄은 다른 신호가 없을 때만 쓴다
  expect(signalsOf('끝냈다.\n1. push하는가?')).toMatchObject({ kind: 'notice', lines: ['push하는가?'] })
  expect(signalsOf('결재: 표를 지운다\n괜찮은가?').lines).toEqual(['표를 지운다'])
  expect(signalsOf('작업을 끝냈다.\n테스트: 5/5 통과.').kind).toBe(undefined)
  // 확인 줄은 기다림이 아니다. 같은 줄은 1번만
  expect(signalsOf('확인: 이름을 정했다\n확인: 이름을 정했다')).toMatchObject({
    kind: undefined,
    reports: ['이름을 정했다'],
  })
  // 코드 울타리 안의 표시는 신호가 아니다
  expect(signalsOf('예시:\n```\n결재: 가짜\n```\n끝냈다.').kind).toBe(undefined)
  // 답하지 않은 선택 카드, 결재: 로 시작하는 질문 상자
  const card = (text?: string) => ({
    tool_use_id: 'c',
    tool: 'AskUserQuestion',
    input: { questions: [{ question: '어느 DB인가?', options: [{ label: 'SQLite' }, { label: 'JSON' }] }] },
    text,
  })
  expect(signalsOf('', [card()])).toMatchObject({ kind: 'notice', options: ['SQLite', 'JSON'] })
  expect(signalsOf('', [card('SQLite')]).kind).toBe(undefined)
  const box = {
    tool_use_id: 'w',
    tool: 'mcp__ccd_turn__wrap_up',
    input: { recap: '끝', ask: '결재: push하는가?', actions: [{ label: 'push' }, { action: 'commit' }] },
  }
  expect(signalsOf('끝냈다.', [box])).toMatchObject({
    kind: 'request',
    lines: ['push하는가?'],
    options: ['push'],
  })

  expect(ageText(100000, 0)).toBe('')
  expect(ageText(1000000, 1000000 - 3 * 60000)).toBe('3분 전')
  expect(ageText(1000000 + 2 * 3600000, 1000000)).toBe('2시간 전')
})

test('턴 끝 판정: 결재·알림·물음표가 칸이 된다. 신호 없는 사용자 턴은 닫는다 (시험 1~3, 5, 16)', async ($, on) => {
  const { files } = fakeQueue(on, {})
  await $.session.start(START)
  const turn = turnOf($)

  await turn('보고.\n결재: DB를 바꾼다\n- 표가 3개다')
  expect(parsed(files, WAIT)).toMatchObject({
    state: 'waiting',
    kind: 'request',
    question: 'DB를 바꾼다',
    project: 'Proj',
    root: '/proj',
    session: SESSION,
    link: 'claude://claude.ai/epitaxy/local_abc',
  })

  await $.prompt.submit({ text: '바꿔', ...userSays } as never)
  await turn('알림: 노력 수준을 high로 바꾼다')
  expect(parsed(files, WAIT)).toMatchObject({ state: 'waiting', kind: 'notice' })

  await $.prompt.submit({ text: '바꿨다', ...userSays } as never)
  await turn('끝냈다.\npush하는가?')
  expect(parsed(files, WAIT)).toMatchObject({ kind: 'notice', question: 'push하는가?' })

  // 사용자의 답 뒤에 신호 없이 끝났다: 닫는다. 코드 울타리 안의 결재: 는 신호가 아니다
  await $.prompt.submit({ text: '해', ...userSays } as never)
  await turn('push했다.\n```\n결재: 예시\n```')
  expect(parsed(files, WAIT).state).toBe('closed')
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})

test('표시 줄은 턴 중간의 글에서도 찾는다. 물음표 줄은 마지막 답에서만 (실화면 5번 X의 고침)', async ($, on) => {
  const { files, transcript } = fakeQueue(on, {})
  await $.session.start(START)
  transcript.push(
    { role: 'user', text: '해 줘', toolUses: [] },
    { role: 'assistant', text: '확인: 시험을 엔진 타입으로 대신했다\n중간 질문인가?', toolUses: [] },
    { role: 'assistant', text: '끝냈다.', toolUses: [] },
  )
  await turnOf($)('끝냈다.')
  expect(parsed(files, REPORT).lines).toEqual(['시험을 엔진 타입으로 대신했다'])
  expect(files[WAIT]).toBe(undefined)
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})

test('터미널 세션의 칸에는 물려받은 앱 세션 주소를 쓰지 않는다', async ($, on) => {
  const { files } = fakeQueue(on, {})
  await $.session.start({ ...START, surface: 'terminal' })
  await turnOf($)('끝냈다.\n시험인가?')
  expect(parsed(files, WAIT).state).toBe('waiting')
  expect('link' in parsed(files, WAIT)).toBe(false)
  await (await $.ui.mount({ ...PANE, surface: 'terminal' })).unmount()
})

test('확인 줄은 확인 칸에만 더한다. 같은 줄은 두 번 더하지 않는다 (시험 4)', async ($, on) => {
  const { files } = fakeQueue(on, {})
  await $.session.start(START)
  const turn = turnOf($)

  await turn('확인: 이름을 settings.py로 했다')
  expect(files[WAIT]).toBe(undefined)
  expect(parsed(files, REPORT)).toMatchObject({ state: 'waiting', kind: 'report', lines: ['이름을 settings.py로 했다'] })
  await turn('확인: 이름을 settings.py로 했다\n확인: 표를 2개로 나눴다')
  expect(parsed(files, REPORT).lines).toEqual(['이름을 settings.py로 했다', '표를 2개로 나눴다'])

  // 닫힌 확인 칸은 빈 목록에서 새로 시작한다
  files[REPORT] = JSON.stringify({ ...parsed(files, REPORT), state: 'closed' })
  await turn('확인: 시험을 더했다')
  expect(parsed(files, REPORT)).toMatchObject({ state: 'waiting', lines: ['시험을 더했다'] })
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})

test('사용자 입력이 아닌 턴과 하위 에이전트의 턴은 칸을 닫지 않는다 (시험 6, 7, 8)', async ($, on) => {
  const { files } = fakeQueue(on, {})
  await $.session.start(START)
  const turn = turnOf($)
  await turn('결재: DB를 바꾼다')

  // 백그라운드 작업의 알림은 사용자의 답이 아니다: busy가 아니고, 신호 없이 끝나도 그대로다
  await $.prompt.submit({ text: '<task>', ...taskSays } as never)
  expect(parsed(files, WAIT).state).toBe('waiting')
  await turn('작업이 끝났다.')
  expect(parsed(files, WAIT).state).toBe('waiting')

  // 하위 에이전트의 턴은 판정하지 않는다
  await $.prompt.submit({ text: '바꿔', ...userSays } as never)
  expect(parsed(files, WAIT).state).toBe('busy')
  await turn('작업을 끝냈다.', { agentId: 'sub' })
  expect(parsed(files, WAIT).state).toBe('busy')
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})

test('중단된 턴은 busy를 waiting으로 되돌린다 (시험 9)', async ($, on) => {
  const { files } = fakeQueue(on, {})
  await $.session.start(START)
  const turn = turnOf($)
  await turn('결재: DB를 바꾼다')
  const raisedAt = parsed(files, WAIT).raisedAt

  await $.prompt.submit({ text: '바꿔', ...userSays } as never)
  expect(parsed(files, WAIT).state).toBe('busy')
  await turn('', { reason: 'aborted', isAborted: true })
  expect(parsed(files, WAIT)).toMatchObject({ state: 'waiting', raisedAt })
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})

test('사용자가 끝낸 세션만 기다림 칸을 닫는다. 확인 칸은 그대로다 (시험 10)', async ($, on) => {
  const { files } = fakeQueue(on, {})
  await $.session.start(START)
  await turnOf($)('결재: DB를 바꾼다\n확인: 이름을 정했다')
  const resume = { sessionId: SESSION, resume: {} } as never

  await $.session.end({ reason: 'other', ...(resume as object) } as never)
  expect(parsed(files, WAIT).state).toBe('waiting')
  await $.session.end({ reason: 'prompt_input_exit', ...(resume as object) } as never)
  expect(parsed(files, WAIT).state).toBe('closed')
  expect(parsed(files, REPORT).state).toBe('waiting')
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})

test('같은 앱 세션이 새 번호를 받으면 옛 번호의 기다림 칸을 닫는다', async ($, on) => {
  const app = 'claude://claude.ai/epitaxy/local_abc'
  const { files } = fakeQueue(on, {
    'aaaa0000-wait.json': unitText({ session: 'aaaa0000-x', link: app, root: '/proj' }),
    // 다른 앱 세션의 칸과 확인 칸은 그대로다
    'bbbb0000-wait.json': unitText({ session: 'bbbb0000-x', link: LINK }),
    'aaaa0000-report.json': unitText({ kind: 'report', question: undefined, lines: ['a'], session: 'aaaa0000-x', link: app }),
  })
  await $.session.start(START)
  expect(parsed(files, 'aaaa0000-wait.json').state).toBe('closed')
  expect(parsed(files, 'bbbb0000-wait.json').state).toBe('waiting')
  expect(parsed(files, 'aaaa0000-report.json').state).toBe('waiting')
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})

test('세션 시작은 마지막 답으로 다시 판정한다 (시험 11)', async ($, on) => {
  const { files, transcript } = fakeQueue(on, {})
  transcript.push(
    { role: 'user', text: '해 줘', toolUses: [] },
    { role: 'assistant', text: '앞 턴의 결재: 낡은 질문', toolUses: [] },
    { role: 'user', text: '다음', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'r', tool: 'Read', input: {}, text: 'x' }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'r', text: 'x' }] },
    { role: 'assistant', text: '보고.\n결재: 표를 지운다', toolUses: [] },
  )
  await $.session.start(START)
  expect(parsed(files, WAIT)).toMatchObject({ state: 'waiting', kind: 'request', question: '표를 지운다' })
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})

test('선택 카드가 떠 있는 동안 waiting, 답한 뒤 busy (시험 12)', async ($, on) => {
  const { files, during } = fakeQueue(on, {})
  await $.session.start(START)
  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [
      {
        question: '결재: 어느 DB인가?',
        header: 'DB',
        multiSelect: false,
        options: [
          { label: 'SQLite (추천)', description: '' },
          { label: 'JSON', description: '' },
        ],
      },
    ],
  } as never)
  expect(during).toEqual(['waiting'])
  expect(parsed(files, WAIT)).toMatchObject({
    state: 'busy',
    kind: 'request',
    question: '어느 DB인가?',
    options: ['SQLite (추천)', 'JSON'],
  })
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})

test('패널: closed는 숨기고 busy는 흐리게. 확인을 누르면 확인 칸을 닫는다 (시험 13)', async ($, on) => {
  const { files } = fakeQueue(on, {
    // 요약이 3줄이어도 2줄만 보여준다
    '11111111-wait.json': unitText({ background: ['표가 3개다', '표마다 줄이 100개 이하다', '셋째 줄은 보이지 않는다'] }),
    '22222222-wait.json': unitText({ state: 'busy', kind: 'notice', question: '진행 중인 질문' }),
    '33333333-wait.json': unitText({ state: 'closed', question: '끝난 질문' }),
    '44444444-report.json': unitText({ kind: 'report', question: undefined, lines: ['이름을 정했다', '표를 나눴다'] }),
  })
  expect(
    statusText([
      { kind: 'request', state: 'waiting', isBroken: false },
      { kind: 'notice', state: 'busy', isBroken: false },
      { kind: 'report', state: 'waiting', isBroken: false },
    ] as never),
  ).toBe('결재 1 · 확인 1')
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  // 첫 칸(결재)이 펴져 있다. 요약 2줄과 선택지 1줄만 보여준다
  expect(await ui.find({ type: 'Text', text: /^표가 3개다$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /셋째 줄/ })).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /①/ }))?.text).toBe('① 유지한다  ② 바꾼다')
  // 칸의 윗부분은 Client(slot.tsx)가 그린다. 흐림은 그 prop으로 본다
  const props = async (key: string) =>
    ((await ui.find({ key }))?.props as { props?: { isBusy?: boolean } } | undefined)?.props
  expect((await props('slot:22222222-wait'))?.isBusy).toBe(true)
  expect((await props('slot:11111111-wait'))?.isBusy).toBe(false)
  expect(await ui.find({ key: 'slot:33333333-wait' })).toBeFalsy()
  expect(await ui.find({ type: 'Button', key: '11111111-wait:ok' })).toBeFalsy()

  await ui.press({ key: '44444444-report:ok' })
  expect(parsed(files, '44444444-report.json')).toMatchObject({ state: 'closed', lines: ['이름을 정했다', '표를 나눴다'] })
  expect(await ui.find({ type: 'Button', key: '44444444-report:ok' })).toBeFalsy()
  await ui.unmount()
})

test('같은 칸에 raisedAt이 바뀌면 다시 알린다 (시험 14)', async ($, on) => {
  const { opened, touch } = fakeQueue(on, {
    '55555555-wait.json': unitText({ root: '/proj' }),
    // 다른 프로젝트의 칸은 알리지 않는다
    '66666666-wait.json': unitText(),
  })
  await $.session.start(START)
  expect(opened.filter(line => line.startsWith('toast'))).toEqual(['toast:결재함에 1개가 왔다'])

  // 같은 기다림은 다시 알리지 않는다
  touch('55555555-wait.json', unitText({ root: '/proj', question: '고친 질문' }))
  await $.command.run({ command: 'decisions' } as never)
  expect(opened.filter(line => line.startsWith('toast')).length).toBe(1)

  touch('55555555-wait.json', unitText({ root: '/proj', raisedAt: 2 }))
  await $.command.run({ command: 'decisions' } as never)
  expect(opened.filter(line => line.startsWith('toast')).length).toBe(2)
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})

test('v2 폴더의 이름 모양이 맞는 파일만 읽는다 (시험 15)', async ($, on) => {
  const { listed } = fakeQueue(on, {
    'Beot-1.json': unitText({ question: '판 1의 칸' }),
    'ab12cd34-wait.json.bak': unitText({ question: '백업' }),
    'AB12CD34-wait.json': unitText({ question: '대문자' }),
  })
  await $.session.start(START)
  expect(listed.every(dir => dir.split(/[\\/]/).join('/') === 'C:/Users/x/.claude/decisions/v2')).toBe(true)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /기다리는 세션이 없다/ })).toBeTruthy()
  await ui.unmount()
})

test('칸을 누르면 펴진다. 펴진 칸을 다시 누르면 그 세션으로 이동한다', async ($, on) => {
  const { ran, time } = fakeQueue(on, {
    // 형식이 다른 주소는 OS에 넘기지 않는다
    '77777777-wait.json': unitText({ link: `${LINK} & calc` }),
    '88888888-wait.json': unitText({ link: LINK }),
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const click = async (slot: string) => {
    await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: slot })
    await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: slot })
  }

  // 처음에 77777777이 펴져 있다. 눌러도 이동하지 않는다
  await click('slot:77777777-wait')
  // 첫 클릭은 펴기다
  await click('slot:88888888-wait')
  expect(ran).toEqual([])
  // 더블 클릭의 두 번째 클릭은 이동이 아니다
  time.now += 100
  await click('slot:88888888-wait')
  expect(ran).toEqual([])
  time.now += 2000
  await click('slot:88888888-wait')
  expect(ran).toEqual([['rundll32', 'url.dll,FileProtocolHandler', LINK]])
  await ui.unmount()
})

test('띠의 글은 0이 아닌 종류만 쓴다. 상태 줄은 지운다. 패널이 열려 있으면 띠가 없다', async ($, on) => {
  const unit = (kind: string) => ({ kind, state: 'waiting', isBroken: false }) as never
  expect(statusText([unit('request'), unit('report'), unit('report')])).toBe('결재 1 · 확인 2')
  expect(statusText([unit('notice')])).toBe('알림 1')
  expect(statusText([])).toBe(undefined)

  const statuses: unknown[] = []
  // mod가 그리지 않고 넘긴 요청은 엔진 대신 이 훅이 받는다
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box key="engine" />
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)

    return { value: undefined as never }
  })
  fakeQueue(on, { '99999999-wait.json': unitText() })
  await $.session.start(START)
  // 개수는 상태 줄이 아니라 프롬프트 위 띠에 쓴다. 이전 판이 남긴 상태 줄 글은 지운다
  expect(statuses).toEqual([undefined])
  // 패널이 열려 있으면 띠를 그리지 않는다
  // shortcut: 시험 도구는 "사용자가 패널을 닫았다"를 만들지 못한다. 닫은 뒤의 띠는 실제 화면에서 확인한다
  const band = await $.ui.mount({
    plugin: 'decision-rack',
    component: 'AbovePrompt',
    surface: 'desktop',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  } as never)
  expect(await band.find({ type: 'Button', key: 'open-rack' })).toBeFalsy()
  await band.unmount()
  // 시험이 끝나기 전에 패널을 붙였다 뗀다. 그래야 남은 주기 작업이 거절을 남기지 않는다
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})

test('검토 고침: 인라인 코드 속 표시는 신호가 아니다. 턴 중간 알림이 턴을 자르지 않는다. 띠 순서', async () => {
  // 2번: 표시 줄을 설명하는 글은 신호가 아니다. 진짜 신호의 백틱은 칸에서 뗀다
  expect(signalsOf('규칙:\n- `결재:` 줄을 쓴다\n- `확인:` 줄을 쓴다')).toMatchObject({
    kind: undefined,
    reports: [],
  })
  expect(signalsOf('결재: `a.py`를 지운다').lines).toEqual(['a.py를 지운다'])
  // 5번: turn.start의 메시지 수가 있으면 턴 안에 끼어든 알림 앞의 글도 본다
  const messages = [
    { role: 'user', text: '해 줘', toolUses: [] },
    { role: 'assistant', text: '확인: 이름을 정했다', toolUses: [] },
    { role: 'user', text: '<task-notification>', toolUses: [] },
    { role: 'assistant', text: '끝냈다.', toolUses: [] },
  ] as never
  expect(lastTurn(messages, 1).allText).toContain('확인: 이름을 정했다')
  expect(lastTurn(messages).allText).not.toContain('확인: 이름을 정했다')
  // 8번: 결재함 줄만 맨 위로. 나머지 순서는 그대로
  const rows = [{ plugin: 'ponytail' }, { plugin: 'other' }, { plugin: 'decision-rack' }]
  expect(rackFirst(rows).map(row => row.plugin)).toEqual(['decision-rack', 'ponytail', 'other'])
})

test('검토 고침: 사용자 턴 안의 작업 알림, 알림 턴의 선택 카드 답 뒤에도 신호 없는 턴은 칸을 닫는다', async ($, on) => {
  const { files } = fakeQueue(on, {})
  await $.session.start(START)
  const turn = turnOf($)

  // 1번: 사용자 입력 뒤에 작업 알림이 끼어들어도 사용자 턴이다
  await turn('결재: DB를 바꾼다')
  await $.prompt.submit({ text: '바꿔', ...userSays } as never)
  await $.prompt.submit({ text: '<task>', ...taskSays } as never)
  await turn('바꿨다.')
  expect(parsed(files, WAIT).state).toBe('closed')

  // 3번: 작업 알림으로 시작한 턴에서 선택 카드에 답했다
  await $.prompt.submit({ text: '<task>', ...taskSays } as never)
  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [
      {
        question: '어느 쪽인가?',
        header: 'x',
        multiSelect: false,
        options: [
          { label: 'A', description: '' },
          { label: 'B', description: '' },
        ],
      },
    ],
  } as never)
  expect(parsed(files, WAIT).state).toBe('busy')
  await turn('A로 했다.')
  expect(parsed(files, WAIT).state).toBe('closed')
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})

test('검토 고침: 세션 시작은 진행 중 칸을 다시 판정하지 않는다. 타이머는 1개. 바뀌지 않은 파일은 다시 읽지 않는다', async ($, on) => {
  const { files, transcript, counts } = fakeQueue(on, {
    [WAIT]: unitText({ state: 'busy', session: SESSION, root: '/proj', raisedAt: 5 }),
    '12345678-wait.json': unitText(),
  })
  transcript.push(
    { role: 'user', text: '해 줘', toolUses: [] },
    { role: 'assistant', text: '하는 중이다. 결재: 중간 글', toolUses: [] },
  )
  // 6번: 진행 중인 턴의 중간 글로 칸을 바꾸지 않는다
  await $.session.start(START)
  expect(parsed(files, WAIT)).toMatchObject({ state: 'busy', raisedAt: 5 })
  // 7번: session.start가 다시 와도 타이머는 1개다
  await $.session.start(START)
  expect(counts.timers).toBe(1)
  // 10번: 강제로 다시 읽어도 바뀌지 않은 파일은 읽지 않는다
  const before = counts.reads['12345678-wait.json']
  await $.command.run({ command: 'decisions' } as never)
  expect(counts.reads['12345678-wait.json']).toBe(before)
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})

test('다른 세션 안에서 띄운 세션은 부모의 앱 주소를 쓰지 않고 부모의 칸을 닫지 않는다', async ($, on) => {
  const app = 'claude://claude.ai/epitaxy/local_abc'
  const { files, env } = fakeQueue(on, {
    'cccc0000-wait.json': unitText({ session: 'cccc0000-parent', link: app, root: '/proj' }),
  })
  env.parent = 'cccc0000-parent'
  await $.session.start(START)
  await turnOf($)('끝냈다.\n시험인가?')
  expect(parsed(files, WAIT).state).toBe('waiting')
  expect('link' in parsed(files, WAIT)).toBe(false)
  expect(parsed(files, 'cccc0000-wait.json').state).toBe('waiting')
  await (await $.ui.mount({ ...PANE, surface: 'desktop' })).unmount()
})
