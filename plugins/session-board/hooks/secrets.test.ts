import { expect, test } from 'claude-code/testing'

import { secretInCommand, secretPath } from './secrets'

test('비밀 파일 경로를 알아본다', () => {
  expect(secretPath('C:\\proj\\.env')).toBe('.env')
  expect(secretPath('/proj/.env.local')).toBe('.env.local')
  expect(secretPath('C:\\Users\\me\\.claude\\.credentials.json')).toBe('.credentials.json')
  expect(secretPath('/home/me/.ssh/id_ed25519')).toBe('id_ed25519')
  expect(secretPath('/proj/server.pem')).toBe('server.pem')
})

test('예시·일반 파일은 막지 않는다', () => {
  expect(secretPath('/proj/.env.example')).toBe(null)
  expect(secretPath('/proj/.env.sample')).toBe(null)
  expect(secretPath('/proj/id_ed25519.pub')).toBe(null)
  expect(secretPath('/proj/environment.ts')).toBe(null)
  expect(secretPath('')).toBe(null)
})

test('셸 명령에서 비밀 파일 읽기를 찾는다', () => {
  expect(secretInCommand('cat .env')).toBe('.env')
  expect(secretInCommand('Get-Content C:\\Users\\me\\.claude\\.credentials.json')).toBe('.credentials.json')
  expect(secretInCommand('type "secrets\\.env.production"')).toBe('.env.production')
  expect(secretInCommand('cat .env.example')).toBe(null)
  expect(secretInCommand('git status')).toBe(null)
})

test('검색 패턴 속 정규식 글자는 파일로 보지 않는다', () => {
  // 2026-11-18 오탐: 검색 패턴의 \.env 를 파일로 읽어 막았다
  expect(secretInCommand(`git ls-files | Select-String -Pattern '\\.credentials|(^|/)\\.env'`)).toBe(null)
  expect(secretInCommand('grep -E "\\.env$" list.txt')).toBe(null)
  // 경로는 그대로 막는다: 드라이브 경로, 상대 경로, UNC 경로
  expect(secretInCommand('Get-Content C:\\proj\\.env')).toBe('.env')
  expect(secretInCommand('cat .\\.env')).toBe('.env')
  expect(secretInCommand('type \\\\server\\share\\.env')).toBe('.env')
})
