import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Decision, Kind } from '../types'

// 결재함은 내용을 보는 곳이다. 결정은 세션에서 한다 (2026-11-15 사용자 결정)
// 세션이 올린 칸을 쌓아 보여준다. 칸을 누르면 그 세션으로 간다. 사용자가 그 세션에 입력하면 칸을 내린다

// 패널의 제목은 이 번호로 처음 열 때 정해진다. 제목을 바꾸면 이 번호도 바꾼다
const PANE = 'approval-box'
const TITLE = '결재함'
// 처음 열 때의 폭 (글자 칸 수). 요청일 뿐이다: 사용자가 끌어서 바꾼 폭이 있으면 앱은 그 폭을 쓴다
// 49는 사용자가 패널을 끌어 놓은 폭을 잰 값이다 (2026-11-15. 대화 영역이 107칸일 때)
const PANE_COLUMNS = 49
// 폴더가 그대로이면 목록 1번만 읽는다
const POLL_MS = 2000
const OPEN_AUTO = ''
const QUEUE_SUFFIX = '/.claude/decisions'
// 더블 클릭의 두 번째 클릭을 이동으로 다루지 않는다
const DOUBLE_CLICK_MS = 500
// 데스크톱 앱이 세션을 여는 주소. 이 값을 OS에 넘기므로 파일의 값이 정확히 이 형식일 때만 쓴다
const SESSION_LINK = 'claude://claude.ai/epitaxy/'
const SESSION_LINK_FORMAT = /^claude:\/\/claude\.ai\/epitaxy\/local_[0-9a-f-]+$/
// 급한 순서. 이 순서로 쌓고, 이 순서로 줄에 쓴다
const KIND_ORDER: Kind[] = ['request', 'notice', 'report']
// 펴진 칸은 짧게 쓴다: 요약은 이 줄 수까지만 보여준다. 전체 자료는 세션의 대화에 있다 (2026-11-15 사용자 결정)
const MAX_SUMMARY_LINES = 2
const CIRCLED = '①②③④⑤⑥⑦⑧⑨'
// 사용자가 직접 넣은 입력의 출처: 터미널의 Enter, 원격 조작, 앱(SDK)의 입력
// 백그라운드 작업의 알림, 다른 세션의 메시지, 예약 실행은 사용자의 답이 아니다. 그때는 칸을 내리지 않는다
const USER_ORIGINS = new Set(['composer', 'bridge', 'sdk'])
// 결재는 빨강, 알림은 노랑, 확인은 초록이다 (2026-11-15 사용자 결정)
const KIND_LOOK = {
  request: { color: 'error', label: '결재' },
  notice: { color: 'warning', label: '알림' },
  report: { color: 'success', label: '확인' },
} as const

const units = atom({ plugin: 'decision-rack', key: 'units' } as const, [], {
  shape: 'units-3',
})
const openId = atom({ plugin: 'decision-rack', key: 'openId' } as const, OPEN_AUTO)
const isDismissed = atom({ plugin: 'decision-rack', key: 'isDismissed' } as const, false)

// ── 계산: 입출력 없음 ──

function slashed(path: string): string {
  return path.replace(/\\/g, '/')
}

// 파일의 grade: "나" = 결재, "알림" = 알림, "가" = 확인. 모르는 값은 결재로 본다 (놓치지 않게 가장 급한 쪽)
function kindOf(grade: unknown): Kind {
  if (grade === '가') return 'report'

  return grade === '알림' ? 'notice' : 'request'
}

// 선택지는 글자다. 이전 양식의 { label, effect }도 읽는다 (이름만 쓴다)
function optionLabel(option: unknown): string {
  if (typeof option !== 'object' || option === null) return String(option)

  return String((option as Record<string, unknown>).label ?? '')
}

// 선택지를 1줄로 쓴다: '① JSON 파일 (추천)  ② SQLite'. 확인 칸에서는 추천 대신 적용이다
function optionsLine(unit: Decision): string {
  const mark = unit.kind === 'report' ? ' (적용)' : ' (추천)'

  return unit.options
    .map((label, i) => `${CIRCLED[i] ?? `${i + 1}.`} ${label}${i + 1 === unit.recommend ? mark : ''}`)
    .join('  ')
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
    kind: 'request',
    session: '',
    link: '',
    root: '',
    isBroken: true,
    question: '읽지 못했다',
    options: [],
    background: [],
    recommend: 0,
    error: why,
    isWithdrawn: false,
  }
}

function parseDecision(path: string, text: string): Decision {
  try {
    const raw = JSON.parse(text)
    if (typeof raw?.question !== 'string') return brokenUnit(path, 'question이 없다')
    const options: unknown[] = Array.isArray(raw.options) ? raw.options : []

    return {
      ...brokenUnit(path, ''),
      project: String(raw.project ?? '?'),
      kind: kindOf(raw.grade),
      session: String(raw.session ?? ''),
      link: SESSION_LINK_FORMAT.test(String(raw.link)) ? String(raw.link) : '',
      root: String(raw.root ?? ''),
      isBroken: false,
      question: raw.question,
      options: options.map(optionLabel),
      background: backgroundLines(raw.background),
      recommend: Number.isInteger(raw.recommend) ? raw.recommend : 0,
      isWithdrawn: raw.withdrawn === true,
    }
  } catch (error) {
    return brokenUnit(path, String(error))
  }
}

// 파일의 다른 값은 그대로 둔다. 값이 undefined인 키는 지운다
function patchDecisionText(text: string, patch: Record<string, unknown>): string {
  return `${JSON.stringify({ ...JSON.parse(text), ...patch }, null, 2)}\n`
}

// 급한 종류를 위에 쌓는다
function byUrgency(a: Decision, b: Decision): number {
  return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id)
}

function visibleOf(list: Decision[]): Decision[] {
  return list.filter(unit => !unit.isWithdrawn)
}

function countOf(list: Decision[], kind: Kind): number {
  return list.filter(unit => unit.kind === kind && !unit.isBroken).length
}

// 고른 칸이 없으면 이 세션이 올린 칸을 먼저 연다. 다른 세션에서 이동해 온 사용자가 그 칸을 바로 본다
function openUnitId(stored: string, shown: Decision[], sessionId: string): string | undefined {
  return (
    shown.find(unit => unit.id === stored) ??
    shown.find(unit => unit.session === sessionId) ??
    shown[0]
  )?.id
}

// 사용자가 봐야 하는 새 칸: 이 프로젝트의 결재·알림이고, 이 세션이 올린 것이 아니다
function needsAttention(unit: Decision, project: string, sessionId: string): boolean {
  return (
    unit.kind !== 'report' &&
    !unit.isBroken &&
    !unit.isWithdrawn &&
    unit.root !== '' &&
    unit.root === project &&
    unit.session !== sessionId
  )
}

// 세션에 붙이는 알림. 내린 칸의 파일은 세션이 지운다 (mod는 파일을 지우지 못한다)
function withdrawnText(withdrawn: Decision[]): string {
  return [
    `[결재함] 이 세션이 올린 칸을 결재함에서 내렸다: ${withdrawn.map(unit => unit.id).join(', ')}`,
    '이유: 사용자가 이 세션에 직접 입력했다. 또는 결재함에서 확인을 눌렀다.',
    '할 일: 그 결정 파일을 지운다. 이 입력이 결정의 답이면 그 답을 쓴다. 아직 기다리는 것이 있으면 새 번호로 다시 올린다.',
  ].join('\n')
}

// ── 입출력: 대기열 폴더 ──

// 폴더가 바뀌지 않으면 파일을 다시 읽지 않는다. 리로드 뒤에는 한 번 다시 읽는다
let lastSignature = '\0'
let lastList: Decision[] = []
// 앞의 읽기가 끝나지 않으면 타이머의 읽기가 겹친다. 겹친 읽기는 건너뛴다
let isRefreshing = false
let cachedQueueDir: string | undefined
let cachedProject: string | undefined
// Client(slot.tsx)를 그리지 못하는 화면에서는 제목 버튼으로 대신한다
let hasClientFault = false
// 이미 알린 칸. 같은 칸으로 패널을 2번 열지 않는다
const announcedIds = new Set<string>()
// 이미 확인한 표시 없는 칸. 대화 기록을 칸마다 1번만 읽는다
const claimCheckedIds = new Set<string>()
// 방금 편 칸과 그 시각. 접힌 칸을 더블 클릭해도 이동하지 않게 한다
let lastOpened = { id: '', at: 0 }

async function queueDir($: EngineInterface): Promise<string> {
  if (cachedQueueDir !== undefined) return cachedQueueDir
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  cachedQueueDir = `${slashed(home)}${QUEUE_SUFFIX}`

  return cachedQueueDir
}

// 워크트리의 세션도 같은 프로젝트로 묶는다. 그래서 git의 공용 폴더를 쓴다. git이 없으면 세션의 폴더다
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

async function patchFile(
  $: EngineInterface,
  path: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await $.fs.write(path, patchDecisionText(await $.fs.read(path), patch))
}

// 결정 파일에 쓰는 "올린 세션"의 표시: 세션 번호, 프로젝트, 앱에서 여는 주소
async function ownerStamp($: EngineInterface): Promise<Record<string, unknown>> {
  const hostId = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')

  return {
    session: await $.session.id(),
    root: await projectKey($),
    link: hostId ? `${SESSION_LINK}${hostId}` : undefined,
  }
}

// 표시가 없는 칸 중에서 이 세션이 쓴 것을 찾아 표시한다
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

// 새 결재·알림이 오면 패널을 열고 알린다. 사용자는 명령을 치지 않는다
async function announce($: EngineInterface, list: Decision[]): Promise<void> {
  const project = await projectKey($)
  const sessionId = await $.session.id()
  const fresh = list.filter(
    unit => needsAttention(unit, project, sessionId) && !announcedIds.has(unit.id),
  )
  if (fresh.length === 0) return

  for (const unit of fresh) announcedIds.add(unit.id)
  await update($, isDismissed, () => false)
  void $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
  void $.ui.toast(`결재함에 ${fresh.length}개가 왔다`)
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
    lastList = list.sort(byUrgency)
    await update($, units, () => lastList)
    lastSignature = signature
    // 표시하면 파일이 바뀐다. 바로 다시 읽는다
    if (await claimUnowned($, lastList)) return await refresh($, true)
    await announce($, lastList)
  } catch (error) {
    // 오류를 숨기면 패널이 "결재할 것이 없다"로 보인다. 기다리는 세션을 사용자가 알 수 없다
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
    // 결재함은 모든 세션에 늘 보인다. 칸이 없어도 연다
    // 이 훅은 mod를 다시 읽을 때도 실행된다. 사용자가 닫아 둔 패널은 다시 열지 않는다
    if (!(await read($, isDismissed))) {
      void $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
    }
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
    await update($, isDismissed, () => false)
    await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })

    return { text: '결재함을 열었다.' }
  })

  // 사용자가 이 세션에 직접 입력했다. 이 세션이 올린 결재·알림은 낡았다: 결재함에서 바로 내린다
  // 확인(초록) 칸은 내리지 않는다. 그 칸은 사용자가 결재함에서 확인을 눌러야 사라진다
  on('prompt.submit', async ($, e, next) => {
    // 사용자의 입력에만 반응한다. 출처가 없는 입력은 사용자의 입력으로 본다
    const origin = (e.origin as { kind?: string } | undefined)?.kind
    if (origin !== undefined && !USER_ORIGINS.has(origin)) return next(e)
    const sessionId = await $.session.id()
    const own = lastList.filter(unit => unit.session === sessionId)
    const stale = own.filter(unit => !unit.isWithdrawn && unit.kind !== 'report')
    await Promise.all(stale.map(unit => patchFile($, unit.path, { withdrawn: true })))
    if (stale.length > 0) await refresh($, true)
    // 확인을 눌러 내린 칸도 함께 알린다. 세션이 그 파일을 지운다
    const withdrawn = [...stale, ...own.filter(unit => unit.isWithdrawn)]
    if (withdrawn.length === 0) return next(e)

    return next({ ...e, context: [...(e.context ?? []), withdrawnText(withdrawn)] })
  })

  // 세션이 결정 파일을 쓰면 그 파일에 이 세션의 번호를 쓴다. 그 세션에 입력이 오면 칸을 내린다
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e)
    const path = await queueFile($, e)
    if (path !== undefined) {
      // 내림 표시는 mod만 쓴다. 세션이 쓴 값은 지운다
      await patchFile($, path, { ...(await ownerStamp($)), withdrawn: undefined }).catch(
        () => undefined,
      )
    }

    return result
  })

  // 사용자가 패널을 직접 닫았다. 다시 부를 때까지 스스로 열지 않는다
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, isDismissed, () => true)

    return next(e)
  })

  // 칸의 윗부분(slot.tsx)을 눌렀다: 접힌 칸은 편다. 펴진 칸은 그 칸을 올린 세션으로 이동한다
  on('ui.message', async ($, e, next) => {
    const id = (e.data as { id?: unknown } | null)?.id
    const shown = visibleOf(await read($, units))
    const unit = shown.find(one => one.id === id)
    if (unit) {
      const open = openUnitId(await read($, openId), shown, await $.session.id())
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

  // 접힌 모양이다. 패널은 30칸(창의 약 22%)보다 좁아지지 않는다. 앱은 위젯 요청도 무시한다 (2026-11-15 확인)
  // 그래서 사용자가 패널을 닫으면 입력창 위의 1줄로 남는다. 번잡하지 않게: 기다리는 칸이 없으면 그리지 않는다
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = visibleOf(await read($, units))
    const isQuiet = e.props.hasSurvey || shown.length === 0 || !(await read($, isDismissed))
    if (isQuiet) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const openPane = async () => {
      await update($, isDismissed, () => false)
      await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
    }

    // ponytail의 줄과 같은 문법으로 그린다: 이름, 색 점과 숫자, 빈 칸, 오른쪽 끝의 글자 버튼
    // 색 점은 Button 밖에 둔다: Button 안의 글자는 색을 잃는다. 0인 종류는 쓰지 않는다
    return (
      <Box flexDirection="row" alignItems="center" gap={2} width={e.props.bodyColumns}>
        <Button key="count" plain onPress={openPane}>
          {TITLE}
        </Button>
        {KIND_ORDER.filter(kind => countOf(shown, kind) > 0).map(kind => (
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text color={KIND_LOOK[kind].color}>●</Text>
            <Text>
              {KIND_LOOK[kind].label} {countOf(shown, kind)}
            </Text>
          </Box>
        ))}
        <Box flexGrow={1} />
        <Button key="unfold" plain label="열기" onPress={openPane} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Client = !hasClientFault && 'Client' in table ? table.Client : undefined
    const shown = visibleOf(await read($, units))
    const sessionId = await $.session.id()
    const project = await projectKey($)
    const open = openUnitId(await read($, openId), shown, sessionId)
    const own = shown.filter(unit => unit.root !== '' && unit.root === project)
    const others = shown.filter(unit => !own.includes(unit))

    // 확인(초록) 칸을 읽었다. 세션에는 아무것도 보내지 않는다. 칸만 내린다
    const acknowledge = (picked: Decision[]) => async () => {
      await Promise.all(picked.map(unit => patchFile($, unit.path, { withdrawn: true })))
      await update($, openId, () => OPEN_AUTO)
      await refresh($, true)
    }

    // 펴진 칸의 내용: 요약 1~2줄과 선택지 1줄. 답하는 버튼은 없다. 답은 그 칸을 올린 세션에서 한다
    const detail = (unit: Decision) => (
      <Box flexDirection="column" gap="xs" paddingTop="xs">
        {unit.background.slice(0, MAX_SUMMARY_LINES).map(line => (
          <Text>{line}</Text>
        ))}
        {unit.options.length > 0 && (
          <Text dimColor size="caption">
            {optionsLine(unit)}
          </Text>
        )}
        {unit.isBroken && (
          <Text dimColor size="caption">
            {unit.error}
          </Text>
        )}
        {unit.link === '' && !unit.isBroken && (
          <Text color="warning" size="caption">
            올린 세션을 모른다. 이동이 안 된다. 그 세션에서 /reload-plugins를 입력한다.
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
      const isOpen = open === unit.id
      const look = KIND_LOOK[unit.kind]
      const head = Client ? (
        <Client
          key={`slot:${unit.id}`}
          module="./slot.tsx"
          flexGrow={1}
          props={{
            id: unit.id,
            kind: unit.kind,
            isBroken: unit.isBroken,
            project: unit.project,
            question: unit.question,
            isOpen,
          }}
        />
      ) : (
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" gap="sm" alignItems="center">
            <Text color={look.color} size="caption" weight="semibold">
              ● {unit.isBroken ? '오류' : look.label}
            </Text>
            <Text size="caption">
              {unit.project} {unit.id}
            </Text>
          </Box>
          {isOpen ? (
            <Text weight="semibold" size="heading">
              {unit.question}
            </Text>
          ) : (
            <Button key={unit.id} plain onPress={() => update($, openId, () => unit.id)}>
              {unit.question}
            </Button>
          )}
        </Box>
      )

      return slot(
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            {head}
            {unit.kind === 'report' && !unit.isBroken && (
              <Button key={`${unit.id}:ok`} onPress={acknowledge([unit])}>
                확인
              </Button>
            )}
          </Box>
          {isOpen && detail(unit)}
        </Box>,
      )
    }

    // 묶음 1개: 제목 줄과 칸들. 확인 칸이 2개 이상이면 "모두 확인"을 둔다
    const section = (title: string, rows: Decision[]) => {
      const reports = rows.filter(unit => unit.kind === 'report' && !unit.isBroken)

      return (
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text dimColor size="caption" weight="semibold">
              {title} {rows.length}
            </Text>
            {reports.length > 1 && (
              <Button key={`confirm-all:${title}`} onPress={acknowledge(reports)}>
                {`확인 ${reports.length}개 모두 확인`}
              </Button>
            )}
          </Box>
          {rows.map(row)}
        </Box>
      )
    }

    if (shown.length === 0) {
      return (
        <Box padding="md">
          <Text dimColor>결재할 것이 없다. 세션이 결정을 올리면 여기에 쌓인다.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding="md" gap="md">
        {own.length > 0 && section('이 프로젝트', own)}
        {others.length > 0 && section(own.length > 0 ? '다른 프로젝트' : '결정', others)}
      </Box>
    )
  })
}
