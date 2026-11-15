import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Decision, State } from '../types'
import type { Signals } from './signals'
import {
  brokenUnit,
  byUrgency,
  needsAttention,
  nextReport,
  nextWait,
  parseDecision,
  patchDecisionText,
  slashed,
} from './units'
import type { UnitFile } from './units'

// 대기열 폴더(~/.claude/decisions/v2)의 읽기·쓰기, 이 세션의 칸 판정, 새 칸의 알림

// 패널의 제목은 이 번호로 처음 열 때 정해진다. 제목을 바꾸면 이 번호도 바꾼다
export const PANE = 'approval-box'
export const TITLE = '결재함'
// 처음 열 때의 폭 (글자 칸 수). 요청일 뿐이다: 사용자가 끌어서 바꾼 폭이 있으면 앱은 그 폭을 쓴다
// 49는 사용자가 패널을 끌어 놓은 폭을 잰 값이다 (2026-11-15. 대화 영역이 107칸일 때)
export const PANE_COLUMNS = 49
export const OPEN_AUTO = ''
// 판 1의 파일은 바로 위 폴더에 있다. 옛 mod가 새 파일을 잘못 읽지 않게 폴더를 나눈다 (D3)
const QUEUE_SUFFIX = '/.claude/decisions/v2'
// 패널은 이 이름 모양의 파일만 읽는다. 세션마다 기다림 칸 1개와 확인 칸 1개다 (Q5)
const UNIT_FILE = /^[0-9a-f]{8}-(wait|report)\.json$/
// 데스크톱 앱이 세션을 여는 주소. 이 값을 OS에 넘기므로 파일의 값이 정확히 이 형식일 때만 쓴다
const SESSION_LINK = 'claude://claude.ai/epitaxy/'

const units = atom({ plugin: 'decision-rack', key: 'units' } as const, [], {
  shape: 'units-4',
})
const isDismissed = atom({ plugin: 'decision-rack', key: 'isDismissed' } as const, false)

// 폴더가 바뀌지 않으면 파일을 다시 읽지 않는다. 리로드 뒤에는 한 번 다시 읽는다
let lastSignature = '\0'
let cachedQueueDir: string | undefined
let cachedProject: string | undefined
// 터미널의 REPL인가. 앱 세션 안에서 띄운 claude는 앱의 세션 주소(환경 변수)를 물려받는다. 그 주소를 쓰면 엉뚱한 세션으로 간다
// shortcut: -p 실행(surface null)은 가리지 못한다. 앱 세션의 surface 값을 확인하면 그때 조건을 좁힌다
let isTerminal = false

export function markTerminal(value: boolean): void {
  isTerminal = value
}
// 파일마다 마지막으로 읽은 내용. 수정 시각과 크기가 같으면 다시 읽지 않는다
const parsedFiles = new Map<string, { stamp: string; unit: Decision }>()
// 이미 알린 기다림 (id:raisedAt). 같은 기다림으로 패널을 2번 열지 않는다
const announcedKeys = new Set<string>()

export async function queueDir($: EngineInterface): Promise<string> {
  if (cachedQueueDir !== undefined) return cachedQueueDir
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  cachedQueueDir = `${slashed(home)}${QUEUE_SUFFIX}`

  return cachedQueueDir
}

export async function unitPath(
  $: EngineInterface,
  sessionId: string,
  part: 'wait' | 'report',
): Promise<string> {
  return `${await queueDir($)}/${sessionId.slice(0, 8)}-${part}.json`
}

// 워크트리의 세션도 같은 프로젝트로 묶는다. 그래서 git의 공용 폴더를 쓴다. git이 없으면 세션의 폴더다
export async function projectKey($: EngineInterface): Promise<string> {
  if (cachedProject !== undefined) return cachedProject
  const root = await $.session.root().catch(() => '')
  const git = await $.process
    .run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root })
    .catch(() => undefined)
  const dir = git?.exitCode === 0 && git.stdout.trim() !== '' ? git.stdout.trim() : root
  cachedProject = slashed(dir).toLowerCase()

  return cachedProject
}

// 패널의 Link는 claude:// 주소를 열지 않는다. 그래서 OS의 주소 처리기로 연다
// shortcut: Windows 전용이다. 다른 OS를 쓰게 되면 open/xdg-open을 더한다
export async function openSessionLink($: EngineInterface, link: string): Promise<void> {
  await $.process.run(['rundll32', 'url.dll,FileProtocolHandler', link])
}

export async function patchFile(
  $: EngineInterface,
  path: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await $.fs.write(path, patchDecisionText(await $.fs.read(path), patch))
}

// 없거나 깨진 파일은 undefined이다
export async function readUnit($: EngineInterface, path: string): Promise<UnitFile | undefined> {
  try {
    const raw = JSON.parse(await $.fs.read(path))

    return typeof raw === 'object' && raw !== null ? raw : undefined
  } catch {
    return undefined
  }
}

// 내용이 같으면 쓰지 않는다. 쓰면 모든 세션의 패널이 폴더를 다시 읽는다
async function writeUnit(
  $: EngineInterface,
  path: string,
  next: UnitFile,
  prev: UnitFile | undefined,
): Promise<void> {
  if (JSON.stringify(next) === JSON.stringify(prev)) return
  await $.fs.write(path, `${JSON.stringify(next, null, 2)}\n`)
}

// 이 세션의 칸이 from 상태 중 하나이면 to로 바꾼다
export async function setState(
  $: EngineInterface,
  sessionId: string,
  part: 'wait' | 'report',
  from: State[],
  to: State,
): Promise<void> {
  const path = await unitPath($, sessionId, part)
  const prev = await readUnit($, path)
  if (prev === undefined || !from.includes(prev.state as State)) return
  await writeUnit($, path, { ...prev, state: to }, prev)
}

// 칸에 쓰는 주인 세션의 표시: 프로젝트, 세션 번호, 앱에서 여는 주소
async function ownerStamp($: EngineInterface): Promise<UnitFile> {
  const hostId = isTerminal ? undefined : await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
  const root = slashed(await $.session.root().catch(() => ''))

  return {
    project: root.split('/').filter(Boolean).pop() ?? '?',
    root: await projectKey($),
    session: await $.session.id(),
    link: hostId ? `${SESSION_LINK}${hostId}` : undefined,
  }
}

// 같은 앱 세션이 이어받기 등으로 새 세션 번호를 받으면 옛 번호의 기다림 칸은 주인이 없다. 그 칸을 닫는다
// shortcut: 앱 세션 안에서 띄운 claude -p도 같은 주소를 물려받아 부모의 칸을 닫을 수 있다. 부모는 턴 끝에 다시 판정한다
async function closeOrphans($: EngineInterface, link: unknown, sessionId: string): Promise<void> {
  if (typeof link !== 'string') return
  const orphans = (await read($, units)).filter(
    unit =>
      unit.id.endsWith('-wait') &&
      unit.link === link &&
      unit.session !== sessionId &&
      unit.state !== 'closed' &&
      !unit.isBroken,
  )
  await Promise.all(orphans.map(unit => patchFile($, unit.path, { state: 'closed' })))
}

// 신호로 이 세션의 칸 2개를 고친다. 신호가 없으면 isQuietCloses일 때만 기다림 칸을 닫는다 (D4)
export async function sync($: EngineInterface, signals: Signals, isQuietCloses: boolean): Promise<void> {
  const sessionId = await $.session.id()
  const now = await $.clock.now()
  const stamp = await ownerStamp($)
  const waitPath = await unitPath($, sessionId, 'wait')
  const reportPath = await unitPath($, sessionId, 'report')
  const prevWait = await readUnit($, waitPath)
  const prevReport = await readUnit($, reportPath)

  const wait = nextWait(prevWait, signals, now, stamp)
  if (wait !== undefined) await writeUnit($, waitPath, wait, prevWait)
  else if (isQuietCloses && prevWait !== undefined && prevWait.state !== 'closed') {
    await writeUnit($, waitPath, { ...prevWait, state: 'closed' }, prevWait)
  }
  const report = nextReport(prevReport, signals.reports, now, stamp)
  if (report !== undefined) await writeUnit($, reportPath, report, prevReport)
  await closeOrphans($, stamp.link, sessionId)
  await refresh($, true)
}

// 새 기다림이 오면 패널을 열고 알린다. 사용자는 명령을 치지 않는다
async function announce($: EngineInterface, list: Decision[]): Promise<void> {
  const project = await projectKey($)
  const sessionId = await $.session.id()
  const fresh = list.filter(
    unit =>
      needsAttention(unit, project, sessionId) && !announcedKeys.has(`${unit.id}:${unit.raisedAt}`),
  )
  if (fresh.length === 0) return

  for (const unit of fresh) announcedKeys.add(`${unit.id}:${unit.raisedAt}`)
  await openPane($)
  void $.ui.toast(`결재함에 ${fresh.length}개가 왔다`)
}

export async function openPane($: EngineInterface): Promise<void> {
  await update($, isDismissed, () => false)
  void $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
}

export async function refresh($: EngineInterface, isForced = false): Promise<void> {
  const dir = await queueDir($)
  try {
    const entries = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
    const files = entries.filter(f => f.kind === 'file' && UNIT_FILE.test(f.name))
    const signature = files.map(f => `${f.name}:${f.mtimeMs}`).join('|')
    if (!isForced && signature === lastSignature) return

    const list = await Promise.all(
      files.map(async f => {
        const path = `${dir}/${f.name}`
        const stamp = `${f.mtimeMs}:${f.size}`
        const cached = parsedFiles.get(f.name)
        if (cached?.stamp === stamp) return cached.unit
        const unit = parseDecision(path, await $.fs.read(path).catch(() => ''))
        parsedFiles.set(f.name, { stamp, unit })

        return unit
      }),
    )
    list.sort(byUrgency)
    await update($, units, () => list)
    lastSignature = signature
    await announce($, list)
  } catch (error) {
    // 오류를 숨기면 패널이 "결재할 것이 없다"로 보인다. 기다리는 세션을 사용자가 알 수 없다
    lastSignature = '\0'
    await update($, units, () => [brokenUnit(dir, String(error))])
  }
}
