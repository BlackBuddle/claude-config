import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Decision } from '../types'

const PANE = 'decision-rack'
const TITLE = '결정 랙'
const POLL_MS = 5000
const OPEN_AUTO = ''
const OPTION_HOTKEYS = ['a', 's', 'd']
const QUEUE_SUFFIX = '/.claude/decisions'
// 데스크톱 앱이 세션을 여는 주소. 이 값을 OS에 넘기므로 파일의 값이 정확히 이 형식일 때만 쓴다
const SESSION_LINK = 'claude://claude.ai/epitaxy/'
const SESSION_LINK_FORMAT = /^claude:\/\/claude\.ai\/epitaxy\/local_[0-9a-f-]+$/
const units = atom({ plugin: 'decision-rack', key: 'units' } as const, [], {
  shape: 'units-2',
})
const openId = atom({ plugin: 'decision-rack', key: 'openId' } as const, OPEN_AUTO)
const notes = atom({ plugin: 'decision-rack', key: 'notes' } as const, {})

// ── 계산: 입출력 없음 ──

function slashed(path: string): string {
  return path.replace(/\\/g, '/')
}

function brokenUnit(path: string, why: string): Decision {
  return {
    id: slashed(path).split('/').pop()?.replace(/\.json$/, '') ?? path,
    path,
    project: '?',
    session: '',
    link: '',
    root: '',
    isBlocking: true,
    isBroken: true,
    question: '읽지 못했다',
    options: [],
    recommend: 0,
    reason: why,
    blocked: '',
    answer: '',
    isDelivered: false,
  }
}

function parseDecision(path: string, text: string): Decision {
  try {
    const raw = JSON.parse(text)
    if (typeof raw?.question !== 'string') return brokenUnit(path, 'question이 없다')

    return {
      ...brokenUnit(path, ''),
      project: String(raw.project ?? '?'),
      session: String(raw.session ?? ''),
      link: SESSION_LINK_FORMAT.test(String(raw.link)) ? String(raw.link) : '',
      root: String(raw.root ?? ''),
      isBlocking: raw.grade === '나',
      isBroken: false,
      question: raw.question,
      options: Array.isArray(raw.options) ? raw.options.map(String) : [],
      recommend: Number.isInteger(raw.recommend) ? raw.recommend : 0,
      reason: String(raw.reason ?? ''),
      blocked: String(raw.blocked ?? ''),
      answer: typeof raw.answer === 'string' ? raw.answer : '',
      isDelivered: raw.delivered === true,
    }
  } catch (error) {
    return brokenUnit(path, String(error))
  }
}

// 파일의 다른 값은 그대로 둔다. 값이 undefined인 키는 지운다
function patchDecisionText(text: string, patch: Record<string, unknown>): string {
  return `${JSON.stringify({ ...JSON.parse(text), ...patch }, null, 2)}\n`
}

// 작업을 멈춘 항목(나 등급)을 위에 쌓는다
function byUrgency(a: Decision, b: Decision): number {
  return Number(b.isBlocking) - Number(a.isBlocking) || a.id.localeCompare(b.id)
}

// 고른 칸이 없으면 이 세션이 올린 결정을 먼저 연다. 다른 세션에서 이동해 온 사용자가 그 결정을 바로 본다
function openUnitId(
  stored: string,
  pending: Decision[],
  sessionId: string,
): string | undefined {
  return (
    pending.find(unit => unit.id === stored) ??
    pending.find(unit => unit.session === sessionId) ??
    pending[0]
  )?.id
}

function isMine(unit: Decision, sessionId: string): boolean {
  return unit.session === sessionId && unit.answer !== '' && !unit.isDelivered
}

function deliveryText(answered: Decision[]): string {
  return [
    '[결정 랙] 사용자가 패널에서 결정에 답했다.',
    ...answered.map(
      unit => `- 결정 ${unit.id}: ${unit.answer} (질문: ${unit.question}) 파일: ${unit.path}`,
    ),
    '통합_작업방식 11절대로 한다: 파일의 answer 값을 확인한다. docs/결정_기록.md에 쓴다. 파일을 지운다. 작업을 계속한다.',
  ].join('\n')
}

function noteLine(unit: Decision, answer: string): string {
  return `- ${unit.project} ${unit.id}: ${unit.question} → ${answer}`
}

function noteText(lines: string[]): string {
  return [
    '[결정 랙] 사용자가 이 세션의 패널에서 아래 결정에 답했다. 참고용이다.',
    '답은 결정을 올린 세션에 이미 전달됐다. 이 세션은 전달하지 않는다. 기록도 그 세션이 한다.',
    ...lines,
  ].join('\n')
}

function statusLabel(unit: Decision): string {
  if (unit.isDelivered) return '전달함'

  return unit.session === '' ? '답함 (받을 세션 없음)' : '답함'
}

// ── 입출력: 대기열 폴더 ──

// 폴더가 바뀌지 않으면 파일을 다시 읽지 않는다. 리로드 뒤에는 한 번 다시 읽는다
let lastSignature = '\0'
// 5초 타이머와 클릭 직후의 읽기가 겹쳐도 같은 답을 2번 전달하지 않는다
const sentIds = new Set<string>()

async function queueDir($: EngineInterface): Promise<string> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''

  return `${slashed(home)}${QUEUE_SUFFIX}`
}

// 워크트리의 세션도 같은 프로젝트로 묶는다. 그래서 git의 공용 폴더를 쓴다. git이 없으면 세션의 폴더다
let cachedProject: string | undefined

async function projectKey($: EngineInterface): Promise<string> {
  if (cachedProject !== undefined) return cachedProject
  const root = await $.session.root().catch(() => '')
  const git = await $.process
    .run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root })
    .catch(() => undefined)
  const dir = git?.exitCode === 0 && git.stdout.trim() !== '' ? git.stdout.trim() : root
  cachedProject = slashed(dir).toLowerCase()

  return cachedProject
}

// 도구가 쓰는 파일이 대기열의 결정 파일이면 그 경로를 돌려준다
async function queueFile($: EngineInterface, call: unknown): Promise<string | undefined> {
  const path = slashed(String((call as { file_path?: unknown }).file_path))
  const dir = `${(await queueDir($)).toLowerCase()}/`

  return path.toLowerCase().startsWith(dir) && path.endsWith('.json') ? path : undefined
}

async function patchFile(
  $: EngineInterface,
  path: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await $.fs.write(path, patchDecisionText(await $.fs.read(path), patch))
}

// 이 세션이 올린 결정에 답이 생겼으면 이 세션에 넣는다
async function deliver($: EngineInterface, list: Decision[]): Promise<boolean> {
  const sessionId = await $.session.id()
  const answered = list.filter(unit => isMine(unit, sessionId) && !sentIds.has(unit.id))
  if (answered.length === 0) return false

  for (const unit of answered) sentIds.add(unit.id)
  // 먼저 표시한다. 넣은 뒤에 표시가 실패하면 같은 답을 다시 넣는다
  await Promise.all(answered.map(unit => patchFile($, unit.path, { delivered: true })))
  try {
    await $.prompt.submit({ text: deliveryText(answered) })
  } catch (error) {
    for (const unit of answered) sentIds.delete(unit.id)
    await Promise.all(answered.map(unit => patchFile($, unit.path, { delivered: undefined })))
    throw error
  }

  return true
}

async function refresh($: EngineInterface, isForced = false): Promise<void> {
  const dir = await queueDir($)
  try {
    const entries = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
    const files = entries.filter(f => f.kind === 'file' && f.name.endsWith('.json'))
    const signature = files.map(f => `${f.name}:${f.mtimeMs}`).join('|')
    if (!isForced && signature === lastSignature) return

    const list = await Promise.all(
      files.map(async f => {
        const path = `${dir}/${f.name}`

        return parseDecision(path, await $.fs.read(path).catch(() => ''))
      }),
    )
    await update($, units, () => list.sort(byUrgency))
    lastSignature = signature
    // 전달하면 파일이 바뀐다. 바로 다시 읽어서 패널에 "전달함"을 보여준다
    if (await deliver($, list)) await refresh($, true)
  } catch (error) {
    // 오류를 숨기면 패널이 "결정 없음"으로 보인다. 멈춘 작업을 사용자가 알 수 없다
    lastSignature = '\0'
    await update($, units, () => [brokenUnit(dir, String(error))])
  }
}

// ── 훅 ──

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'decisions',
      description: '결정 랙 패널을 연다',
    })
    await projectKey($)
    await refresh($)
    $.clock.every(POLL_MS, () => void refresh($))
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'decisions' }, async $ => {
    await refresh($, true)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: '결정 랙을 열었다.' }
  })

  // 이 세션의 패널에서 답한 결정을 이 세션의 다음 입력에 붙인다. 총괄 세션의 AI가 추가 턴 없이 결정을 안다
  on('prompt.submit', async ($, e, next) => {
    const lines = Object.values(await read($, notes))
    if (lines.length === 0) return next(e)
    await update($, notes, () => ({}))

    return next({ ...e, context: [...(e.context ?? []), noteText(lines)] })
  })

  // 세션이 결정 파일을 쓰면 그 파일에 이 세션의 번호를 쓴다. 답은 이 번호의 세션에 전달된다
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e)
    const path = await queueFile($, e)
    if (path !== undefined) {
      const hostId = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
      await patchFile($, path, {
        session: await $.session.id(),
        root: await projectKey($),
        link: hostId ? `${SESSION_LINK}${hostId}` : undefined,
        // 답은 사용자가 패널에서 누를 때만 생긴다. 세션이 쓴 답은 지운다
        answer: undefined,
        delivered: undefined,
      }).catch(() => undefined)
    }

    return result
  })

  // Edit로는 답을 써넣을 수 있다. 그래서 결정 파일의 Edit를 막는다
  on('tool.call', { tool: 'Edit' }, async ($, e, next) =>
    (await queueFile($, e)) === undefined
      ? next(e)
      : { deny: '결정 파일은 고치지 않는다. Write로 새로 쓴다. 답은 사용자가 결정 랙 패널에서 고른다.' },
  )

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, units)
    const sessionId = await $.session.id()
    const project = await projectKey($)
    const pending = list.filter(unit => unit.answer === '' && !unit.isBroken)
    const open = openUnitId(await read($, openId), pending, sessionId)
    const own = list.filter(unit => unit.root !== '' && unit.root === project)
    const others = list.filter(unit => !own.includes(unit))

    const choose = (picked: Decision[], answer: string) => async () => {
      await Promise.all(picked.map(unit => patchFile($, unit.path, { answer })))
      // 이 세션이 올린 결정은 전달로 받는다. 참고 글에는 다른 세션의 결정만 넣는다
      const lines = picked
        .filter(unit => unit.session !== sessionId)
        .map(unit => [unit.id, noteLine(unit, answer)])
      await update($, notes, now => ({ ...now, ...Object.fromEntries(lines) }))
      await update($, openId, () => OPEN_AUTO)
      await refresh($, true)
    }

    const cancel = (unit: Decision) => async () => {
      // 그 사이에 전달됐으면 취소하지 않는다
      const now = parseDecision(unit.path, await $.fs.read(unit.path))
      if (!now.isDelivered) await patchFile($, unit.path, { answer: undefined })
      await update($, notes, lines =>
        Object.fromEntries(Object.entries(lines).filter(([id]) => id !== unit.id)),
      )
      await refresh($, true)
    }

    const open1 = (unit: Decision) => () => update($, openId, () => unit.id)

    // 패널의 Link는 claude:// 주소를 열지 않는다. 그래서 OS의 주소 처리기로 연다
    // shortcut: Windows 전용이다. 다른 OS를 쓰게 되면 open/xdg-open을 더한다
    const openSession = (unit: Decision) => () =>
      $.process.run(['rundll32', 'url.dll,FileProtocolHandler', unit.link])

    const detail = (unit: Decision) => (
      <Box flexDirection="column" gap="md" paddingTop="sm">
        {unit.blocked !== '' && <Text dimColor>멈춘 작업: {unit.blocked}</Text>}
        {unit.isBlocking ? (
          <Box flexDirection="column" gap="sm">
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
          </Box>
        ) : (
          <Box flexDirection="row" gap="sm" alignItems="center">
            <Text dimColor>적용함: {unit.options[unit.recommend - 1] ?? '?'}</Text>
            <Button key={`${unit.id}:no`} hotkey="n" onPress={choose([unit], '반대')}>
              반대
            </Button>
          </Box>
        )}
        {unit.reason !== '' && (
          <Text dimColor size="caption">
            추천 이유: {unit.reason}
          </Text>
        )}
      </Box>
    )

    // Button 안의 글자는 색·굵기를 잃는다. 그래서 상태·프로젝트·번호는 Button 밖의 Text로 그린다
    // plain Button은 글자 왼쪽에 안쪽 여백이 있다. Text 줄을 같은 만큼 들여서 왼쪽 선을 맞춘다
    // press가 있으면 프로젝트·번호 줄이 버튼이다: 접힌 칸은 펴고, 펴진 칸은 그 세션으로 이동한다
    const meta = (unit: Decision, press?: () => unknown, suffix = '') => (
      <Box flexDirection="row" gap="sm" alignItems="center" paddingLeft="xs">
        <Text
          color={unit.isBlocking ? 'error' : 'inactive'}
          size="caption"
          weight="semibold"
        >
          {unit.isBroken ? '오류' : unit.isBlocking ? '멈춤' : '사후 보고'}
        </Text>
        {press ? (
          <Button key={`${unit.id}:head`} plain onPress={press}>
            {`${unit.project} ${unit.id}${suffix}`}
          </Button>
        ) : (
          <Text size="caption">
            {unit.project} {unit.id}
          </Text>
        )}
      </Box>
    )

    const slot = (body: RenderChildren) => (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="subtle"
        borderDimColor
        paddingX="md"
        paddingY="sm"
      >
        {body}
      </Box>
    )

    const row = (unit: Decision) => {
      if (unit.isBroken) {
        return slot(
          <Box flexDirection="column" gap="xs" paddingLeft="xs">
            {meta(unit)}
            <Text>{unit.question}</Text>
            <Text dimColor size="caption">
              {unit.reason}
            </Text>
          </Box>,
        )
      }
      if (unit.answer !== '') {
        return slot(
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box paddingLeft="xs">
              <Text dimColor>
                {statusLabel(unit)} · {unit.answer} · {unit.question}
              </Text>
            </Box>
            {!unit.isDelivered && (
              <Button key={`${unit.id}:undo`} plain dimColor onPress={cancel(unit)}>
                취소
              </Button>
            )}
          </Box>,
        )
      }
      const isOpen = open === unit.id
      const head = !isOpen
        ? meta(unit, open1(unit))
        : unit.link !== ''
          ? meta(unit, openSession(unit), ' ↗')
          : meta(unit)

      return slot(
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            {head}
            {!unit.isBlocking && (
              <Button
                key={`${unit.id}:ok`}
                hotkey={isOpen ? 'y' : undefined}
                onPress={choose([unit], '확인')}
              >
                확인
              </Button>
            )}
          </Box>
          {isOpen ? (
            <Box flexDirection="column" paddingLeft="xs" gap="xs">
              <Text weight="semibold" size="heading">
                {unit.question}
              </Text>
              {detail(unit)}
            </Box>
          ) : (
            <Button key={unit.id} plain dimColor={!unit.isBlocking} onPress={open1(unit)}>
              {unit.question}
            </Button>
          )}
        </Box>,
      )
    }

    if (list.length === 0) {
      return (
        <Box padding="md">
          <Text dimColor>
            대기 중인 결정이 없다. 하위 세션이 결정을 올리면 여기에 쌓인다.
          </Text>
        </Box>
      )
    }

    // 묶음 1개: 제목 줄과 칸들. 사후 보고가 2개 이상이면 "모두 확인"을 둔다
    const section = (title: string, rows: Decision[], hotkey?: string) => {
      const pendingReports = rows.filter(unit => !unit.isBlocking && unit.answer === '')

      return (
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text dimColor size="caption" weight="semibold">
              {title} {rows.length}
            </Text>
            {pendingReports.length > 1 && (
              <Button
                key={`confirm-all:${title}`}
                hotkey={hotkey}
                onPress={choose(pendingReports, '확인')}
              >
                {`사후 보고 ${pendingReports.length}개 모두 확인`}
              </Button>
            )}
          </Box>
          {rows.map(row)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding="md" gap="md">
        {own.length > 0 && section('이 프로젝트', own, 'm')}
        {others.length > 0 &&
          section(own.length > 0 ? '다른 프로젝트' : '결정', others, own.length > 0 ? undefined : 'm')}
      </Box>
    )
  })
}
