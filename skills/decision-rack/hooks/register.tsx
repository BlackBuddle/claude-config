import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Decision } from '../types'

// 패널의 제목은 이 번호로 처음 열 때 정해진다. 제목을 바꾸면 이 번호도 바꾼다
const PANE = 'approval-box'
const TITLE = '결재함'
// 처음 열 때의 폭 (글자 칸 수). 요청일 뿐이다: 사용자가 끌어서 바꾼 폭이 있으면 앱은 그 폭을 쓴다
// 49는 사용자가 패널을 끌어 놓은 폭을 잰 값이다 (2026-11-15. 대화 영역이 107칸일 때)
const PANE_COLUMNS = 49
// 취소 시간(3초)과 사라지는 시간(2초)을 지키려면 1초마다 본다. 폴더가 그대로이면 목록 1번만 읽는다
const POLL_MS = 1000
// 답한 뒤 이 시간 동안 취소할 수 있다. 이 시간이 지나야 답을 전달한다
const CANCEL_MS = 3000
// 취소 시간이 끝난 뒤 이 시간 동안 칸을 보여주고 없앤다
const LINGER_MS = 2000
const OPEN_AUTO = ''
const OPTION_HOTKEYS = ['a', 's', 'd']
const QUEUE_SUFFIX = '/.claude/decisions'
// 더블 클릭의 두 번째 클릭을 이동으로 다루지 않는다
const DOUBLE_CLICK_MS = 500
// 데스크톱 앱이 세션을 여는 주소. 이 값을 OS에 넘기므로 파일의 값이 정확히 이 형식일 때만 쓴다
const SESSION_LINK = 'claude://claude.ai/epitaxy/'
const SESSION_LINK_FORMAT = /^claude:\/\/claude\.ai\/epitaxy\/local_[0-9a-f-]+$/
const units = atom({ plugin: 'decision-rack', key: 'units' } as const, [], {
  shape: 'units-2',
})
const openId = atom({ plugin: 'decision-rack', key: 'openId' } as const, OPEN_AUTO)
const notes = atom({ plugin: 'decision-rack', key: 'notes' } as const, {})
const tick = atom({ plugin: 'decision-rack', key: 'tick' } as const, 0)

// ── 계산: 입출력 없음 ──

function slashed(path: string): string {
  return path.replace(/\\/g, '/')
}

// 선택지는 글자 또는 { label, effect }다. 이전 양식(글자)도 그대로 읽는다
function optionPart(option: unknown, part: 'label' | 'effect'): string {
  if (typeof option !== 'object' || option === null) return part === 'label' ? String(option) : ''

  return String((option as Record<string, unknown>)[part] ?? '')
}

// 배경은 글자 1개 또는 줄의 목록이다. 줄 앞의 글머리표는 패널이 그리므로 뗀다
function backgroundLines(raw: unknown): string[] {
  const lines = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split('\n') : []

  return lines.map(line => line.replace(/^\s*[-*•]\s*/, '').trim()).filter(line => line !== '')
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
    effects: [],
    background: [],
    recommend: 0,
    reason: why,
    blocked: '',
    answer: '',
    answeredAt: 0,
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
      options: Array.isArray(raw.options)
        ? raw.options.map((option: unknown) => optionPart(option, 'label'))
        : [],
      effects: Array.isArray(raw.options)
        ? raw.options.map((option: unknown) => optionPart(option, 'effect'))
        : [],
      background: backgroundLines(raw.background),
      recommend: Number.isInteger(raw.recommend) ? raw.recommend : 0,
      reason: String(raw.reason ?? ''),
      blocked: String(raw.blocked ?? ''),
      answer: typeof raw.answer === 'string' ? raw.answer : '',
      answeredAt: Number(raw.answeredAt) || 0,
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

function pendingOf(list: Decision[]): Decision[] {
  return list.filter(unit => unit.answer === '' && !unit.isBroken)
}

function kindLabel(unit: Decision): string {
  if (unit.isBroken) return '오류'

  return unit.isBlocking ? '결재 요청' : '확인 요청'
}

// 이 세션의 사용자가 답해야 하는 새 결재 요청: 이 프로젝트의 것이고, 이 세션이 올린 것이 아니다
function needsAttention(unit: Decision, project: string, sessionId: string): boolean {
  return (
    unit.isBlocking &&
    !unit.isBroken &&
    unit.answer === '' &&
    unit.root !== '' &&
    unit.root === project &&
    unit.session !== sessionId
  )
}

function canCancel(unit: Decision, now: number): boolean {
  return unit.answer !== '' && !unit.isDelivered && now - unit.answeredAt < CANCEL_MS
}

// 취소 시간이 끝난 답만 전달한다
function isMine(unit: Decision, sessionId: string, now: number): boolean {
  return (
    unit.session === sessionId &&
    unit.answer !== '' &&
    !unit.isDelivered &&
    now - unit.answeredAt >= CANCEL_MS
  )
}

// 첫 줄은 규칙(11절)이 찾는 표시다. 바꾸지 않는다
// 처리 방법은 규칙에 있다. 여기에는 결정마다 번호·답·질문만 쓴다. 파일은 대기열 폴더의 <번호>.json이다
function deliveryText(answered: Decision[]): string {
  return [
    '[결재함] 사용자가 패널에서 결정에 답했다.',
    ...answered.flatMap(unit => [
      '',
      `**${unit.id}**: \`${unit.answer}\``,
      `질문: ${unit.question}`,
    ]),
    '',
    '처리: 통합_작업방식 11절 (파일의 answer 확인 → 결정_기록.md → 파일 삭제 → 계속)',
  ].join('\n')
}

function noteLine(unit: Decision, answer: string): string {
  return `- ${unit.project} ${unit.id}: ${unit.question} → ${answer}`
}

function noteText(lines: string[]): string {
  return [
    '[결재함] 사용자가 이 세션의 패널에서 아래 결정에 답했다. 참고용이다.',
    '답은 결정을 올린 세션에 이미 전달됐다. 이 세션은 전달하지 않는다. 기록도 그 세션이 한다.',
    ...lines,
  ].join('\n')
}

// 답한 결정은 취소 시간(3초)과 그 뒤 2초 동안만 보인다. 그 뒤에는 패널에서 없어진다
function isVisible(unit: Decision, now: number): boolean {
  return unit.answer === '' || now - unit.answeredAt < CANCEL_MS + LINGER_MS
}

// ── 입출력: 대기열 폴더 ──

// 폴더가 바뀌지 않으면 파일을 다시 읽지 않는다. 리로드 뒤에는 한 번 다시 읽는다
let lastSignature = '\0'
// 타이머와 클릭 직후의 읽기가 겹쳐도 같은 답을 2번 전달하지 않는다
const sentIds = new Set<string>()

// 1초마다 쓴다. 그래서 한 번만 찾는다
let cachedQueueDir: string | undefined

async function queueDir($: EngineInterface): Promise<string> {
  if (cachedQueueDir !== undefined) return cachedQueueDir
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  cachedQueueDir = `${slashed(home)}${QUEUE_SUFFIX}`

  return cachedQueueDir
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

// 패널의 Link는 claude:// 주소를 열지 않는다. 그래서 OS의 주소 처리기로 연다
// shortcut: Windows 전용이다. 다른 OS를 쓰게 되면 open/xdg-open을 더한다
async function openSessionLink($: EngineInterface, link: string): Promise<void> {
  await $.process.run(['rundll32', 'url.dll,FileProtocolHandler', link])
}

// Client(slot.tsx)를 그리지 못하는 화면에서는 제목 버튼으로 대신한다
let hasClientFault = false
// 이미 알린 결재 요청. 같은 결정으로 패널을 2번 열지 않는다
const announcedIds = new Set<string>()

// 새 결재 요청이 오면 패널을 열고 알린다. 사용자는 명령을 치지 않는다
async function announce($: EngineInterface, list: Decision[]): Promise<void> {
  const project = await projectKey($)
  const sessionId = await $.session.id()
  const fresh = list.filter(
    unit => needsAttention(unit, project, sessionId) && !announcedIds.has(unit.id),
  )
  if (fresh.length === 0) return

  for (const unit of fresh) announcedIds.add(unit.id)
  void $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
  void $.ui.toast(`결재 요청 ${fresh.length}개가 왔다`)
}

// 방금 편 칸과 그 시각. 접힌 칸을 더블 클릭해도 이동하지 않게 한다
let lastOpened = { id: '', at: 0 }

async function patchFile(
  $: EngineInterface,
  path: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await $.fs.write(path, patchDecisionText(await $.fs.read(path), patch))
}

// 결정 파일에 쓰는 "올린 세션"의 표시: 답을 받을 세션, 프로젝트, 앱에서 여는 주소
async function ownerStamp($: EngineInterface): Promise<Record<string, unknown>> {
  const hostId = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')

  return {
    session: await $.session.id(),
    root: await projectKey($),
    link: hostId ? `${SESSION_LINK}${hostId}` : undefined,
  }
}

// 이미 확인한 표시 없는 결정. 대화 기록을 결정마다 1번만 읽는다
const claimCheckedIds = new Set<string>()

// 표시가 없는 결정 중에서 이 세션이 쓴 것을 찾아 표시한다
// mod를 읽기 전에 시작한 세션은 파일을 쓸 때 표시하지 못한다. mod를 다시 읽은 뒤에 여기서 채운다
async function claimUnowned($: EngineInterface, list: Decision[]): Promise<boolean> {
  const unowned = list.filter(
    unit => unit.session === '' && !unit.isBroken && !claimCheckedIds.has(unit.id),
  )
  if (unowned.length === 0) return false

  for (const unit of unowned) claimCheckedIds.add(unit.id)
  const written = new Set(
    (await $.session.messages())
      .flatMap(message => message.toolUses)
      .filter(use => use.tool === 'Write' && !use.isError)
      .map(use => slashed(String(use.input.file_path)).toLowerCase()),
  )
  const mine = unowned.filter(unit => written.has(slashed(unit.path).toLowerCase()))
  if (mine.length === 0) return false

  const stamp = await ownerStamp($)
  await Promise.all(mine.map(unit => patchFile($, unit.path, stamp)))

  return true
}

// 이 세션이 올린 결정에 답이 생겼으면 이 세션에 넣는다
async function deliver($: EngineInterface, list: Decision[], now: number): Promise<boolean> {
  const sessionId = await $.session.id()
  const due = list.filter(unit => isMine(unit, sessionId, now) && !sentIds.has(unit.id))
  if (due.length === 0) return false

  // 목록은 최대 1초 전의 것이다. 그 사이에 사용자가 취소했으면 전달하지 않는다
  const current = await Promise.all(
    due.map(async unit => parseDecision(unit.path, await $.fs.read(unit.path).catch(() => ''))),
  )
  const answered = current.filter(unit => isMine(unit, sessionId, now))
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

// 마지막으로 읽은 목록. 폴더가 그대로인 동안에도 시간에 따른 일(전달, 사라지기)을 한다
let lastList: Decision[] = []
// 앞의 읽기가 1초 안에 끝나지 않으면 타이머의 읽기가 겹친다. 겹친 읽기는 건너뛴다
let isRefreshing = false

async function refresh($: EngineInterface, isForced = false): Promise<void> {
  const dir = await queueDir($)
  try {
    const entries = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
    const files = entries.filter(f => f.kind === 'file' && f.name.endsWith('.json'))
    const signature = files.map(f => `${f.name}:${f.mtimeMs}`).join('|')
    if (isForced || signature !== lastSignature) {
      const list = await Promise.all(
        files.map(async f => {
          const path = `${dir}/${f.name}`

          return parseDecision(path, await $.fs.read(path).catch(() => ''))
        }),
      )
      lastList = list.sort(byUrgency)
      await update($, units, () => lastList)
      lastSignature = signature
      // 표시하면 파일이 바뀐다. 바로 다시 읽는다
      if (await claimUnowned($, lastList)) return await refresh($, true)
      await announce($, lastList)
    }
    const now = await $.clock.now()
    // 전달하면 파일이 바뀐다. 바로 다시 읽는다
    if (await deliver($, lastList, now)) return await refresh($, true)
    // 답한 칸이 보이는 동안에는 패널을 다시 그린다: 취소 버튼이 없어지고, 칸이 사라진다
    const isSettling = lastList.some(unit => unit.answer !== '' && isVisible(unit, now - POLL_MS))
    if (isSettling) await update($, tick, count => count + 1)
  } catch (error) {
    // 오류를 숨기면 패널이 "결정 없음"으로 보인다. 멈춘 작업을 사용자가 알 수 없다
    lastSignature = '\0'
    lastList = []
    await update($, units, () => [brokenUnit(dir, String(error))])
  }
}

// ── 훅 ──

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'decisions',
      description: '결재함 패널을 연다',
    })
    // 결재함은 모든 세션에 늘 보인다. 결정이 없어도 연다
    void $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
    await projectKey($)
    await refresh($)
    $.clock.every(POLL_MS, () => {
      if (isRefreshing) return
      isRefreshing = true
      void refresh($).finally(() => {
        isRefreshing = false
      })
    })

    return next(e)
  })

  on('command.run', { command: 'decisions' }, async $ => {
    await refresh($, true)
    await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })

    return { text: '결재함을 열었다.' }
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
      await patchFile($, path, {
        ...(await ownerStamp($)),
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
      : { deny: '결정 파일은 고치지 않는다. Write로 새로 쓴다. 답은 사용자가 결재함 패널에서 고른다.' },
  )

  // 칸의 윗부분(slot.tsx)을 눌렀다: 접힌 칸은 편다. 펴진 칸은 그 결정을 올린 세션으로 이동한다
  on('ui.message', async ($, e, next) => {
    const id = (e.data as { id?: unknown } | null)?.id
    const list = await read($, units)
    const unit = list.find(one => one.id === id)
    if (unit) {
      const open = openUnitId(await read($, openId), pendingOf(list), await $.session.id())
      const now = await $.clock.now()
      const isDoubleClick = lastOpened.id === unit.id && now - lastOpened.at < DOUBLE_CLICK_MS
      if (open !== unit.id) {
        await update($, openId, () => unit.id)
        lastOpened = { id: unit.id, at: now }
      } else if (unit.link !== '' && !isDoubleClick) {
        await openSessionLink($, unit.link)
      }
    }

    return next(e)
  })

  on('ui.fault', ($, e, next) => {
    hasClientFault = true

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Client = !hasClientFault && 'Client' in table ? table.Client : undefined
    await read($, tick)
    const now = await $.clock.now()
    const list = (await read($, units)).filter(unit => isVisible(unit, now))
    const sessionId = await $.session.id()
    const project = await projectKey($)
    const pending = pendingOf(list)
    const open = openUnitId(await read($, openId), pending, sessionId)
    const own = list.filter(unit => unit.root !== '' && unit.root === project)
    const others = list.filter(unit => !own.includes(unit))

    const choose = (picked: Decision[], answer: string) => async () => {
      const answeredAt = await $.clock.now()
      await Promise.all(picked.map(unit => patchFile($, unit.path, { answer, answeredAt })))
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
      if (!now.isDelivered) {
        await patchFile($, unit.path, { answer: undefined, answeredAt: undefined })
      }
      await update($, notes, lines =>
        Object.fromEntries(Object.entries(lines).filter(([id]) => id !== unit.id)),
      )
      await refresh($, true)
    }

    const detail = (unit: Decision) => (
      <Box flexDirection="column" gap="md" paddingTop="sm">
        {unit.background.length > 0 && (
          <Box flexDirection="column" gap="xs">
            <Text dimColor size="caption">
              배경
            </Text>
            {unit.background.map(line => (
              <Text>• {line}</Text>
            ))}
          </Box>
        )}
        {unit.session === '' && (
          <Text color="warning" size="caption">
            올린 세션을 모른다. 이동과 답의 전달이 안 된다. 그 세션에서 /reload-plugins를 입력한다.
          </Text>
        )}
        {unit.isBlocking ? (
          <Box flexDirection="column" gap="sm">
            {unit.options.map((label, i) => {
              const isRecommended = i + 1 === unit.recommend
              const effect = unit.effects[i] ?? ''

              return (
                <Box flexDirection="column" gap="xs">
                  <Button
                    key={`${unit.id}:${i}`}
                    hotkey={OPTION_HOTKEYS[i]}
                    autoFocus={isRecommended || undefined}
                    variant={isRecommended ? 'primary' : 'secondary'}
                    onPress={choose([unit], `${i + 1}번 (${label})`)}
                  >
                    {`${i + 1}번 ${label}${isRecommended ? ' · 추천' : ''}`}
                  </Button>
                  {effect !== '' && (
                    <Text dimColor size="caption">
                      {effect}
                    </Text>
                  )}
                </Box>
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
        <Box flexDirection="column" gap="xs">
          {unit.reason !== '' && (
            <Text dimColor size="caption">
              추천 이유: {unit.reason}
            </Text>
          )}
          {unit.blocked !== '' && (
            <Text dimColor size="caption">
              멈춘 작업: {unit.blocked}
            </Text>
          )}
          {unit.link !== '' && (
            <Text dimColor size="caption">
              전체 자료는 이 칸을 다시 누르면 열리는 세션에 있다.
            </Text>
          )}
        </Box>
      </Box>
    )

    const meta = (unit: Decision) => (
      <Box flexDirection="row" gap="sm" alignItems="center">
        <Text
          color={unit.isBlocking ? 'error' : 'inactive'}
          size="caption"
          weight="semibold"
        >
          {kindLabel(unit)}
        </Text>
        <Text size="caption">
          {unit.project} {unit.id}
        </Text>
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
          <Box flexDirection="column" gap="xs">
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
            <Text dimColor>
              {canCancel(unit, now) ? '답함' : '완료'} · {unit.answer} · {unit.question}
            </Text>
            {canCancel(unit, now) && (
              <Button key={`${unit.id}:undo`} plain dimColor onPress={cancel(unit)}>
                취소
              </Button>
            )}
          </Box>,
        )
      }
      const isOpen = open === unit.id
      const head = Client ? (
        <Client
          key={`slot:${unit.id}`}
          module="./slot.tsx"
          flexGrow={1}
          props={{
            id: unit.id,
            label: kindLabel(unit),
            isBlocking: unit.isBlocking,
            project: unit.project,
            question: unit.question,
            isOpen,
          }}
        />
      ) : (
        <Box flexDirection="column" gap="xs">
          {meta(unit)}
          {isOpen ? (
            <Text weight="semibold" size="heading">
              {unit.question}
            </Text>
          ) : (
            <Button
              key={unit.id}
              plain
              dimColor={!unit.isBlocking}
              onPress={() => update($, openId, () => unit.id)}
            >
              {unit.question}
            </Button>
          )}
        </Box>
      )

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
          {isOpen && detail(unit)}
        </Box>,
      )
    }

    if (list.length === 0) {
      return (
        <Box padding="md">
          <Text dimColor>
            결재할 것이 없다. 세션이 결정을 올리면 여기에 쌓인다.
          </Text>
        </Box>
      )
    }

    // 묶음 1개: 제목 줄과 칸들. 확인 요청이 2개 이상이면 "모두 확인"을 둔다
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
                {`확인 요청 ${pendingReports.length}개 모두 확인`}
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
