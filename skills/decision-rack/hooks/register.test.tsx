import { expect, test } from 'claude-code/testing'

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

const SESSION = 'session-1'
const DIR = 'C:/Users/x/.claude/decisions'
const LINK = 'claude://claude.ai/epitaxy/local_ab-12'
const name = (path: unknown) => String(path).split(/[\\/]/).pop() ?? ''
const parsed = (files: Record<string, string>, file: string) => JSON.parse(files[file] ?? '{}')

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

// 가짜 대기열 폴더. 쓰기는 파일 내용과 수정 시각을 바꾼다
function fakeQueue(on: On, files: Record<string, string>) {
  let clock = 1
  const mtimes: Record<string, number> = Object.fromEntries(
    Object.keys(files).map(file => [file, clock]),
  )
  const contexts: string[] = []
  const opened: string[] = []
  const ran: string[][] = []
  const time = { now: 100000 }
  // 이 세션의 대화 기록에 있는 Write 호출의 파일 경로
  const wrote: string[] = []
  on('clock.now', () => ({ value: time.now }))
  on('clock.every', () => ({ value: {} as never }))
  on('command.register', () => ({ value: { command: 'decisions' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: '/Proj' }))
  on('session.messages', () => ({
    value: [
      {
        role: 'assistant',
        text: '',
        toolUses: wrote.map(path => ({ tool_use_id: path, tool: 'Write', input: { file_path: path } })),
      },
    ] as never,
  }))
  on('env.get', (_, e) => ({
    value: e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_abc' : 'C:/Users/x',
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
  on('fs.list', () => ({
    value: Object.keys(files).map(file => ({
      name: file,
      kind: 'file' as const,
      size: 1,
      mtimeMs: mtimes[file] ?? 0,
      isLink: false,
    })),
  }))
  on('fs.read', (_, e) => ({ value: files[name(e.path)] as never }))
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
  on('prompt.submit', (_, e) => {
    contexts.push(...(e.context ?? []))

    return { text: e.text }
  })
  on('tool.call', () => ({ result: {} }))

  return { files, contexts, opened, ran, time, wrote }
}

const card = (extra: object = {}) =>
  JSON.stringify({
    project: 'Beot',
    grade: '나',
    question: 'DB를 바꾸는가?',
    options: ['유지한다', '바꾼다'],
    recommend: 1,
    ...extra,
  })

test('칸에 답하는 버튼이 없다. 확인 칸만 확인 버튼으로 내린다', async ($, on) => {
  const { files } = fakeQueue(on, {
    // 요약이 3줄이어도 2줄만 보여준다. 이전 양식의 선택지({ label, effect })는 이름만 쓴다
    'A-1.json': card({
      background: ['- 표가 3개다', '표마다 줄이 100개 이하다', '셋째 줄은 보이지 않는다'],
      options: ['유지한다', { label: '바꾼다', effect: '이전 스크립트가 필요하다' }],
    }),
    'B-1.json': card({ grade: '알림', question: '노력 수준을 high로 바꾼다', options: [] }),
    'C-1.json': card({ grade: '가', question: '이름을 settings.py로 했다' }),
    'D-1.json': '{ 깨진 파일',
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // 첫 칸(결재)이 펴져 있다. 요약 2줄과 선택지 1줄만 보여준다
  expect(await ui.find({ type: 'Text', text: /^표가 3개다$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^표마다 줄이 100개 이하다$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /셋째 줄/ })).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /①/ }))?.text).toBe('① 유지한다 (추천)  ② 바꾼다')
  expect(await ui.find({ type: 'Text', text: /이전 스크립트가 필요하다/ })).toBeFalsy()
  // 결재·알림 칸에는 누르는 선택지가 없다. 결정은 세션에서 한다
  expect(await ui.find({ type: 'Button', key: 'A-1:0' })).toBeFalsy()
  expect(await ui.find({ type: 'Button', key: 'A-1:ok' })).toBeFalsy()
  expect(await ui.find({ type: 'Button', key: 'B-1:ok' })).toBeFalsy()

  // 확인 칸은 확인을 누르면 내려간다. 파일의 다른 값은 그대로다
  await ui.press({ key: 'C-1:ok' })
  expect(parsed(files, 'C-1.json').withdrawn).toBe(true)
  expect(parsed(files, 'C-1.json').question).toBe('이름을 settings.py로 했다')
  expect('withdrawn' in parsed(files, 'A-1.json')).toBe(false)
  expect(await ui.find({ type: 'Button', key: 'C-1:ok' })).toBeFalsy()
  await ui.unmount()
})

test('사용자가 세션에 입력하면 그 세션의 결재와 알림을 내린다. 확인은 내리지 않는다', async ($, on) => {
  const { files, contexts } = fakeQueue(on, {
    'Mine-1.json': card({ session: SESSION }),
    'Mine-2.json': card({ session: SESSION, grade: '알림' }),
    'Mine-3.json': card({ session: SESSION, grade: '가' }),
    'Theirs-1.json': card({ session: 'other-session' }),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // 백그라운드 작업의 알림은 사용자의 답이 아니다. 칸을 내리지 않는다
  await $.prompt.submit({ text: '<task>', origin: { kind: 'task-notification' } } as never)
  expect('withdrawn' in parsed(files, 'Mine-1.json')).toBe(false)
  expect(contexts).toEqual([])

  await $.prompt.submit({ text: '그냥 유지해', origin: { kind: 'sdk' } } as never)
  expect(parsed(files, 'Mine-1.json').withdrawn).toBe(true)
  expect(parsed(files, 'Mine-2.json').withdrawn).toBe(true)
  expect('withdrawn' in parsed(files, 'Mine-3.json')).toBe(false)
  expect('withdrawn' in parsed(files, 'Theirs-1.json')).toBe(false)
  // 세션은 내린 칸의 번호를 받는다. 그 파일을 지운다
  expect(contexts.join('\n')).toContain('결재함에서 내렸다: Mine-1, Mine-2')

  // 내린 칸은 패널에 없다. 남은 칸은 보인다
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'Mine-3:ok' })).toBeTruthy()
  // 확인을 눌러 내린 칸은 세션의 다음 입력 때 알린다
  await ui.press({ key: 'Mine-3:ok' })
  await ui.unmount()
  contexts.length = 0
  await $.prompt.submit({ text: '계속' } as never)
  expect(contexts.join('\n')).toContain('Mine-3')
})

test('세션이 결정 파일을 쓰면 mod가 세션 번호를 쓴다. 늦게 읽은 세션은 자기 칸을 찾는다', async ($, on) => {
  const { files, wrote, opened } = fakeQueue(on, {
    // 세션이 내림 표시를 직접 써도 mod가 지운다
    'New-1.json': card({ withdrawn: true }),
    // 표시가 없는 칸 2개. 이 세션의 대화 기록에는 Old-1의 Write만 있다
    'Old-1.json': card(),
    'Else-1.json': card(),
    // 이 프로젝트의 다른 세션이 올린 결재
    'Sub-1.json': card({ root: '/proj', session: 'sub-session' }),
  })
  wrote.push('C:\\Users\\x\\.claude\\decisions\\Old-1.json')

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // 새 결재가 왔다. 패널이 스스로 열리고 알림이 뜬다
  expect(opened).toEqual(['open:49', 'open:49', 'toast:결재함에 1개가 왔다'])
  expect(parsed(files, 'Old-1.json').session).toBe(SESSION)
  expect(parsed(files, 'Old-1.json').link).toBe('claude://claude.ai/epitaxy/local_abc')
  // git이 없으면 세션의 폴더가 프로젝트다
  expect(parsed(files, 'Old-1.json').root).toBe('/proj')
  expect('session' in parsed(files, 'Else-1.json')).toBe(false)

  await $.tool.call({ tool: 'Write', file_path: `${DIR}/New-1.json`, content: card() })
  expect(parsed(files, 'New-1.json').session).toBe(SESSION)
  expect('withdrawn' in parsed(files, 'New-1.json')).toBe(false)

  // 패널은 이 프로젝트의 칸을 위에 묶는다. 표시가 없는 칸은 이유를 보여준다
  await $.command.run({ command: 'decisions' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /이 프로젝트 3/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /다른 프로젝트 1/ })).toBeTruthy()
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'slot:Else-1' })
  await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'slot:Else-1' })
  expect(await ui.find({ type: 'Text', text: /올린 세션을 모른다/ })).toBeTruthy()
  await ui.unmount()
})

test('칸을 누르면 펴진다. 펴진 칸을 다시 누르면 그 세션으로 이동한다', async ($, on) => {
  const { ran, time } = fakeQueue(on, {
    // 형식이 다른 주소는 OS에 넘기지 않는다
    'Evil-1.json': card({ link: `${LINK} & calc` }),
    'Jet-1.json': card({ session: 'other-session', link: LINK }),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const click = async (slot: string) => {
    await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: slot })
    await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: slot })
  }

  // 처음에 Evil-1이 펴져 있다. 눌러도 이동하지 않는다
  await click('slot:Evil-1')
  // 첫 클릭은 펴기다
  await click('slot:Jet-1')
  expect(ran).toEqual([])
  expect(await ui.find({ type: 'Text', text: /① 유지한다 \(추천\)/ })).toBeTruthy()
  // 더블 클릭의 두 번째 클릭은 이동이 아니다
  time.now += 100
  await click('slot:Jet-1')
  expect(ran).toEqual([])
  time.now += 2000
  await click('slot:Jet-1')
  expect(ran).toEqual([['rundll32', 'url.dll,FileProtocolHandler', LINK]])
  await ui.unmount()
})

test('결재함이 열려 있는 동안에는 입력창 위의 줄을 그리지 않는다', async ($, on) => {
  // mod가 그리지 않은 자리는 앱이 그린다. 시험에서는 이 훅이 앱을 대신한다
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  fakeQueue(on, { 'A-1.json': card(), 'C-1.json': card({ grade: '가' }) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const band = await $.ui.mount({
    plugin: 'decision-rack',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, bodyColumns: 80 },
    surface: 'desktop',
  } as never)
  expect((await band.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await band.unmount()
})
