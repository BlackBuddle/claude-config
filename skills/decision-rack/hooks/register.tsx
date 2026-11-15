import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren } from 'claude-code'

import type { Decision } from '../types'
import {
  OPEN_AUTO,
  PANE,
  PANE_COLUMNS,
  TITLE,
  markTerminal,
  openPane,
  openSessionLink,
  patchFile,
  projectKey,
  readUnit,
  refresh,
  setState,
  sync,
  unitPath,
} from './queue'
import { CARD_TOOL, cardAsk, lastTurn, signalsOf } from './signals'
import {
  KIND_LOOK,
  KIND_ORDER,
  ageText,
  countOf,
  openUnitId,
  optionsLine,
  rackFirst,
  statusText,
  visibleOf,
} from './units'

// 엔진의 검사기는 상태를 읽는 파일 안의 atom 정의만 받는다. 그래서 queue.ts와 같은 정의를 여기에도 둔다
const units = atom({ plugin: 'decision-rack', key: 'units' } as const, [], {
  shape: 'units-4',
})
const openId = atom({ plugin: 'decision-rack', key: 'openId' } as const, OPEN_AUTO)
const isDismissed = atom({ plugin: 'decision-rack', key: 'isDismissed' } as const, false)

// 시험이 쓰는 계산 함수. 시험 파일은 이 모듈만 읽는다
export { ageText, lastTurn, rackFirst, signalsOf, statusText }

// 결재함은 "어느 세션이 사용자를 기다리는가"를 보이는 곳이다. 결정은 그 세션의 대화에서 한다 (2026-11-15 사용자 결정)
// 판 2: 칸은 mod가 대화에서 뽑는다. AI는 칸의 파일을 쓰지 않는다. 파일은 지우지 않고 상태를 덮어쓴다 (PLAN 5·6절)

// 폴더가 그대로이면 목록 1번만 읽는다
const POLL_MS = 2000
// 더블 클릭의 두 번째 클릭을 이동으로 다루지 않는다
const DOUBLE_CLICK_MS = 500
// 펴진 칸은 짧게 쓴다: 요약은 이 줄 수까지만 보여준다. 전체 자료는 세션의 대화에 있다 (2026-11-15 사용자 결정)
const MAX_SUMMARY_LINES = 2
// 사용자가 직접 넣은 입력의 출처: 터미널·앱의 Enter(composer), 원격 조작(bridge), claude -p(sdk)
// 작업 알림, 다른 세션의 메시지(peer), 예약 실행은 사용자의 답이 아니다 (앱 입력과 peer는 2026-11-15 실제로 확인)
const USER_ORIGINS = new Set(['composer', 'bridge', 'sdk'])
// 사용자가 끝낸 세션만 칸을 닫는다. 앱 종료(other)와 이어받기(resume)는 칸을 남긴다 (D2)
const CLOSING_ENDS = new Set(['prompt_input_exit', 'clear', 'logout'])

// ── 입출력: 대기열 폴더 ──

// 앞의 읽기가 끝나지 않으면 타이머의 읽기가 겹친다. 겹친 읽기는 건너뛴다
let isRefreshing = false
// Client(slot.tsx)를 그리지 못하는 화면에서는 제목 버튼으로 대신한다
let hasClientFault = false
// 지금 턴에 사용자가 입력했는가 (입력, 끼어든 입력, 선택 카드의 답). 신호 없이 끝난 사용자 턴만 칸을 닫는다 (D4)
// 턴 끝에서만 false로 되돌린다. 턴 안에 끼어든 작업 알림이 사용자 입력을 지우지 않게 한다
let isUserTurn = false
// 지금 턴이 시작할 때의 메시지 수. 턴 끝에 이 뒤의 메시지만 판정한다
let turnStartCount: number | undefined
// 주기 읽기 타이머는 프로세스에 1개다. session.start가 다시 와도 더 만들지 않는다
let hasPollTimer = false
// 방금 편 칸과 그 시각. 접힌 칸을 더블 클릭해도 이동하지 않게 한다
let lastOpened = { id: '', at: 0 }

// ── 훅 ──

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    markTerminal(e.surface === 'terminal')
    // 이전 판은 개수를 상태 줄에 썼다. 상태 줄은 누를 수 없어서 띠로 옮겼다. 남은 글을 지운다
    $.ui.status(undefined)
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
    // 다시 연 세션과 다시 읽은 mod는 마지막 답으로 다시 판정한다. 신호가 없어도 닫지 않는다
    // 진행 중(busy)이면 턴이 아직 돌고 있을 수 있다. 그 턴의 끝이 판정한다
    const ownWait = await readUnit($, await unitPath($, await $.session.id(), 'wait'))
    if (ownWait?.state !== 'busy') {
      const turn = lastTurn(await $.session.messages().catch(() => []))
      await sync($, signalsOf(turn.text, turn.uses, turn.allText), false).catch(() => undefined)
    }
    if (!hasPollTimer) {
      hasPollTimer = true
      $.clock.every(POLL_MS, () => {
        if (isRefreshing) return
        isRefreshing = true
        void refresh($).finally(() => {
          isRefreshing = false
        })
      })
    }

    return next(e)
  })

  // 사용자가 세션을 끝냈다. 기다림 칸만 닫는다. 확인 칸은 사용자가 확인을 눌러야 닫힌다 (D2)
  on('session.end', async ($, e, next) => {
    if (CLOSING_ENDS.has(e.reason)) {
      await setState($, e.sessionId, 'wait', ['waiting', 'busy'], 'closed').catch(() => undefined)
    }

    return next(e)
  })

  on('command.run', { command: 'decisions' }, async $ => {
    await refresh($, true)
    await openPane($)

    return { text: '결재함을 열었다.' }
  })

  // 사용자가 이 세션에 직접 입력했다. 기다림 칸을 흐리게 한다 (Q3). 답인지는 턴 끝에 정한다
  on('prompt.submit', async ($, e, next) => {
    // 출처가 없는 입력은 사용자의 입력으로 본다
    const origin = (e.origin as { kind?: string } | undefined)?.kind
    if (origin === undefined || USER_ORIGINS.has(origin)) {
      isUserTurn = true
      await setState($, await $.session.id(), 'wait', ['waiting'], 'busy')
        .then(() => refresh($, true))
        .catch(() => undefined)
    }

    return next(e)
  })

  // 턴이 시작했다. 턴 끝에 이 뒤의 메시지만 판정한다 (턴 안에 끼어든 알림이 턴을 자르지 않게)
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turnStartCount = await $.session
        .messages()
        .then(messages => messages.length)
        .catch(() => undefined)
    }

    return next(e)
  })

  // 턴이 끝났다. 하위 에이전트의 턴은 판정하지 않는다. 실패해도 턴의 결과는 바꾸지 않는다
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const wasUserTurn = isUserTurn
    const from = turnStartCount
    isUserTurn = false
    turnStartCount = undefined
    const judged =
      e.reason === 'answer'
        ? $.session
            .messages()
            .then(messages => {
              const turn = lastTurn(messages, from)

              return sync($, signalsOf(e.answer, turn.uses, turn.allText), wasUserTurn)
            })
        : // 중단·오류·거절: 다시 판정하지 않는다. 사용자가 아직 답하지 않은 것이다
          $.session
            .id()
            .then(id => setState($, id, 'wait', ['busy'], 'waiting'))
            .then(() => refresh($, true))
    await judged.catch(() => undefined)

    return result
  })

  // 선택 카드가 떠 있는 동안 기다린다. 답하면 진행 중이다. 파일 쓰기 실패는 도구 호출을 막지 않는다
  on('tool.call', { tool: CARD_TOOL }, async ($, e, next) => {
    const ask = cardAsk(e as unknown as Record<string, unknown>)
    if (ask !== undefined) {
      await sync($, signalsOf('', [{ tool_use_id: '', tool: CARD_TOOL, input: e as never }]), false).catch(
        () => undefined,
      )
    }
    const result = await next(e)
    if (ask !== undefined) {
      // 카드에 답한 것은 사용자의 입력이다. 이 턴이 신호 없이 끝나면 칸을 닫는다
      isUserTurn = true
      await setState($, await $.session.id(), 'wait', ['waiting'], 'busy')
        .then(() => refresh($, true))
        .catch(() => undefined)
    }

    return result
  })

  // 사용자가 패널을 직접 닫았다. 다시 부를 때까지 스스로 열지 않는다
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      await update($, isDismissed, () => true)
    }

    return next(e)
  })

  // 칸의 윗부분(slot.tsx)을 눌렀다: 접힌 칸은 편다. 펴진 칸은 그 칸의 세션으로 이동한다
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

  // 패널이 닫혀 있으면 프롬프트 위 띠에 개수와 여는 단추를 보인다. 상태 줄은 누를 수 없다 (2026-11-15 사용자 결정)
  // 패널은 30칸(창의 약 22%)보다 좁아지지 않고 앱은 위젯 요청을 무시한다. 그래서 접힌 모양 대신 닫고 띠를 쓴다
  // 모양은 ponytail 띠에 맞춘다: 줄 전체 폭, 간격 2, 오른쪽 끝의 글자 단추 (상위 세션 3차 디자인)
  // 앱이 단추 안 글자색을 지운다. 그래서 색 점은 단추 밖의 글자로 둔다. 0인 종류는 쓰지 않는다
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = visibleOf(await read($, units))
    if (e.props.hasSurvey || statusText(shown) === undefined || !(await read($, isDismissed))) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" alignItems="center" gap={2} width={e.props.bodyColumns}>
        {KIND_ORDER.filter(kind => countOf(shown, kind) > 0).map(kind => (
          <Box key={`count:${kind}`} flexDirection="row" gap={1}>
            <Text color={KIND_LOOK[kind].color}>●</Text>
            <Text>{`${KIND_LOOK[kind].label} ${countOf(shown, kind)}`}</Text>
          </Box>
        ))}
        <Box flexGrow={1} />
        <Button key="open-rack" plain label="결재함" onPress={() => openPane($)} />
      </Box>
    )
  })

  // 결재함 줄을 띠의 맨 위(ponytail 줄 위)에 둔다. 다른 줄은 순서를 바꾸지 않는다 (2026-11-15 사용자 요청)
  on('ui.render', { component: 'AbovePromptList' }, ($, e, next) => {
    const rows = rackFirst(e.props.rows)

    return next({ ...e, props: { ...e.props, rows } })
  })

  on('ui.fault', ($, e, next) => {
    hasClientFault = true

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Client = !hasClientFault && 'Client' in table ? table.Client : undefined
    const shown = visibleOf(await read($, units))
    const sessionId = await $.session.id()
    const project = await projectKey($)
    const now = await $.clock.now()
    const open = openUnitId(await read($, openId), shown, sessionId)
    const own = shown.filter(unit => unit.root !== '' && unit.root === project)
    const others = shown.filter(unit => !own.includes(unit))

    // 확인(초록) 칸을 읽었다. 세션에는 아무것도 보내지 않는다. 칸만 닫는다
    const acknowledge = (picked: Decision[]) => async () => {
      await Promise.all(picked.map(unit => patchFile($, unit.path, { state: 'closed' })))
      await update($, openId, () => OPEN_AUTO)
      await refresh($, true)
    }

    // 펴진 칸의 내용: 요약 1~2줄과 선택지 1줄. 답하는 버튼은 없다. 답은 그 칸의 세션에서 한다
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
            앱에서 연 세션이 아니다. 이동이 안 된다.
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
      const isBusy = unit.state === 'busy'
      const look = KIND_LOOK[unit.kind]
      const age = ageText(now, unit.raisedAt)
      const head = Client ? (
        <Client
          key={`slot:${unit.id}`}
          module="./slot.tsx"
          flexGrow={1}
          props={{
            id: unit.id,
            kind: unit.kind,
            isBroken: unit.isBroken,
            isBusy,
            project: unit.project,
            age,
            question: unit.question,
            isOpen,
          }}
        />
      ) : (
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" gap="sm" alignItems="center">
            <Text color={look.color} size="caption" weight="semibold" dimColor={isBusy}>
              ● {unit.isBroken ? '오류' : isBusy ? '진행 중' : look.label}
            </Text>
            <Text size="caption">
              {unit.project} {age}
            </Text>
          </Box>
          {isOpen ? (
            <Text weight="semibold" size="heading" dimColor={isBusy}>
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
          {/* 좁은 패널에서 긴 질문이 "확인" 단추를 밖으로 밀었다. 글 쪽만 줄어들게 한다 (2026-11-15 사용자 보고) */}
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              {head}
            </Box>
            {unit.kind === 'report' && !unit.isBroken && (
              <Box flexShrink={0}>
                <Button key={`${unit.id}:ok`} onPress={acknowledge([unit])}>
                  확인
                </Button>
              </Box>
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
          <Text dimColor>기다리는 세션이 없다. 세션이 사용자를 기다리면 여기에 쌓인다.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding="md" gap="md">
        {own.length > 0 && section('이 프로젝트', own)}
        {others.length > 0 && section(own.length > 0 ? '다른 프로젝트' : '세션', others)}
      </Box>
    )
  })
}
