# examples

`replay.js`, `replay.css`는 이 저장소 `kit/`의 사본이다 (바이트 동일, 읽기용). 원본: `kit/replay.js`, `kit/replay.css`, 커밋 9763461 기준. 고치지 않는다. 필요한 함수를 참고해 새 코드를 쓴다. anatomy MIT 고지는 `../NOTICE`와 `replay.js` 머리에 있다.

## 규칙 → 코드 (`replay.js`의 함수 이름)

| 규칙 | 함수 |
|---|---|
| 카메라, 투영 | `cameraOf`, `iso`, `depthOf`, `towardViewer` |
| 입체 그리기 순서 | `drawSolid`, `extrude`, `cylinder`, `prism`, `stadium` |
| 받침판·눈금 자 | `drawBase` |
| 기둥·벽 | `pillar`, `wall`, `isoShapes`, `planShapes` |
| 로봇 | `chassisOf`, `robotIso`, `robotPlan`, `tread` |
| 앞뒤 순서 | `inFront`, `orderShapes` |
| 경로 시간 자 | `trailOf`, `drawTrail`, `layTrail`, `drawGoal` |
| 보간·읽은 값 | `poseAt`, `odometryOf`, `readOut`, `tick` |
| 요소 재사용 | `redraw` |
| 그림판 크기 | `frameOf`, `boundsOf` |

색 변수는 `replay.css`가 쓰는 이름(`--card`, `--accent` 등)을 프로젝트 변수로 바꿔 쓴다.
