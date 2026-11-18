# Installs this config into ~/.claude and installs the plugins.
# ASCII only on purpose: Windows PowerShell 5.1 misreads UTF-8 scripts without a BOM.
# Usage:  .\setup.ps1            (install)
#         .\setup.ps1 -Target C:\tmp\x -SkipPlugins   (dry test)
param(
    [string]$Target = "$env:USERPROFILE\.claude",
    [switch]$SkipPlugins
)
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot

New-Item -ItemType Directory -Force $Target | Out-Null

# Never overwrite this computer's CLAUDE.md. The shared rules go to CLAUDE.shared.md
# and the local CLAUDE.md imports them with one "@" line, so local rules stay.
$main = Join-Path $Target 'CLAUDE.md'
$import = '@CLAUDE.shared.md'
# The source computer's CLAUDE.md IS the shared rules. Importing a copy there loads every rule twice.
# shortcut: detects the source copy by its first line only. Use a marker file if a local CLAUDE.md ever starts with the same title.
$isSource = (Test-Path $main) -and ((Get-Content $main -TotalCount 1) -eq (Get-Content (Join-Path $src 'CLAUDE.md') -TotalCount 1))
if ($isSource) {
    Write-Host "$main is the source copy. Skipped CLAUDE.shared.md and the import line."
} else {
    Copy-Item (Join-Path $src 'CLAUDE.md') (Join-Path $Target 'CLAUDE.shared.md') -Force
    if (-not (Test-Path $main) -or -not (Select-String -Path $main -SimpleMatch $import -Quiet)) {
        Add-Content $main "`r`n$import" -Encoding utf8
        Write-Host "Added import line to $main"
    }
}

# The source computer edits ~/.claude directly (README 4-1). Copying here would overwrite edits not yet pushed, with no backup.
if ($isSource) {
    Write-Warning "Source computer: skipped copying docs, agents, skills, hooks. Copy them into this repo before you push."
} else {
    foreach ($d in 'agents', 'skills', 'hooks') {
        Copy-Item (Join-Path $src $d) $Target -Recurse -Force
    }
    # docs also holds the GitHub Pages site. Only the .md rule files belong in ~/.claude.
    New-Item -ItemType Directory -Force (Join-Path $Target 'docs') | Out-Null
    Copy-Item (Join-Path $src 'docs\*.md') (Join-Path $Target 'docs') -Force
}
# decision-rack moved into the session-board plugin (plugins/session-board). Copy does not delete, so remove the old copy.
$old = Join-Path $Target 'skills\decision-rack'
if (Test-Path $old) { Remove-Item $old -Recurse -Force; Write-Host "Removed old $old" }

# Register the reminder hook in settings.json. Other hooks and settings stay.
$sp = Join-Path $Target 'settings.json'
$s = if (Test-Path $sp) { Get-Content $sp -Raw -Encoding UTF8 | ConvertFrom-Json } else { New-Object psobject }
if (-not $s) { $s = New-Object psobject }   # an empty settings.json gives $null
$changed = $false
# Response language. An existing value (any language) is kept.
if (-not $s.language) {
    $s | Add-Member -NotePropertyName language -NotePropertyValue 'korean'
    $changed = $true
}
# Ask before risky delete/git commands. The app's own approval prompt replaced the guard card (2026-11-19 decision).
$ask = @('Bash(rm -rf:*)', 'Bash(rm -r:*)', 'Bash(rm -fr:*)', 'Bash(git reset --hard:*)', 'Bash(git clean:*)', 'Bash(git push --force:*)', 'Bash(git push -f:*)')
if (-not $s.permissions) { $s | Add-Member -NotePropertyName permissions -NotePropertyValue (New-Object psobject) }
$have = @($s.permissions.ask | Where-Object { $_ })
$missing = @($ask | Where-Object { $have -notcontains $_ })
if ($missing.Count -gt 0) {
    $s.permissions | Add-Member -NotePropertyName ask -NotePropertyValue (@($have) + @($missing)) -Force
    $changed = $true
}
if ((ConvertTo-Json $s -Depth 30) -notmatch 'reminder\.txt') {
    $changed = $true
    $cmd = "powershell -NoProfile -Command `"Get-Content -Raw '" + ($Target -replace '\\', '/') + "/hooks/reminder.txt'`""
    $entry = @{ hooks = @(@{ type = 'command'; command = $cmd; timeout = 10 }) }
    if (-not $s.hooks) { $s | Add-Member -NotePropertyName hooks -NotePropertyValue (New-Object psobject) }
    $list = @($s.hooks.UserPromptSubmit | Where-Object { $_ }) + $entry
    $s.hooks | Add-Member -NotePropertyName UserPromptSubmit -NotePropertyValue $list -Force
}
if ($changed) {
    if (Test-Path $sp) { Copy-Item $sp "$sp.bak-setup" -Force }
    # WriteAllText: no BOM. Set-Content -Encoding utf8 would add one in PowerShell 5.1.
    [IO.File]::WriteAllText($sp, (ConvertTo-Json $s -Depth 30))
    Write-Host "Updated $sp (reminder hook, language, ask rules)"
}
Write-Host "Copied: CLAUDE.shared.md, docs, agents, skills, hooks -> $Target"

# Point Claude Code at this repo's own plugins (session-board, relay-skills, relay-agents, ...).
# Runs even with -SkipPlugins: it installs nothing, and an update that moves the folder must move the variable too.
# shortcut: the variable holds one path. If it holds something else, warn and keep it. Support a path list if a second source is needed.
# A test run into another -Target must not touch the real user variable.
$realTarget = $Target.TrimEnd('\') -eq "$env:USERPROFILE\.claude"
$normPath = { param($p) [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($p)).TrimEnd('\') }
$mods = & $normPath (Join-Path $src 'plugins')
# The plugins lived in mods\my-own-mods\plugins until 2026-11-18. git pull leaves its ignored files behind,
# and a variable still pointing there would load that shell, so remove the folder.
$oldDir = Join-Path $src 'mods\my-own-mods'
if (Test-Path $oldDir) {
    # Only the ignored leftovers (.gitignore: .claude-plugin/types/, tsconfig.json, *.log) may go. Anything else is the user's work.
    $own = Get-ChildItem $oldDir -Recurse -File -Force | Where-Object { $_.FullName -notmatch '\\\.claude-plugin\\types\\' -and $_.Name -ne 'tsconfig.json' -and $_.Extension -ne '.log' }
    if ($own) { Write-Warning "$oldDir still holds $(@($own).Count) file(s) of your own. Move them into plugins\, then delete the folder." }
    else { Remove-Item $oldDir -Recurse -Force; Write-Host "Removed old $oldDir" }
}
if ((Test-Path (Join-Path $src 'mods')) -and -not (Get-ChildItem (Join-Path $src 'mods') -Force)) { Remove-Item (Join-Path $src 'mods') }
$old = [Environment]::GetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS', 'User')
$oldNorm = if ($old) { & $normPath $old } else { '' }
if (-not $realTarget) {
    Write-Host "Test target: skipped CLAUDE_CODE_PLUGIN_DIRS (would be $mods)"
} elseif ($oldNorm -eq $mods) {
    # already right
} elseif (-not $old -or $oldNorm -like '*\my-own-mods\plugins') {
    [Environment]::SetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS', $mods, 'User')
    Write-Host "Set CLAUDE_CODE_PLUGIN_DIRS -> $mods"
} else {
    Write-Warning "CLAUDE_CODE_PLUGIN_DIRS already holds '$old'. Left unchanged. Set it to '$mods' by hand."
}

if (-not $SkipPlugins) {
    if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
        Write-Warning 'claude CLI not found. Install Claude Code, then run this script again.'
        exit 1
    }
    $ErrorActionPreference = 'Continue'   # "already installed" must not stop the script
    claude plugin marketplace add DietrichGebert/ponytail
    claude plugin install ponytail@ponytail
    claude plugin install frontend-design@claude-plugins-official
    claude plugin marketplace add google/elephant-goldfish-model
    claude plugin install egm@egm
    claude plugin marketplace add openai/codex-plugin-cc
    claude plugin install codex@openai-codex   # needs the codex CLI and 'codex login' (done by the user)
}
Write-Host 'Done. Restart Claude Code.'
