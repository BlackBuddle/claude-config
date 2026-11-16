import { expect, test } from 'claude-code/testing'

import { classify, corruptReason, draw, measure } from './register'

// 요소 생성기를 그대로 돌려주는 가짜 표: 그리는 함수가 어떤 글자를 내는지만 본다.
const fake = { Box: (p: any) => p, Text: (p: any) => p, Button: (p: any) => p }
const held = (report: any, over: any = {}) => ({ command: 'rm -rf build', risk: { kind: 'rm', label: 'rm -rf' }, report, decision: null, where: 'pane', cwd: '/proj', showCommand: false, leftMs: 582_000, ...over })

test('확인 패널은 영향 → 복구 → 위치 순이고 명령은 접혀 있다', () => {
  const json = JSON.stringify(draw(fake, held({ summary: '파일 2개 삭제', lines: ['/proj/a.txt', 'b.txt'], recover: [['warn', '⚠ 휴지통을 거치지 않습니다']] }) as any))
  expect(json.indexOf('파일 2개 삭제')).toBeLessThan(json.indexOf('휴지통'))
  expect(json.indexOf('휴지통')).toBeLessThan(json.indexOf('위치'))
  expect(json.indexOf('위치')).toBeLessThan(json.indexOf('a.txt'))
  expect(json).toContain('▸ 명령 보기')
  expect(json).not.toContain('rm -rf build') // 접힌 명령은 그리지 않는다
  expect(json).toContain('9:42 남음')
  expect(json).toContain('"a.txt"') // 폴더 앞부분은 뺀 상대 경로
  // 취소는 왼쪽에 두고 강조한다
  expect(json.indexOf('"취소"')).toBeLessThan(json.indexOf('"진행"'))
  // 단축키 번호도 버튼 순서와 같다
  expect(json).toContain('"label":"취소","hotkey":"1"')
  expect(json).toContain('"label":"진행","hotkey":"2"')
  expect(json).toContain('"variant":"primary"')
})

test('git 변경 목록은 글자 배지와 해시로 나눠 그린다', () => {
  const json = JSON.stringify(draw(fake, held({ summary: '변경 2개', lines: [' M a.txt', 'A  c.txt', 'a1b2c3d 커밋 제목'] }, { risk: { kind: 'git-reset', label: 'git reset --hard' } }) as any))
  expect(json).toContain('변경 버리기')
  expect(json).toContain('"children":"M"')
  expect(json).toContain('"children":"A"')
  expect(json).toContain('"children":"a1b2c3d"')
})

test('모름 패널은 명령을 펼치고 변수를 오류 색으로 낸다', () => {
  const json = JSON.stringify(
    draw(fake, held({ summary: '지울 대상을 확인하지 못했습니다', lines: [], unknown: true, facts: [['원인', '변수 $D 를 풀지 못했습니다']] }, { showCommand: true, command: 'rm -rf "$D"' })) as any,
  )
  expect(json).toContain('영향 범위 모름')
  expect(json).toContain('그래도 진행')
  expect(json).toContain('원인')
  expect(json).toMatch(/"color":"error"[^}]*"children":"\$D"/) // 명령 안의 $D
  // 시안 C: 위치 줄과 접기 버튼이 없고 명령 상자만 항상 보인다
  expect(json).not.toContain('"위치"')
  expect(json).not.toContain('명령 접기')
  expect(json).toContain('cmdbox')
})

test('긴 명령은 상자에 몇 줄만 보인다', () => {
  const long = Array.from({ length: 10 }, (_, i) => `echo ${i}`).join('\n')
  const json = JSON.stringify(draw(fake, held({ summary: '지울 대상을 확인하지 못했습니다', lines: [], unknown: true }, { showCommand: true, command: long })) as any)
  expect(json).toContain('echo 5')
  expect(json).not.toContain('echo 6')
  expect(json).toContain('… 외 4줄')
})

test('패널을 못 놓는 창은 한 줄 구성으로 그린다', () => {
  const json = JSON.stringify(draw(fake, held({ summary: '파일 9개 · 820 KB 삭제', lines: ['a'], recover: [['warn', '⚠ 휴지통을 거치지 않습니다']] }) as any, true))
  expect(json).toContain('⚠ 삭제 확인')
  expect(json).toContain('파일 9개')
  expect(json).not.toContain('▸ 명령 보기') // 접기 버튼과 목록은 없다
})

// Svg 를 그릴 수 있는 화면(데스크톱)은 시안 7번(흰 카드)대로 그린다. 없는 화면은 위의 글자 디자인 시험이 지킨다.
const fakeSvg = { ...fake, Svg: (p: any) => p }
// 카드는 Svg 이미지 조각이라 글자는 조각 안에 있다. 조각의 source 만 모아서 본다.
const sources = (node: any): string[] => (Array.isArray(node) ? node.flatMap(sources) : node && typeof node === 'object' ? [...(typeof node.source === 'string' ? [node.source] : []), ...Object.values(node).flatMap(sources)] : [])
const cardSvg = (state: any) => sources(draw(fakeSvg, state as any)).join('\n')

test('데스크톱 경고 카드는 시안 7번의 알약·원인·명령 블록·카운트다운을 그린다', () => {
  const unknown = { summary: '지울 대상을 확인하지 못했습니다', lines: [], unknown: true, recover: [['mute', '파일이 없다는 뜻이 아닙니다.']], facts: [['원인', '변수 $D 를 풀지 못했습니다']] }
  const svg = cardSvg(held(unknown, { command: 'rm -rf "$D"', leftMs: 582_000 }))
  expect(svg).toContain('영향 범위 모름') // 호박 알약
  expect(svg).toContain('fill="#FEF3C7"')
  expect(svg).toContain('지울 대상을') // 폭이 좁아 제목은 두 줄로 나뉠 수 있다
  expect(svg).toContain('못했습니다')
  expect(svg).toContain('원인')
  expect(svg).toMatch(/fill="#92400E" font-family="[^"]*" font-weight="400">\$D</) // 풀지 못한 변수는 코드 글씨
  expect(svg).toContain('rx="10" fill="#14172B"') // 어두운 명령 블록
  expect(svg).toMatch(/fill="#FB7185" font-family="[^"]*" font-weight="700" text-decoration="underline">rm -rf</) // 위험 명령: 로즈 굵게 밑줄
  expect(svg).toContain('>9:42</tspan>')
  expect(svg).toContain('> 남음</tspan>')
  expect(svg).toMatch(/height="3" rx="1.5" fill="#14172B"/) // 30초 넘게 남으면 검정 단색 막대
  expect(svg).not.toContain('linearGradient') // 그라데이션은 쓰지 않는다
  expect(svg.match(/stroke-linejoin/g)?.length).toBe(1) // 경고 아이콘은 위쪽 알약에 하나뿐
  expect(svg).not.toContain('fill="#F43F5E" rx') // 로즈 단색 막대는 마지막 30초에만
})

test('버튼은 호스트 버튼이고 단축키 1·2 와 순서를 지킨다', () => {
  const json = JSON.stringify(draw(fakeSvg, held({ summary: '파일 2개 삭제', lines: [] }) as any))
  expect(json.indexOf('"label":"취소"')).toBeLessThan(json.indexOf('"label":"진행"'))
  expect(json).toContain('"label":"취소","hotkey":"1"')
  expect(json).toContain('"label":"진행","hotkey":"2"')
  // 버튼은 호스트 기본 모양 그대로다(색 칩은 그려지지 않는다). 카드 테두리는 얇은 단색이다.
  expect(json).toContain('"label":"취소","hotkey":"1","autoFocus":true}') // 취소·진행에는 variant 도 칩도 없다
  expect(json).toContain('"label":"진행","hotkey":"2"}')
  expect(json).not.toContain('"paddingLeft":"xs"')
  expect(json).toContain('"borderColor":"#F6D58A"')
  // 왼쪽 4px 세로 막대는 이미지 조각 안에 그린다
  expect(cardSvg(held({ summary: '파일 2개 삭제', lines: [] }))).toContain('<rect x="0" y="0" width="4"')
})

test('마지막 30초는 카운트다운이 로즈 단색으로 바뀐다', () => {
  const report = { summary: '파일 2개 삭제', lines: [] }
  const svg = cardSvg(held(report, { leftMs: 20_000 }))
  expect(svg).toContain('>0:20</tspan>')
  expect(svg).toContain('fill="#BE123C" font-family="\'JetBrains Mono\'') // 시간 글씨도 로즈
  expect(svg).toMatch(/height="3" rx="1.5" fill="#F43F5E"/)
  expect(cardSvg(held(report, { leftMs: 582_000 }))).not.toMatch(/height="3" rx="1.5" fill="#F43F5E"/)
})

test('세 줄을 넘는 명령은 접고 더 보기로 펼치며, 접어도 위험 명령은 가려지지 않는다', () => {
  const cmd = Array.from({ length: 6 }, (_, i) => `echo ${i}`).join('\n')
  const unknown = { summary: '지울 대상을 확인하지 못했습니다', lines: [], unknown: true }
  const folded = held(unknown, { command: cmd })
  expect(cardSvg(folded)).not.toContain('echo 5')
  expect(JSON.stringify(draw(fakeSvg, folded as any))).toContain('"label":"더 보기 ▾"')
  const open = held(unknown, { command: cmd, expand: true })
  expect(cardSvg(open)).toContain('echo 5')
  expect(JSON.stringify(draw(fakeSvg, open as any))).toContain('"label":"접기 ▴"')
  // 위험 명령이 접힌 뒤쪽에 있어도 그 줄이 보인다
  const far = `${Array.from({ length: 5 }, (_, i) => `echo line${i}`).join('\n')}\nrm -rf build`
  expect(cardSvg(held(unknown, { command: far }))).toContain('rm -rf')
})

test('파일 삭제 확인 카드는 복구 경고·위치·파일 목록을 그리고 명령은 접혀 있다', () => {
  const report = { summary: '파일 2개 · 2.0 KB 삭제', lines: ['/proj/a.txt', 'b.txt'], recover: [['warn', '⚠ 휴지통을 거치지 않습니다 · git 에 올려 둔 파일이면 되살릴 수 있습니다']] }
  const state = held(report, { command: 'rm -rf build' })
  const svg = cardSvg(state)
  expect(svg).toContain('삭제 확인')
  expect(svg).toContain('휴지통을 거치지 않습니다')
  expect(svg).toContain('되살릴') // 보조 문구는 폭에 따라 줄이 나뉜다
  expect(svg).toContain('위치')
  expect(svg).toContain('a.txt')
  expect(svg).not.toContain('rm -rf build') // 접힌 명령은 그리지 않는다(위쪽 이름표의 rm -rf 는 따로)
  expect(JSON.stringify(draw(fakeSvg, state as any))).toContain('"label":"▸ 명령 보기"')
})

test('좁은 창에서도 영향을 모르면 명령 첫 줄을 보인다', () => {
  const unknown = JSON.stringify(draw(fake, held({ summary: '지울 대상을 확인하지 못했습니다', lines: [], unknown: true }, { command: 'rm -rf "$D"' }) as any, true))
  expect(unknown).toContain('rm -rf')
  const known = JSON.stringify(draw(fake, held({ summary: '파일 9개 삭제', lines: [] }) as any, true))
  expect(known).not.toContain('rm -rf build')
})

test('지울 파일을 세면 되돌릴 수 있는지 모름으로 적는다', async () => {
  const run = { process: { run: async () => ({ stdout: '2 2048 1\n./a\n./b\n', stderr: '', exitCode: 0 }) } }
  const r = await measure(run, { kind: 'rm', label: 'rm -rf', targets: ['d'] }, '/')
  expect(r.lines).toEqual(['a', 'b'])
  expect(r.summary).toContain('파일 2개 · 2.0 KB 삭제')
  expect(r.recover?.[0][1]).toContain('git 에 올려 둔 파일이면 되살릴 수 있습니다')
})

// 영향 범위를 못 읽었을 때는 "없음"이 아니라 "모름"이어야 한다.
test('변수 경로·측정 실패·미리 셀 수 없는 명령은 모름으로 낸다', async () => {
  const none = { process: { run: async () => ({ stdout: '0 0 0\n', stderr: '', exitCode: 0 }) } }
  const rm = (targets: string[]) => ({ kind: 'rm', label: 'rm -rf', targets })

  expect((await measure(none, rm(['$D/build']), '/')).unknown).toBe(true)
  // 변수가 없는 경로가 정말 없으면 지금처럼 "없음"을 말한다
  const missing = await measure(none, rm(['nothere']), '/')
  expect(missing.unknown).toBeUndefined()
  expect(missing.summary).toContain('지울 것이 없음')

  const psNone = { process: { run: async () => ({ stdout: '0 0\n', stderr: '', exitCode: 0 }) } }
  const ps = await measure(psNone, { kind: 'ps-remove', label: 'Remove-Item -Recurse', targets: ['$env:TEMP\\x'] }, '/')
  expect(ps.unknown).toBe(true)

  expect((await measure(none, { kind: 'unmeasured', label: 'find -delete' }, '/')).unknown).toBe(true)

  const broken = { process: { run: async () => { throw new Error('bash 없음') } } }
  const failed = await measure(broken, rm(['a']), '/')
  expect(failed.unknown).toBe(true)
  expect(failed.recover?.[0][1]).toContain('없다는 뜻이 아닙니다')
})

// 따옴표 안의 글자와 heredoc 본문은 명령이 아니다 (리뷰가 찾은 오탐).
test('따옴표 안과 heredoc 본문의 글자에는 걸리지 않는다', () => {
  expect(corruptReason('git commit -m "docs: sed -i 사용법 설명"', 'Bash')).toBeNull()
  expect(classify('git commit -m "docs; rm -rf x"', 'Bash')).toBeNull()
  expect(corruptReason('python3 -c "import sys; sys.stdout.write(open(a).read())"', 'Bash')).toBeNull()
  expect(corruptReason('psql <<EOF > /dev/null\nselect 1;\nEOF', 'Bash')).toBeNull()
  expect(classify('git clean -n', 'Bash')).toBeNull()
  expect(classify('git clean -nd', 'Bash')).toBeNull()
  expect(classify('echo hi 2>&1', 'Bash')).toBeNull()
})

// 새던 명령은 이제 잡힌다 (리뷰가 찾은 미탐).
test('새던 명령을 잡는다', () => {
  expect(corruptReason("sed -ie 's/a/b/' x", 'Bash')).toBe('sed -i')
  expect(corruptReason('tee a.txt <<EOF\nhi\nEOF', 'Bash')).toBe('heredoc 으로 파일 쓰기')
  expect(corruptReason("python -c \"p=open('a').read().replace('x','y'); open('a','w').write(p)\"", 'PowerShell')).toBe('python 문자열 치환 후 덮어쓰기')
  expect(corruptReason("(Get-Content a) -creplace 'a','b' | Set-Content a", 'PowerShell')).toBe('PowerShell 문자열 치환 후 덮어쓰기')

  expect(classify('git push -uf origin main', 'Bash')?.kind).toBe('git-push-force')
  expect(classify('git push --force-if-includes', 'Bash')?.kind).toBe('git-push-force')
  expect(classify('git ls-files | xargs rm -rf', 'Bash')?.kind).toBe('unmeasured')
  expect(classify('find . -name "*.tmp" -delete', 'Bash')?.kind).toBe('unmeasured')
  expect(classify('find . -exec rm {} ;', 'Bash')?.kind).toBe('unmeasured')
  expect(classify('bash -c "rm -rf build"', 'Bash')?.kind).toBe('rm')
  expect(classify('Remove-Item -Rec build', 'PowerShell')?.kind).toBe('ps-remove')
  expect(classify('gci -Recurse | Remove-Item', 'PowerShell')?.kind).toBe('unmeasured')
  expect(classify('powershell -Command "Remove-Item -Recurse x"', 'Bash')?.kind).toBe('ps-remove')
})

// 재리뷰가 찾은 지적.
test('heredoc 은 진짜 표시만 인식하고, 실행되는 본문은 지우지 않는다', () => {
  // here-string, 산술 시프트, 따옴표 안의 << 뒤 줄은 본문이 아니다
  expect(classify('cat <<< "x"\nrm -rf build', 'Bash')?.kind).toBe('rm')
  expect(classify('echo $((1<<2))\nrm -rf build', 'Bash')?.kind).toBe('rm')
  expect(classify('echo "a <<EOF"\nrm -rf build', 'Bash')?.kind).toBe('rm')
  // 해석기가 실행하는 본문은 명령이다
  expect(classify('bash <<EOF\nrm -rf build\nEOF', 'Bash')?.kind).toBe('rm')
  // 파일에 쓰는 본문은 글자이므로 걸리지 않는다
  expect(classify("cat > doc.md <<'EOF'\nrm -rf build\nEOF", 'Bash')).toBeNull()
})

test('앞에 붙은 sudo·env·옵션과 약어, 안쪽 따옴표를 푼다', () => {
  expect(classify('sudo bash -c "rm -rf build"', 'Bash')?.kind).toBe('rm')
  expect(classify('env FOO=1 bash -e -c "rm -rf build"', 'Bash')?.kind).toBe('rm')
  expect(classify('powershell -Comm "Remove-Item -Recurse x"', 'Bash')?.kind).toBe('ps-remove')
  expect(classify('bash -c "rm -rf \\"my dir\\""', 'Bash')?.targets).toEqual(['my dir'])
  expect(corruptReason('bash -c "sed -i s/a/b/ x"', 'Bash')).toBe('sed -i')
})

test('미리보기와 옵션이 아닌 글자는 통과한다', () => {
  expect(classify('Remove-Item -Recurse x -WhatIf', 'PowerShell')).toBeNull()
  expect(classify('gci -Recurse | Remove-Item -WhatIf', 'PowerShell')).toBeNull()
  expect(corruptReason('perl -Mstrict -Mwarnings -e "print 1"', 'Bash')).toBeNull()
  expect(corruptReason('perl -pi -e "s/a/b/" x', 'Bash')).toBe('perl -i')
  expect(corruptReason('make | tee log; psql <<EOF\nselect 1;\nEOF', 'Bash')).toBeNull()
})

test('원래 잡던 것은 계속 잡는다', () => {
  expect(corruptReason("sed -i 's/a/b/' src/x.ts", 'Bash')).toBe('sed -i')
  expect(corruptReason("cat > a.txt <<'EOF'\nhi\nEOF", 'Bash')).toBe('heredoc 으로 파일 쓰기')
  expect(classify('rm -rf "my dir" && ls', 'Bash')?.targets).toEqual(['my dir'])
  expect(classify('git reset --hard HEAD~3', 'Bash')?.kind).toBe('git-reset')
  expect(classify('ls -la', 'Bash')).toBeNull()
  expect(classify('git status', 'Bash')).toBeNull()
})

// 각 시험의 첫 on('tool.call') 이 엔진을 대신한다: 막히지 않은 호출은 거기까지 내려온다.
test('파일을 깨뜨리는 명령은 한국어 사유로 거부된다', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const cases = [
    "sed -i 's/a/b/' src/x.ts",
    "cat > a.txt <<'EOF'\nhi\nEOF",
    'python3 -c "p=open(\'a\').read().replace(\'x\',\'y\'); open(\'a\',\'w\').write(p)"',
  ]
  for (const command of cases) {
    const r: any = await $.tool.call({ tool: 'Bash', command })
    expect(String(r.deny)).toContain('edit-guard')
    // 시안 F: 이름표(이유·대신·재시도)를 줄로 나눈다
    expect(String(r.deny)).toContain('✗ edit-guard 막음')
    expect(String(r.deny)).toMatch(/\n이유 .*\n대신 .*\n재시도 /)
  }

  const ps: any = await $.tool.call({ tool: 'PowerShell', command: "(Get-Content a.txt) -replace 'a','b' | Set-Content a.txt" })
  expect(String(ps.deny)).toContain('edit-guard')
})

test('읽기 명령과 일반 명령은 그대로 지나간다', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const command of ['ls -la', 'git status', 'sed -n 1,5p a.txt', 'cat a.txt']) {
    const r: any = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny).toBeUndefined()
  }
})
