import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision } from '../types'

const PANE = 'decision-rack'
const TITLE = '결정 랙'
const POLL_MS = 5000
const OPEN_AUTO = ''
const OPEN_NONE = '-'
const OPTION_HOTKEYS = ['a', 's', 'd']
const units = atom({ plugin: 'decision-rack', key: 'units' } as const, [], {
  shape: 'units-1',
})
const openId = atom({ plugin: 'decision-rack', key: 'openId' } as const, OPEN_AUTO)
const answers = atom({ plugin: 'decision-rack', key: 'answers' } as const, {})

// ── 계산: 입출력 없음 ──

function brokenUnit(id: string, why: string): Decision {
  return {
    id,
    project: '?',
    session: '',
    isBlocking: true,
    isBroken: true,
    question: '파일 형식이 틀렸다',
    options: [],
    recommend: 0,
    reason: why,
    blocked: '',
  }
}

function parseDecision(fileName: string, text: string): Decision {
  const id = fileName.replace(/\.json$/, '')
  try {
    const raw = JSON.parse(text)
    if (typeof raw?.question !== 'string') return brokenUnit(id, 'question이 없다')

    return {
      id,
      project: String(raw.project ?? '?'),
      session: String(raw.session ?? ''),
      isBlocking: raw.grade === '나',
      isBroken: false,
      question: raw.question,
      options: Array.isArray(raw.options) ? raw.options.map(String) : [],
      recommend: Number.isInteger(raw.recommend) ? raw.recommend : 0,
      reason: String(raw.reason ?? ''),
      blocked: String(raw.blocked ?? ''),
    }
  } catch (error) {
    return brokenUnit(id, String(error))
  }
}

// 작업을 멈춘 항목(나 등급)을 위에 쌓는다
function byUrgency(a: Decision, b: Decision): number {
  return Number(b.isBlocking) - Number(a.isBlocking) || a.id.localeCompare(b.id)
}

function answerLine(id: string, choice: string): string {
  return `결정 ${id}: ${choice}\n`
}

function openUnitId(stored: string, pending: Decision[]): string | undefined {
  if (stored === OPEN_NONE) return undefined

  return (pending.find(unit => unit.id === stored) ?? pending[0])?.id
}

// ── 입출력: 대기열 폴더 읽기 ──

// 폴더가 바뀌지 않으면 파일을 다시 읽지 않는다. 리로드 뒤에는 한 번 다시 읽는다
let lastSignature = '\0'

async function queueDir($: EngineInterface): Promise<string | undefined> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))

  return home ? `${home}/.claude/decisions` : undefined
}

async function refresh($: EngineInterface): Promise<void> {
  const dir = await queueDir($)
  const entries = dir && (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
  const files = entries.filter(f => f.kind === 'file' && f.name.endsWith('.json'))
  const signature = files.map(f => `${f.name}:${f.mtimeMs}`).join('|')
  if (signature === lastSignature) return

  const list = await Promise.all(
    files.map(async f =>
      parseDecision(f.name, await $.fs.read(`${dir}/${f.name}`).catch(() => '')),
    ),
  )
  const ids = new Set(list.map(unit => unit.id))
  await update($, units, () => list.sort(byUrgency))
  // 총괄 세션이 처리해 파일을 지운 결정의 답은 버린다
  await update($, answers, done =>
    Object.fromEntries(Object.entries(done).filter(([id]) => ids.has(id))),
  )
  lastSignature = signature
}

// ── 화면 ──

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'decisions',
      description: '결정 랙 패널을 연다',
    })
    await refresh($).catch(() => undefined)
    $.clock.every(POLL_MS, () => void refresh($).catch(() => undefined))
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'decisions' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: '결정 랙을 열었다.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, units)
    const done = await read($, answers)
    const pending = list.filter(unit => !(unit.id in done))
    const open = openUnitId(await read($, openId), pending)
    const blocking = list.filter(unit => unit.isBlocking)
    const reports = list.filter(unit => !unit.isBlocking)
    const pendingReports = reports.filter(unit => !(unit.id in done))

    const choose = (picked: Decision[], choice: string) => async () => {
      await $.prompt.fill({
        text: picked.map(unit => answerLine(unit.id, choice)).join(''),
        mode: 'append',
      })
      await update($, answers, now => ({
        ...now,
        ...Object.fromEntries(picked.map(unit => [unit.id, choice])),
      }))
      await update($, openId, () => OPEN_AUTO)
    }

    const cancel = (unit: Decision) => async () => {
      const box = await $.prompt.read()
      await $.prompt.fill({
        text: box.text.replace(answerLine(unit.id, done[unit.id] ?? ''), ''),
        mode: 'replace',
      })
      await update($, answers, now =>
        Object.fromEntries(Object.entries(now).filter(([id]) => id !== unit.id)),
      )
    }

    const toggle = (unit: Decision) => () =>
      update($, openId, () => (open === unit.id ? OPEN_NONE : unit.id))

    const detail = (unit: Decision) => (
      <Box flexDirection="column" gap={1} paddingBottom={1}>
        <Text weight="semibold">{unit.question}</Text>
        {unit.blocked !== '' && <Text dimColor>멈춘 작업: {unit.blocked}</Text>}
        {unit.isBroken && <Text dimColor>{unit.reason}</Text>}
        {unit.isBlocking ? (
          <Box flexDirection="column">
            {unit.options.map((label, i) => {
              const isRecommended = i + 1 === unit.recommend

              return (
                <Button
                  key={`${unit.id}:${i}`}
                  hotkey={OPTION_HOTKEYS[i]}
                  autoFocus={isRecommended || undefined}
                  variant={isRecommended ? 'primary' : 'secondary'}
                  onPress={choose([unit], `${i + 1}번 (${label})`)}
                >
                  {`${i + 1}번 ${label}${isRecommended ? ' · 추천' : ''}`}
                </Button>
              )
            })}
            {unit.reason !== '' && !unit.isBroken && (
              <Text dimColor>추천 이유: {unit.reason}</Text>
            )}
          </Box>
        ) : (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>적용함: {unit.options[unit.recommend - 1] ?? '?'}</Text>
            <Button key={`${unit.id}:no`} hotkey="n" onPress={choose([unit], '반대')}>
              반대
            </Button>
          </Box>
        )}
      </Box>
    )

    const row = (unit: Decision) =>
      unit.id in done ? (
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>
            답함 · {done[unit.id]} · {unit.question}
          </Text>
          <Button key={`${unit.id}:undo`} plain dimColor onPress={cancel(unit)}>
            취소
          </Button>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Button key={unit.id} plain onPress={toggle(unit)}>
              <Text color={unit.isBlocking ? 'error' : 'inactive'} weight="semibold">
                {unit.isBroken ? '오류' : unit.isBlocking ? '멈춤' : '사후 보고'}
              </Text>
              {` ${unit.project} `}
              <Text dimColor mono size="caption">
                {unit.id}
              </Text>
            </Button>
            {!unit.isBlocking && (
              <Button
                key={`${unit.id}:ok`}
                hotkey={open === unit.id ? 'y' : undefined}
                onPress={choose([unit], '확인')}
              >
                확인
              </Button>
            )}
          </Box>
          {open === unit.id ? detail(unit) : <Text dimColor>{unit.question}</Text>}
        </Box>
      )

    if (list.length === 0) {
      return (
        <Text dimColor>
          대기 중인 결정이 없다. 하위 세션이 결정을 올리면 여기에 쌓인다.
        </Text>
      )
    }

    return (
      <Box flexDirection="column">
        <Text dimColor size="caption">
          남음 {pending.length}개. 답을 고르면 입력창에 쓰인다. Enter로 보낸다.
        </Text>
        {blocking.length > 0 && (
          <Text color="error" size="caption">
            멈춤 {blocking.length}
          </Text>
        )}
        {blocking.map(row)}
        {reports.length > 0 && (
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor size="caption">
              사후 보고 {reports.length}
            </Text>
            {pendingReports.length > 1 && (
              <Button key="confirm-all" hotkey="m" onPress={choose(pendingReports, '확인')}>
                {`${pendingReports.length}개 모두 확인`}
              </Button>
            )}
          </Box>
        )}
        {reports.map(row)}
      </Box>
    )
  })
}
