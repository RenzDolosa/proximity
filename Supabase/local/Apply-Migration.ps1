<#
.SYNOPSIS
  Applies one migration file to the live Supabase project, in a single
  transaction, and records it in supabase_migrations.schema_migrations.

.DESCRIPTION
  Migrations here are applied by hand (see Supabase/README.md). That has gone
  wrong in three distinct ways before, and this script exists to close all
  three:

    1. psql is installed but not on PATH, so `psql ...` fails outright.
    2. PowerShell is not bash: `psql "$DATABASE_URL"` passes an EMPTY string,
       because $DATABASE_URL is an undefined PowerShell variable rather than an
       environment variable. The env-var spelling is $env:NAME.
    3. A migration gets applied but its schema_migrations row does not, so the
       repo and the project disagree about what has run. 20261008120000 is
       already in that state.

  Everything runs inside one transaction with ON_ERROR_STOP, so a migration
  that fails halfway leaves the database exactly as it was. That matters most
  for the ones that rewrite existing data.

.PARAMETER File
  Path to the .sql file, e.g. Supabase/migrations/20261024090000_order_scan_log_directions.sql

.PARAMETER ConnectionString
  Supabase DIRECT connection string (port 5432, NOT the 6543 pooler):
    postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
  Project Settings > Database > Connection string > URI.

  Prefer setting $env:SUPABASE_DB_URL and omitting this, so the password never
  lands in your PowerShell history. Same convention as Migrate-Local.ps1.

.PARAMETER SkipTracking
  Apply the SQL but do not write the schema_migrations row.

.PARAMETER RecordOnly
  Write the schema_migrations row WITHOUT running the SQL. For a migration
  already applied through the dashboard's SQL editor, which records nothing in
  that table -- the gap that made five live migrations read as "MISSING" on
  2026-10-24. Verify the migration really is applied first (see "How to tell
  what is actually applied" in Supabase/README.md); this writes bookkeeping and
  checks nothing.

.PARAMETER WhatIfOnly
  Print what would run, connect to nothing.

.EXAMPLE
  $env:SUPABASE_DB_URL = 'postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres'
  .\Supabase\local\Apply-Migration.ps1 -File .\Supabase\migrations\20261024090000_order_scan_log_directions.sql
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $File,
  [string] $ConnectionString = $env:SUPABASE_DB_URL,
  [switch] $SkipTracking,
  [switch] $RecordOnly,
  [switch] $WhatIfOnly
)

$ErrorActionPreference = 'Stop'

function Find-Psql {
  $onPath = Get-Command psql -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  # Newest major version first, so a 17 client is preferred over an older one.
  # A client older than the server refuses to connect cleanly.
  $roots = @("$env:ProgramFiles\PostgreSQL", "${env:ProgramFiles(x86)}\PostgreSQL", "$env:LOCALAPPDATA\Programs\PostgreSQL")
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    $dirs = Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
      Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending
    foreach ($d in $dirs) {
      $candidate = Join-Path $d.FullName 'bin\psql.exe'
      if (Test-Path $candidate) { return $candidate }
    }
  }
  return $null
}

if (-not (Test-Path $File)) { throw "Migration file not found: $File" }
$resolved = (Resolve-Path $File).Path
$name = [System.IO.Path]::GetFileNameWithoutExtension($resolved)

# Supabase keys migrations on the leading timestamp; the rest is the label.
if ($name -notmatch '^(?<version>\d{14})_(?<label>.+)$') {
  throw "Filename must be <14-digit-timestamp>_<name>.sql, got: $name"
}
$version = $Matches['version']
$label = $Matches['label']

$psql = Find-Psql
if (-not $psql) {
  throw "psql not found. Install the PostgreSQL 17 client tools (winget install -e --id PostgreSQL.PostgreSQL.17), or add its bin\ directory to PATH."
}

Write-Host "psql      : $psql"
Write-Host "migration : $name"
Write-Host "version   : $version"

if ($WhatIfOnly) {
  Write-Host "`n-- would apply, in one transaction --`n"
  Get-Content $resolved -Raw | Write-Host
  return
}

if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
  throw @'
No connection string. Set it first (note the $env: prefix -- plain $NAME is a
PowerShell variable, not an environment variable, and expands to empty):

  $env:SUPABASE_DB_URL = 'postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres'

Use the DIRECT connection on port 5432, not the 6543 pooler.
'@
}

# The migration files are UTF-8 (em-dashes and arrows in comments, in nearly
# all of them). psql otherwise takes client_encoding from the Windows console
# locale, which is usually WIN1252 here, and a multi-byte character in a
# comment is then enough to abort the whole transaction with "invalid byte
# sequence for encoding". Setting it explicitly is why this works from
# PowerShell at all.
$env:PGCLIENTENCODING = 'UTF8'

if ($RecordOnly) {
  Write-Host 'Recording only - the SQL is NOT run.' -ForegroundColor Yellow
} else {
  # --single-transaction + ON_ERROR_STOP: all of it lands, or none of it does.
  & $psql $ConnectionString `
    --single-transaction `
    --set ON_ERROR_STOP=1 `
    --quiet `
    --no-psqlrc `
    -f $resolved
  if ($LASTEXITCODE -ne 0) {
    throw "psql exited $LASTEXITCODE - nothing was committed."
  }
  Write-Host "`nApplied." -ForegroundColor Green
}

if ($SkipTracking) { Write-Host 'Tracking row skipped (-SkipTracking).'; return }

# Recorded separately and non-fatally: failing to write the bookkeeping row is
# not a reason to imply the migration itself failed. It already ran.
$insert = @"
insert into supabase_migrations.schema_migrations (version, name)
values ('$version', '$label')
on conflict (version) do nothing;
"@
& $psql $ConnectionString --set ON_ERROR_STOP=1 --quiet --no-psqlrc -c $insert
if ($LASTEXITCODE -eq 0) {
  Write-Host "Recorded in schema_migrations as $version." -ForegroundColor Green
} elseif ($RecordOnly) {
  Write-Warning "Could not write the schema_migrations row. Nothing else was attempted:`n$insert"
} else {
  Write-Warning "The migration APPLIED, but the schema_migrations row could not be written. Add it by hand:`n$insert"
}
