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
Copy-Item (Join-Path $src 'CLAUDE.md') (Join-Path $Target 'CLAUDE.shared.md') -Force
$main = Join-Path $Target 'CLAUDE.md'
$import = '@CLAUDE.shared.md'
if (-not (Test-Path $main) -or -not (Select-String -Path $main -SimpleMatch $import -Quiet)) {
    Add-Content $main "`r`n$import" -Encoding utf8
    Write-Host "Added import line to $main"
}

foreach ($d in 'docs', 'agents', 'skills') {
    Copy-Item (Join-Path $src $d) $Target -Recurse -Force
}
Write-Host "Copied: CLAUDE.shared.md, docs, agents, skills -> $Target"

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
}
Write-Host 'Done. Restart Claude Code.'
