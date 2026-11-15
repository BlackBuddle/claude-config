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

const FILES: Record<string, string> = {
  'Beot-1.json': JSON.stringify({
    project: 'Beot',
    grade: '나',
    question: 'DB를 바꾸는가?',
    options: ['유지한다', '바꾼다'],
    recommend: 1,
  }),
  'Beot-2.json': '{ 깨진 파일',
}

test('대기열 파일이 랙에 쌓이고, 선택이 입력창에 쓰인다', async ($, on) => {
  const filled: string[] = []
  on('command.register', () => ({ value: { command: 'decisions' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: {} as never }))
  on('env.get',() => ({ value: 'C:/Users/x' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({
    value: Object.keys(FILES).map(name => ({
      name,
      kind: 'file',
      size: 1,
      mtimeMs: 1,
      isLink: false,
    })),
  }))
  // 엔진이 Windows 경로를 역슬래시로 바꿔서 넘긴다
  on('fs.read', (_, e) => ({ value: FILES[String(e.path).split(/[\\/]/).pop() ?? ''] as never }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return { isFilled: true }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // 첫 번째 멈춤 줄은 처음부터 열려 있다
  expect(await ui.find({ type: 'Text', text: /DB를 바꾸는가/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /파일 형식이 틀렸다/ })).toBeTruthy()

  await ui.press({ key: 'Beot-1:0' })
  expect(filled).toEqual(['결정 Beot-1: 1번 (유지한다)\n'])
  expect(await ui.find({ type: 'Text', text: /답함 · 1번 \(유지한다\)/ })).toBeTruthy()
  await ui.unmount()
})
