# ROADMAP (규모: S)

claude-config의 진행과 "나중에" 항목. 결정의 원문은 `docs/결정_기록.md`에 있다. 이 파일은 다음에 할 일과 날짜만 둔다.

## 끝난 일

| 날짜 | 일 | 커밋 |
|---|---|---|
| 2026-11-18 | 외부 저장소 17개 흡수 계획 7단계 (설치 3, 가드·/ship, /recall, plugins/ 정리·superpowers-lite, humanizer-ko, 띠 제안·인계 단추, ruflo·slides 규칙) | 1aac686 ~ a31a839 |
| 2026-11-18 | 비밀 파일 가드 오탐 수정, 위험 명령 확인을 선택 카드로 (원격 화면 대응), 턴 중단 시 멈춤 수정 | fdbfa35 ~ 5e39521 |

## 확인할 것

- [x] 앱 재시작: 새 플러그인 경로가 적용되었다 (2026-11-18)
- [x] 위험 명령의 선택 카드가 뜬다 (2026-11-18, 시험 폴더 삭제)
- [x] 중단(Esc) 뒤에도 다음 위험 명령을 다시 붙잡는다 (2026-11-18)
- [x] 위험 명령 확인 카드: 잘못된 카드가 또 나와서 지웠다 (2026-11-19). 파일을 깨뜨리는 명령 거부는 남겼다
- [ ] graphify: 프로젝트 1개에서 `/graphify .`를 써 본다. 쓸모가 있으면 그 프로젝트에만 `graphify hook install`(커밋 때 다시 만들기)을 켠다. Claude Code 훅(`graphify claude install`)은 쓰지 않는다
- [x] 앱 권한 `ask` 규칙: auto 모드에서도 승인 창이 1개만 뜬다. 묶음 명령(`S=… && rm -rf $S`)도 걸린다 (2026-11-19)
- [ ] 띠의 노력 수준 알약, 컨텍스트 50% 이상의 `인계 ▸`, 비밀 파일 가드, 새 스킬(`/recall`, superpowers-lite, humanizer-ko)
- [ ] 다른 PC: README 3절의 갱신 명령 실행 (플러그인 폴더가 `plugins/`로 옮겨졌다)

## 마감이 있는 일

| 마감 | 일 |
|---|---|
| 2026-12-18 | `/improve` 1달 시험 끝. `/ponytail-audit`와 비교해 검토 선택표에 1개만 남긴다 |

## 보관함 (조건이 생기면 다시 본다)

| 항목 | 다시 볼 조건 |
|---|---|
| vectorize-io/hindsight (기억 서버) | Docker를 배운 뒤 |
| elementalsouls/Claude-BugHunter | CTF·버그바운티를 시작할 때 |
| google-research/paper-orchestra | 논문을 쓸 때 (별도 폴더에서 시험) |
| google-research/harness2 | 논문으로만 읽는다 |
