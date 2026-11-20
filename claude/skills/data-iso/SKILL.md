---
name: data-iso
description: Draw measured data (robot paths, simulation episodes, sensor logs, floor plans with obstacles) as true-to-scale isometric technical illustrations in plain SVG + CSS, optionally with a time slider whose motion is computed from recorded state. Use whenever the user wants an isometric / axonometric / "technical drawing" style figure of real measurements, a replay of a robot run, a top-down map plus isometric view pair, or says "등각 그림", "경로 다시 보기", "시간 자", "기술 도면 스타일". Do NOT use for marketing illustrations, photoreal 3D, charts and plots (use dataviz), or ordinary page/app layout design (use frontend-design).
---

# data-iso — 자료를 크기 그대로 그리는 등각 그림

측정 자료(로봇 경로, 시뮬레이션 기록, 센서 값)를 웹(SVG + CSS)에서 등각 기술 그림으로 보인다. 그림은 꾸밈이 아니라 자료의 다른 표현이다. 그래서 크기·방향·움직임이 모두 자료에서 나와야 한다.

## 원칙 4개 (왜: 그림을 믿고 읽으려면 자료와 어긋나면 안 된다)

1. **등각 보기는 지도를 뒤로 눕힌 것이다.** 위에서 본 지도와 등각 보기에서 방의 방향이 같다. 보기를 바꿔도 경로가 돌지 않는다.
2. **닿는 크기는 자료의 크기 그대로다.** 기둥 받침 = 충돌 반지름, 벽 몸통 = 충돌 크기, 로봇 바닥 = 로봇 크기. 세부를 더해도 이 크기는 바꾸지 않는다.
3. **강조색은 주인공의 경로와 센서에만, 나머지는 종이색 4톤.** 주인공(로봇)은 그림에서 가장 어두운 물건이다.
4. **선은 반드시 무엇인가에 닿아 끝난다.** 허공에서 끝나는 선을 긋지 않는다.

그 밖에: 선은 1종(0.6 px, `vector-effect: non-scaling-stroke`), 그림자 효과(blur)·알약 모양·둥근 색 배지 없음, 글자는 그림 안에 넣지 않는다 (귀·범례·설명에 둔다).

CSP가 엄격한 화면에 붙일 때: 인라인 스크립트, `style` 속성, `innerHTML`, 외부 자원을 쓰지 않는다. 스크립트는 별도 파일로 두고 DOM은 `createElementNS`·`setAttribute`·`textContent`로 만든다 (`examples/`가 그 방식이다). CSS도 별도 `.css` 파일로 둔다. 인라인 `<style>`과 CSP `'unsafe-inline'`은 단독 시험용 HTML에만 쓴다.

## 작업 순서

1. 자료의 크기(방, 장애물, 로봇 바닥)를 먼저 적는다. 모든 닿는 크기가 여기서 나온다.
2. `references/rules.md`를 읽는다 (선·면 4톤·구성·부품 만드는 법·경로 띠). 색은 **역할 토큰**으로 쓴다. 프로젝트에 이미 색 변수가 있으면 그것에 대응시키고 새 색을 만들지 않는다.
3. 움직임(슬라이더·재생)이 있으면 `references/motion.md`도 읽는다.
4. 구현할 때 `examples/replay.js`·`replay.css`의 해당 함수를 참고한다 (`examples/README.md`에 규칙 → 함수 대응표). 그대로 복사하지 말고 자료·요구에 맞게 필요한 부분만 가져온다. 코드를 가져오면 `NOTICE`의 MIT 고지를 파일 머리에 남긴다.
5. 결과를 위의 원칙 4개로 스스로 점검하고 보고한다: 어떤 크기가 어떤 자료값인지 1줄씩.

## 파일

- `references/rules.md` — 일반 규칙
- `references/motion.md` — 움직임 규칙
- `examples/` — 경로 다시 보기 구현 (사본, 읽기용)
- `NOTICE` — anatomy(MIT) 저작권 고지
