# claude-config

Claude Code 개인 설정 묶음. 다른 컴퓨터에 같은 환경을 만든다.

## 1. 들어 있는 것

| 경로 | 내용 |
|---|---|
| `CLAUDE.md` | 전역 규칙 (언어, 작업 방식, 코드 유지보수 책임, 노력 수준, 선택표 사용) |
| `docs/` | 규칙의 본문 5개: 노력 수준, 작업 방식, 요약 시스템, 디자인 스킬 선택표, 검토 선택표 |
| `agents/summarizer.md` | 요약 에이전트 |
| `skills/stageshow/` | 로컬 스킬 (계정에 올리면 이 사본은 필요 없다) |
| `skills/decision-rack/` | 결재함 패널 (mod). 하위 세션이 `~/.claude/decisions/`에 올린 결재 요청·확인 요청을 우측 패널에 쌓아 보여준다. 새 결재 요청이 오면 스스로 열린다. 명령: `/decisions`. 규칙: `docs/통합_작업방식.md` 11절 |
| `skills/design-clash/` | 로컬 스킬. 디자인 스킬 3개로 시안 3개를 따로 만들고 선택기에서 비교한다. 명령: `/design-clash` |
| `hooks/reminder.txt` | 알림 훅의 문구. 메시지마다 Claude에게 규칙 4개를 알린다 |
| `plugins-backup/` | 플러그인 본체의 사본 (`ponytail`, `egm`, `frontend-design`). 백업용이다. 설치는 명령으로 한다 |
| `setup.ps1` | 설치 스크립트 |

## 2. 새 컴퓨터에 설치한다 (처음 1번)

### 2-1. 준비한다

1. Git을 설치한다.
2. GitHub CLI(`gh`)를 설치한다.
3. Claude Code와 Claude 데스크톱 앱을 설치한다.
4. 데스크톱 앱에 같은 계정으로 로그인한다. 계정 스킬(`anthropic-skills:*`)이 들어온다.
5. PowerShell에서 GitHub에 로그인한다: `gh auth login`

### 2-2. 설치한다 (PowerShell, 명령 1줄)

```powershell
gh repo clone Dawnilove/claude-config "$env:USERPROFILE\claude-config"; powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\claude-config\setup.ps1"
```

끝난 뒤 Claude Code를 다시 시작한다.

다른 방법: Claude Code에 "Dawnilove/claude-config 저장소를 받아 README대로 설치해 줘"라고 말한다.

### 2-3. 스크립트가 하는 일

| 순서 | 동작 | 기존 내용 |
|---|---|---|
| 1 | 공통 규칙을 `~/.claude/CLAUDE.shared.md`로 복사한다 | 그 컴퓨터의 `CLAUDE.md`를 덮어쓰지 않는다 |
| 2 | 그 컴퓨터의 `CLAUDE.md` 끝에 `@CLAUDE.shared.md` 1줄을 추가한다 | 이미 있으면 추가하지 않는다 |
| 3 | `docs`, `agents`, `skills`, `hooks`를 `~/.claude`에 복사한다 | 같은 이름의 파일은 덮어쓴다 |
| 4 | `settings.json`에 알림 훅 1개와 `"language": "korean"`을 추가한다 | 다른 설정과 훅은 그대로 둔다. 언어 설정이 이미 있으면 그 값을 둔다. 고치기 전의 파일은 `settings.json.bak-setup`으로 남긴다 |
| 5 | 플러그인 3개를 설치한다: `ponytail`, `frontend-design`, `egm` | 이미 있으면 건너뛴다 |

### 2-4. 설치를 확인한다

1. Claude Code에서 "전역 규칙을 요약해 줘"라고 묻는다. 규칙이 나오면 `@CLAUDE.shared.md`가 작동한다.
2. `/anthropic-skills:prototype`를 입력한다. 응답이 나오면 계정 스킬이 작동한다.
3. 플러그인 목록을 본다: `claude plugin list`
4. 작은 코딩 작업을 시킨다. Claude가 작업 전에 노력 수준을 말하고, 작업 끝에 검토 명령을 제안하면 정상이다.

## 3. 저장소의 변경을 다른 컴퓨터에 적용한다

저장소에 새 커밋이 올라온 뒤에 실행한다. 플러그인은 다시 설치하지 않는다.

```powershell
git -C "$env:USERPROFILE\claude-config" pull; powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\claude-config\setup.ps1" -SkipPlugins
```

끝난 뒤 Claude Code를 다시 시작한다. 자동으로 적용되지 않는다. 변경이 있을 때마다 이 명령을 실행한다.

## 4. 고친 설정을 저장소에 올린다

주의: 올리기 전에 항상 `git pull --rebase`를 먼저 실행한다. 다른 컴퓨터나 다른 세션이 먼저 올렸을 수 있다.

### 4-1. 어느 파일을 고치는가

| 컴퓨터 | 공통 규칙이 있는 파일 | 저장소로 복사할 때 |
|---|---|---|
| 원본 컴퓨터 (`setup.ps1`을 실행하지 않은 곳) | `~/.claude/CLAUDE.md` | `CLAUDE.md` → 저장소의 `CLAUDE.md` |
| 설치로 만든 컴퓨터 | `~/.claude/CLAUDE.shared.md` | `CLAUDE.shared.md` → 저장소의 `CLAUDE.md` |

설치로 만든 컴퓨터의 `~/.claude/CLAUDE.md`는 그 컴퓨터만의 규칙이다. 저장소에 올리지 않는다.

### 4-2. 원본 컴퓨터에서 올린다

```powershell
$c="$env:USERPROFILE\.claude"; $r="$env:USERPROFILE\claude-config"
git -C $r pull --rebase
Copy-Item "$c\CLAUDE.md" $r -Force
Copy-Item "$c\docs\*" "$r\docs" -Force
Copy-Item "$c\agents\*" "$r\agents" -Force
Copy-Item "$c\hooks\reminder.txt" "$r\hooks" -Force
Copy-Item "$c\skills\design-clash" "$r\skills" -Recurse -Force
git -C $r add -A
git -C $r commit -m "설정 갱신"
git -C $r push
```

### 4-3. 설치로 만든 컴퓨터에서 올린다

4-2와 같다. 3번째 줄만 다르다.

```powershell
Copy-Item "$c\CLAUDE.shared.md" "$r\CLAUDE.md" -Force
```

### 4-4. Claude에게 시킨다

Claude Code에 "전역 설정을 claude-config 저장소에 올려 줘"라고 말한다. Claude는 올리기 전에 확인을 받는다.

## 5. 되돌린다

| 대상 | 방법 |
|---|---|
| `settings.json` | `settings.json.bak-setup`을 `settings.json`으로 복사한다 |
| 공통 규칙 | 그 컴퓨터의 `CLAUDE.md`에서 `@CLAUDE.shared.md` 줄을 지운다 |
| 플러그인 | `claude plugin uninstall egm@egm` (다른 플러그인도 같은 형식이다) |
| 저장소의 이전 버전 | `git -C "$env:USERPROFILE\claude-config" log --oneline`으로 커밋을 찾는다. `git checkout <커밋> -- <파일>`로 그 파일만 되돌린다 |

## 6. 들어 있지 않은 것

- `settings.json`: 훅 경로가 컴퓨터마다 다르다. `setup.ps1`이 알림 훅과 언어 설정만 추가한다.
- `.claude.json`, `.credentials.json`: 인증 정보다. 절대 넣지 않는다.
- 메모리: 프로젝트 폴더 경로에 묶여 있다. 컴퓨터마다 따로 쌓인다.
- 계정 스킬: 계정이 보관한다. 데스크톱 앱에 로그인하면 들어온다.
- `orca-cli`, `orchestration`, `jetdeck`: Madang과 JetDeck이 설치할 때 넣는다.

## 7. 문제가 생기면

| 증상 | 원인과 해결 |
|---|---|
| `git push`가 거절된다 | 다른 곳에서 먼저 올렸다. `git pull --rebase`를 실행한 뒤 다시 올린다 |
| 계정 스킬이 안 보인다 | 데스크톱 앱에 같은 계정으로 로그인했는지 확인한다. 앱을 다시 시작한다 |
| 규칙이 적용되지 않는다 | Claude Code를 다시 시작한다. 규칙은 새 세션부터 적용된다 |
| 알림이 들어오지 않는다 | `settings.json`의 `hooks.UserPromptSubmit`에 `reminder.txt`를 읽는 명령이 있는지 확인한다. 없으면 `setup.ps1 -SkipPlugins`를 다시 실행한다 |
| 플러그인 설치가 실패한다 | `claude` 명령이 있는지 확인한다. 본체의 사본은 `plugins-backup/`에 있다 |
