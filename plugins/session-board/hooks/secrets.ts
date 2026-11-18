// secret-guard: 비밀 파일(.env, .credentials.json, 개인 키)의 내용이 대화로 들어오는 것을 막는다.
// 생각은 open-gsd/gsd-core 의 시크릿 가드에서 가져왔다 (2026-11-18 사용자 결정: 흡수).
// 읽기만 막는다. 만들기·복사(cp .env.example .env)는 내용이 대화로 오지 않으므로 지나간다.

import type { Register } from 'claude-code'

const SECRET_NAME = /^(\.env(\..+)?|\.credentials\.json|id_(rsa|dsa|ecdsa|ed25519)|.+\.(pem|key|p12|pfx))$/i
const SAFE_SUFFIX = /\.(example|sample|template|dist|pub)$/i
// 파일 내용을 출력하는 명령. 이 명령이 있을 때만 셸 명령을 막는다
const READ_VERB = /(^|[\s;|&(])(cat|type|gc|get-content|head|tail|less|more|bat|select-string|grep|rg|base64|xxd|od|strings)(\.exe)?(?=[\s]|$)/i

export function secretPath(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? ''
  if (name === '' || SAFE_SUFFIX.test(name)) return null
  return SECRET_NAME.test(name) ? name : null
}

export function secretInCommand(command: string): string | null {
  if (!READ_VERB.test(command)) return null
  for (const token of command.split(/[\s;|&()<>]+/)) {
    const word = token.replace(/^['"]|['"]$/g, '')
    // 백슬래시 1개로 시작하면 검색 패턴의 정규식(\.env)이다. 경로는 C:\, .\, \\server(UNC)로 시작한다
    if (/^\\(?!\\)/.test(word)) continue
    const hit = secretPath(word)
    if (hit !== null) return hit
  }
  return null
}

const deny = (name: string) => ({
  deny: `✗ secret-guard 막음 · ${name}\n이유   비밀 파일의 내용이 대화와 기록에 남습니다\n대신   필요한 값의 이름만 사용자에게 묻거나, .example 파일을 읽으세요\n재시도 사용자가 이 파일을 읽으라고 직접 요청한 경우에만 사용자에게 직접 열어 보라고 안내하세요`,
})

export const register: Register = on => {
  on('tool.call', { tool: 'Read' }, ($, e, next) => {
    const hit = secretPath(String((e as any).file_path ?? ''))
    return hit === null ? next(e) : deny(hit)
  })
  for (const tool of ['Bash', 'PowerShell'] as const) {
    on('tool.call', { tool }, ($, e, next) => {
      const hit = secretInCommand(String((e as any).command ?? ''))
      return hit === null ? next(e) : deny(hit)
    })
  }
}
