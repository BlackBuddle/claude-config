# superpowers-lite

[obra/superpowers](https://github.com/obra/superpowers)의 사본이다. 내 작업 방식(PLAN·ROADMAP·HANDOFF, relay, 검토 선택표)과 겹치지 않는 스킬 4개만 남겼다. 2026-11-18 사용자 결정: "포크해 맞춰 설치".

- 원본: 7.0.2, 커밋 `22f0b46`. 라이선스 MIT (`LICENSE`는 원본 그대로).
- 본문은 영어 그대로 둔다. 원본과 비교하기 쉽게 하기 위해서다.

## 남긴 스킬

| 스킬 | 언제 |
|---|---|
| `brainstorming` | 새 프로젝트·기능을 계획하는데 원하는 것이 아직 분명하지 않을 때 |
| `test-driven-development` | 기능·버그 수정을 구현하기 전 (실패하는 테스트 먼저) |
| `systematic-debugging` | 버그·테스트 실패를 고치기 전 (원인 먼저) |
| `verification-before-completion` | "완료·통과"라고 말하기 전 (실행 결과 먼저) |

## 원본에서 바꾼 것

| 파일 | 바꾼 것 | 이유 |
|---|---|---|
| `brainstorming/SKILL.md` description | "You MUST use this before any creative work" → 원하는 것이 분명하지 않을 때만 | 작은 일에도 질문이 길어진다 (ponytail, 토큰 절약) |
| `brainstorming/SKILL.md` 설계 문서 위치 | `docs/superpowers/specs/...`에 쓰고 커밋 → 프로젝트의 `PLAN.md`, 커밋하지 않음 | 설계 문서는 `PLAN.md` 1개. 커밋 전 확인 규칙 |
| `brainstorming/SKILL.md` 다음 단계 (2곳) | `superpowers:writing-plans` 호출 → 통합_작업방식, 검토 선택표, ROADMAP | writing-plans는 뺐다 |
| `systematic-debugging/SKILL.md` | `superpowers:` → `superpowers-lite:` | 플러그인 이름이 바뀌었다 |
| `test-driven-development/writing-good-tests.md` | `superpowers:writing-skills` → skill-creator | writing-skills는 뺐다 |
| `.claude-plugin/plugin.json` | 새로 씀 | 이름·설명 |

## 뺀 것

- `using-superpowers` 스킬과 세션 시작 훅: 매 세션 "스킬을 반드시 써라"를 넣는다.
- `writing-plans`, `executing-plans`, `subagent-driven-development`, `dispatching-parallel-agents`: PLAN·ROADMAP, 하위 세션 규칙, relay와 겹친다.
- `requesting-code-review`, `receiving-code-review`: 검토 선택표, relay-review와 겹친다.
- `finishing-a-development-branch`, `using-git-worktrees`: 커밋·push 전 확인 규칙과 부딪힌다.
- `writing-skills`, `diagnosing-superpowers`: skill-creator가 있다. 진단 스킬은 뺀 훅에만 쓰인다.

## 원본이 바뀌면

```powershell
git clone --depth 1 https://github.com/obra/superpowers.git $env:TEMP\sp
git -C $env:TEMP\sp log --oneline 22f0b46..HEAD -- skills/brainstorming skills/test-driven-development skills/systematic-debugging skills/verification-before-completion
```

바뀐 스킬만 위 표의 수정을 다시 적용해 복사한다. 그 뒤 이 파일의 커밋 해시를 고친다.

## 확인하지 못한 것

- `brainstorming`의 Visual Companion(브라우저 시안 서버): `.sh` 스크립트라 Windows에서는 Git Bash가 필요하다. 동작은 확인하지 않았다.
