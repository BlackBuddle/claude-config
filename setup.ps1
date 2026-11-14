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

# Keep the old CLAUDE.md: it may hold rules written on this computer.
$old = Join-Path $Target 'CLAUDE.md'
if (Test-Path $old) {
    $bak = "$old.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Copy-Item $old $bak
    Write-Host "Backup: $bak"
}

Copy-Item (Join-Path $src 'CLAUDE.md') $Target -Force
foreach ($d in 'docs', 'agents', 'skills') {
    Copy-Item (Join-Path $src $d) $Target -Recurse -Force
}
Write-Host "Copied: CLAUDE.md, docs, agents, skills -> $Target"

if (-not $SkipPlugins) {
    if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
        Write-Warning 'claude CLI not found. Install Claude Code, then run this script again.'
        exit 1
    }
    $ErrorActionPreference = 'Continue'   # "already installed" must not stop the script
    claude plugin marketplace add DietrichGebert/ponytail
    claude plugin install ponytail@ponytail
    claude plugin install frontend-design@claude-plugins-official
}
Write-Host 'Done. Restart Claude Code.'
