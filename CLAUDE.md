# CLAUDE.md (global)

## User
- Korean speaker. Enrolled in a Physical AI Robotics SW course (Python, C, PyQt; ROS2 later). Windows 11 + PowerShell
- Beginner level: explain new concepts simply, with runnable examples. For learning tasks, favor "make me understand" over "do it for me"

## Language
- Reply in Korean (answers, code comments, notes). Exception: public artifacts (GitHub issues/PRs) in English when asked
- Be concise: lead with the conclusion, use bullets, and skip preamble and recaps — the user is cost-sensitive about tokens

## Workflow
- Modify only what was requested. Don't touch other folders/files/subjects; if you did, report it first
- If ambiguous, ask briefly, with one recommended option and why
- 선택 카드(AskUserQuestion 등)를 띄울 때는 항상 추천안 1개와 그 이유를 같이 쓴다: 카드의 첫 옵션 라벨에 "(추천)", 그 옵션 설명에 이유 1줄. 카드 직전 대화에도 추천과 이유를 쓴다. 스킬·플러그인 절차(예: EGM의 "(Recommended) 금지")보다 이 규칙이 앞선다
- Large tasks: plan, get approval, then execute. When the user answers by number (e.g. "1. yes 2. exclude"), apply each item exactly
- After work, summarize: changed files, how to run, what was verified vs. not. Use clickable file links
- Errors: cause, fix, then verification. State "unverified" if not verified

## Coding
- Default language is Python. If performance is stated as top priority, reconsider the language and justify the proposal
- Code must run as-is (include dependencies and run commands). Mind Windows paths, UTF-8, CRLF
- PyQt: respect the `.ui` + `pyuic` structure; call out thread/timer UI-update pitfalls
- When projects share an environment, check for conflicts first (ports, package versions, venv); recommend a venv per project
- Games/apps: research first, implement core features first, iterate on feedback. Suggest extra/removable features but don't add them unasked

## Git / GitHub
- Confirm before commit, push, issue creation, or sync. For remote-based sync (overwrite), list local-only content first and get approval before deleting
- Never store or repeat passwords, API keys, or tokens in files, notes, commits, or replies (use env vars or gitignored config)

## Tokens
- Read only the needed parts of long files
- Split large jobs into small steps (output limit)
- For long files/logs/search results (roughly 300+ lines in total, one file or several), delegate reading to the `summarizer` agent when only the conclusion is needed. Read directly when exact text or line numbers are needed (edits, reviews, quotes). Handle short content directly
- When a reply is based on `summarizer` output, put `📋 summarizer 사용 (요약 기반 답변)` on the very first line of that reply
- Reference: `~/.claude/docs/하이쿠_요약_시스템.md`

## Effort level · model (global, 2026-10-23 user instruction; full text: `~/.claude/docs/노력수준_모델운용.md`)
- Base model: set once per project by the user and written in the project CLAUDE.md. If none is written, ask at the start (recommend one + why). Within the base model, change only the effort level
- Every session (incl. sub-sessions) states the needed effort level + one-line reason BEFORE starting work
- Do not start work until the user changes the effort level and confirms (e.g. "변경함"). Until then, reading only
- If the level stops fitting mid-task, stop and propose again. Also propose anew whenever the kind of work changes (e.g. implement → review)
- Levels: low = docs·progress tables·commits / medium = normal implementation·tests / high = design judgment·evaluation·review·debugging after repeated failure / xhigh+ = separate session on a higher model
- Before recommending a level, check the current session's model (2026-11-14 user instruction, all projects). Write the model with the level ("Sonnet 5.5 기준 medium"). The table above fits the project's base model. On a higher model, recommend one level lower; raise it again if the same problem fails repeatedly. If the session model differs from the project's base model, say so first
- Reason: changing the model inside a session wastes tokens (the new model rereads the whole context). So when the needed model differs from the current one and the job is large (about 5+ tool calls, or it leaves its own result such as a branch, doc or build), do not change the session model. Propose a sub-session under the lead session, state its model + effort level, and open it only after user approval. Do small jobs on the current model. Do read-only research with a subagent (set its model and effort per task). Give the sub-session a brief in the HANDOFF format with a done criterion, get the result back as a file, and verify it before reporting done. Assign each sub-session its own files; two sessions never edit the same file at once. Only the user changes a session's model; the agent detects the mismatch and says so
- If the base model is not enough, do it in a separate session on another model, return results as a file, then come back. When creating a sub-session, state its model and effort level. Set subagent effort per task

## Work method (global, 2026-10-23 user instruction; full text: `~/.claude/docs/통합_작업방식.md`)
- Projects run on plan docs + per-stage sessions: PLAN.md (fixed plan) · ROADMAP.md (progress) · HANDOFF.md (handoff, latest only) · docs/결정_기록.md (user decisions, verbatim) in the project root. One source of truth per fact
- New project or no PLAN.md yet: follow section 2 (plan first, pick size S/M/L, write it in the project CLAUDE.md). Existing project: start each work session with section 4 (read HANDOFF → ROADMAP stage → recent decisions → only the needed PLAN sections; check git state)
- Keep sessions short: split per the section 5 checklist and hand off with HANDOFF.md (section 8 template). Docs, not chat history, carry memory
- Same problem fails 3 times → stop and present options. New ideas go to ROADMAP's parking lot, not straight into scope
- Before working in a folder another session may be editing, check for it and coordinate via HANDOFF/ROADMAP instead of editing the same files at once

## 답변 문체 · 출력 형식 (global, 2026-10-26 user instruction)
- 모든 답변은 ASD-STE100 규칙을 한국어에 적용해 쓴다. 필수 규칙:
  - 한 문장에 지시 1개. 문장은 짧게 (절차문 20단어 이하, 설명문 25단어 이하)
  - 능동태. 절차는 명령형으로 쓴다 ("파일을 연다", "저장한다")
  - 한 단어에 한 뜻. 같은 대상은 항상 같은 단어로 쓴다. 동의어로 바꾸지 않는다
  - 경고(WARNING)·주의(CAUTION)는 해당 절차 단계 앞에 먼저 쓴다
  - 절차는 번호 목록. 한 단계에 동작 1개
  - 불필요한 수식어·은유·관용구를 쓰지 않는다
- 필요하면 HTML 파일로 만들어 보여준다 (표·비교·다이어그램·긴 절차). 짧은 답은 채팅에 쓴다. HTML 안의 글도 같은 STE 규칙을 따른다

## 디자인 · 모션 스킬 선택 (global, 2026-11-14 user instruction)
- 디자인·모션 요청은 `~/.claude/docs/디자인_스킬_선택표.md`의 표로 스킬 1개를 고른다
- 고른 스킬 이름을 답변 맨 위에 쓴다 (예: `🎨 스킬: impeccable`). `📋 summarizer` 표시가 있으면 그 다음 줄에 쓴다

## 코드 · 설계 검토 선택 (global, 2026-11-14 user instruction)
- 작업 끝에 `~/.claude/docs/검토_선택표.md`의 표로 검토 명령 1개를 제안한다. 사용자가 승인하면 실행한다
- 설계 문서가 절대 기준이다. 설계 문서가 코드보다 낡았으면 멈추고 사용자에게 재확인받은 뒤 문서 갱신을 요청한다
