[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$SourcePath,
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-ChildPath {
  param([string]$Parent, [string]$Candidate)
  $separator = [System.IO.Path]::DirectorySeparatorChar
  $normalizedParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + $separator
  $normalizedCandidate = [System.IO.Path]::GetFullPath($Candidate)
  return $normalizedCandidate.StartsWith($normalizedParent, [System.StringComparison]::OrdinalIgnoreCase)
}

$source = (Resolve-Path -LiteralPath $SourcePath).Path
if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md') -PathType Leaf)) {
  throw "SourcePath must be the codex-portrait-interface skill directory containing SKILL.md."
}

$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$skillsRoot = [System.IO.Path]::GetFullPath((Join-Path $codexHome 'skills'))
New-Item -ItemType Directory -Force -Path $skillsRoot | Out-Null
$destination = [System.IO.Path]::GetFullPath((Join-Path $skillsRoot 'codex-portrait-interface'))
if (-not (Test-ChildPath -Parent $skillsRoot -Candidate $destination)) {
  throw "Refusing an unsafe destination outside the Codex skills directory."
}

if (Test-Path -LiteralPath $destination) {
  if (-not $Force) {
    throw "Skill already exists at $destination. Re-run with -Force to move it to a timestamped backup."
  }
  $backup = "$destination.backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
  if (-not (Test-ChildPath -Parent $skillsRoot -Candidate $backup)) {
    throw "Refusing an unsafe backup destination."
  }
  Move-Item -LiteralPath $destination -Destination $backup
}

New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($file in @('SKILL.md', 'package.json', 'package-lock.json', 'requirements.txt')) {
  $from = Join-Path $source $file
  if (Test-Path -LiteralPath $from -PathType Leaf) {
    Copy-Item -LiteralPath $from -Destination (Join-Path $destination $file)
  }
}

foreach ($directory in @('agents', 'assets', 'references', 'scripts')) {
  $from = Join-Path $source $directory
  if (-not (Test-Path -LiteralPath $from -PathType Container)) { continue }
  Get-ChildItem -LiteralPath $from -Recurse -File | Where-Object {
    $_.FullName -notmatch '\\(?:node_modules|__pycache__)\\' -and $_.Extension -notin @('.pyc', '.pyo')
  } | ForEach-Object {
    $relative = $_.FullName.Substring($from.Length).TrimStart('\', '/')
    $target = Join-Path (Join-Path $destination $directory) $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $target
  }
}

Write-Host "Installed skill at $destination"
Write-Host "Next: cd `"$destination`"; npm ci; py -3 -m pip install -r requirements.txt; restart Codex."
