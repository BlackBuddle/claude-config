# claude-config

Claude Code 개인 설정 묶음. 다른 컴퓨터에 같은 환경을 만든다.

## 들어 있는 것

| 경로 | 내용 |
|---|---|
| `CLAUDE.md` | 전역 지시문 |
| `docs/` | 노력 수준, 작업 방식, 요약 시스템, 디자인 스킬 선택표 |
| `agents/summarizer.md` | 요약 에이전트 |
| `skills/stageshow/` | 로컬 스킬 (계정에 올리면 이 사본은 필요 없다) |
| `setup.ps1` | 설치 스크립트 |

## 새 컴퓨터에 설치

1. Claude Code와 데스크톱 앱을 설치한다.
2. 데스크톱 앱에 같은 계정으로 로그인한다. 계정 스킬(`anthropic-skills:*`)이 들어온다.
3. 이 저장소를 받는다: `gh repo clone claude-config`
4. 폴더로 이동한다: `cd claude-config`
5. 스크립트를 실행한다: `powershell -ExecutionPolicy Bypass -File .\setup.ps1`
6. Claude Code를 다시 시작한다.

스크립트는 그 컴퓨터의 `CLAUDE.md`를 덮어쓰지 않는다.

- 공통 규칙을 `~/.claude/CLAUDE.shared.md`로 복사한다.
- 그 컴퓨터의 `CLAUDE.md` 끝에 `@CLAUDE.shared.md` 1줄을 추가한다. 이미 있으면 추가하지 않는다.
- 그 컴퓨터만의 규칙은 `CLAUDE.md`에 쓴다. 공통 규칙은 이 저장소의 `CLAUDE.md`에서 고친다.
- 두 파일에 같은 규칙이 있으면 `CLAUDE.md` 쪽을 지워 다듬는다.

그 뒤 `docs`, `agents`, `skills`를 `~/.claude`에 복사한다. 마지막으로 `ponytail`과 `frontend-design` 플러그인을 설치한다.

새 컴퓨터의 Claude Code에 "Dawnilove/claude-config 저장소를 받아 README대로 설치해 줘"라고 말해도 된다.

## 설정을 고친 뒤 올리기

1. 고친 파일을 `~/.claude`에서 이 폴더로 복사한다.
2. `git add -A`
3. `git commit -m "설정 갱신"`
4. `git push`

다른 컴퓨터에서는 `git pull`을 실행한다. 그 뒤 `setup.ps1 -SkipPlugins`를 실행한다.

## 들어 있지 않은 것

- `settings.json`: 훅 경로가 컴퓨터마다 다르다.
- `.claude.json`, `.credentials.json`: 인증 정보다. 절대 넣지 않는다.
- 메모리: 프로젝트 폴더 경로에 묶여 있다.
- `orca-cli`, `orchestration`, `jetdeck`: Madang과 JetDeck이 설치할 때 넣는다.
