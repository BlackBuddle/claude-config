import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'decision-rack',
  component: 'Pane',
  requestId: 'decision-rack',
  props: {
    title: '결정 랙',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const SESSION = 'session-1'
const DIR = 'C:/Users/x/.claude/decisions'
const name = (path: unknown) => String(path).split(/[\\/]/).pop() ?? ''

// 가짜 대기열 폴더. 쓰기는 파일 내용과 수정 시각을 바꾼다
type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

function fakeQueue(on: On, files: Record<string, string>) {
  let clock = 1
  const mtimes: Record<string, number> = Object.fromEntries(
    Object.keys(files).map(file => [file, clock]),
  )
  const submitted: string[] = []
  const contexts: string[] = []
  const time = { now: 0 }
  on('clock.now', () => ({ value: time.now }))
  on('command.register', () => ({ value: { command: 'decisions' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: '/Proj' }))
  on('clock.every', () => ({ value: {} as never }))
  on('env.get', (_, e) => ({
    value: e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_abc' : 'C:/Users/x',
  }))
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
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    contexts.push(...(e.context ?? []))

    return { text: e.text }
  })

  return { files, submitted, contexts, time }
}

const stop = (extra: object = {}) =>
  JSON.stringify({
    project: 'Beot',
    grade: '나',
    question: 'DB를 바꾸는가?',
    options: ['유지한다', '바꾼다'],
    recommend: 1,
    blocked: 'DB 이전',
    ...extra,
  })

test('선택지를 누르면 답이 파일에 쓰인다. 취소하면 지워진다', async ($, on) => {
  const { files, submitted, contexts } = fakeQueue(on, {
    'Beot-1.json': stop(),
    'Beot-2.json': '{ 깨진 파일',
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // 첫 번째 결정 요청 줄은 처음부터 열려 있다 (질문은 slot.tsx가 그린다). 깨진 파일은 오류 칸으로 보인다
  expect(await ui.find({ type: 'Text', text: /멈춘 작업: DB 이전/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /읽지 못했다/ })).toBeTruthy()

  await ui.press({ key: 'Beot-1:0' })
  expect(JSON.parse(files['Beot-1.json'] ?? '').answer).toBe('1번 (유지한다)')
  expect(await ui.find({ type: 'Text', text: /답함 \(받을 세션 없음\) · 1번/ })).toBeTruthy()

  // 이 세션의 다음 입력에 그 결정이 참고 글로 붙는다. 1번만 붙는다
  await $.prompt.submit({ text: '다음 작업' } as never)
  await $.prompt.submit({ text: '그 다음 작업' } as never)
  expect(contexts.length).toBe(1)
  expect(contexts[0]).toContain('Beot Beot-1: DB를 바꾸는가? → 1번 (유지한다)')

  await ui.press({ key: 'Beot-1:undo' })
  expect('answer' in JSON.parse(files['Beot-1.json'] ?? '')).toBe(false)
  // 다른 값은 그대로다
  expect(JSON.parse(files['Beot-1.json'] ?? '').blocked).toBe('DB 이전')
  // 이 세션이 올린 결정이 아니다. 아무것도 넣지 않는다
  expect(submitted).toEqual(['다음 작업', '그 다음 작업'])
  await ui.unmount()
})

test('이 세션이 올린 결정의 답은 이 세션에 1번만 전달된다', async ($, on) => {
  const { files, submitted, time } = fakeQueue(on, {
    'Beot-1.json': stop({ session: SESSION, answer: '2번 (바꾼다)' }),
    'JetDeck-1.json': stop({
      session: 'other-session',
      answer: '',
      link: 'claude://claude.ai/epitaxy/local_ab-12',
    }),
    // 형식이 다른 주소는 버튼으로 그리지 않는다
    'Evil-1.json': stop({ link: 'claude://claude.ai/epitaxy/local_ab & calc' }),
  })
  const ran: string[][] = []
  on('process.run', (_, e) => {
    // 프로젝트를 찾는 git 호출은 세지 않는다
    if (e.argv[0] === 'rundll32') ran.push([...e.argv])

    return { value: { exitCode: 0, stdout: '', stderr: '' } as never }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('결정 Beot-1: 2번 (바꾼다)')
  expect(submitted[0]).not.toContain('JetDeck-1')
  expect(JSON.parse(files['Beot-1.json'] ?? '').delivered).toBe(true)
  expect('delivered' in JSON.parse(files['JetDeck-1.json'] ?? '')).toBe(false)

  // 전달한 칸에는 취소가 없다
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /전달함 · 2번/ })).toBeTruthy()

  const click = async (slot: string) => {
    await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: slot })
    await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: slot })
  }
  // 주소의 형식이 다른 칸은 펴져 있어도 이동하지 않는다 (처음에 Evil-1이 펴져 있다)
  await click('slot:Evil-1')
  // 첫 클릭은 펴기다. 펴진 칸을 다시 누르면 그 세션으로 이동한다
  await click('slot:JetDeck-1')
  expect(ran).toEqual([])
  // 더블 클릭의 두 번째 클릭은 이동이 아니다
  time.now = 100
  await click('slot:JetDeck-1')
  expect(ran).toEqual([])
  time.now = 2000
  await click('slot:JetDeck-1')
  expect(ran).toEqual([
    ['rundll32', 'url.dll,FileProtocolHandler', 'claude://claude.ai/epitaxy/local_ab-12'],
  ])
  await ui.unmount()
})

test('세션이 결정 파일을 쓰면 mod가 세션 번호를 쓴다', async ($, on) => {
  const { files } = fakeQueue(on, {
    // 세션이 답을 직접 써도 mod가 지운다
    'Beot-1.json': stop({ answer: '1번 (유지한다)', delivered: true }),
    'Other-1.json': stop({ root: '/else' }),
  })
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/Beot-1.json`, content: stop() })

  expect(JSON.parse(files['Beot-1.json'] ?? '').session).toBe(SESSION)
  expect('answer' in JSON.parse(files['Beot-1.json'] ?? '')).toBe(false)
  expect('delivered' in JSON.parse(files['Beot-1.json'] ?? '')).toBe(false)
  // 결정 파일의 Edit는 막는다
  const edited = await $.tool.call({
    tool: 'Edit',
    file_path: `${DIR}/Beot-1.json`,
    old_string: 'a',
    new_string: 'b',
  })
  expect('deny' in edited).toBe(true)
  expect(JSON.parse(files['Beot-1.json'] ?? '').link).toBe('claude://claude.ai/epitaxy/local_abc')
  // git이 없으면 세션의 폴더가 프로젝트다
  expect(JSON.parse(files['Beot-1.json'] ?? '').root).toBe('/proj')

  // 패널은 이 프로젝트의 결정을 위에 묶는다
  await $.command.run({ command: 'decisions' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /이 프로젝트 1/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /다른 프로젝트 1/ })).toBeTruthy()
  await ui.unmount()
})
