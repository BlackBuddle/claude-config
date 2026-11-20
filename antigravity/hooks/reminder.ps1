# Antigravity PreInvocation hook: inject reminder.txt once per turn (only before the first model call).
# Output contract: {"injectSteps":[{"ephemeralMessage":"..."}]} on stdout; empty output = no change.
try {
    $event = [Console]::In.ReadToEnd() | ConvertFrom-Json
} catch {
    exit 0   # unreadable input: never block the agent
}
if ($event.invocationNum -ne 0) { exit 0 }
# ReadAllText, not Get-Content: PowerShell 5.1 attaches PSPath etc. to Get-Content strings and ConvertTo-Json dumps them.
$text = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'reminder.txt'))
@{ injectSteps = @(@{ ephemeralMessage = $text }) } | ConvertTo-Json -Depth 5 -Compress
