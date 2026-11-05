<#
.SYNOPSIS
  Applies one migration file to the live Supabase project, in a single
  transaction, and records it in supabase_migrations.schema_migrations.

.DESCRIPTION
  Migrations here are applied by hand (see Supabase/README.md). That has gone
  wrong in four distinct ways before, and this script exists to close all
  four:

    1. psql is installed but not on PATH, so `psql ...` fails outright.
    2. PowerShell is not bash: `psql "$DATABASE_URL"` passes an EMPTY string,
       because $DATABASE_URL is an undefined PowerShell variable rather than an
       environment variable. The env-var spelling is $env:NAME.
    3. A migration gets applied but its schema_migrations row does not, so the
       repo and the project disagree about what has run. 20261008120000 is
       already in that state.
    4. A password containing '@' breaks the URI before a socket is opened: the
       first '@' ends the userinfo section, so libpq treats the rest of the
       password plus the real host as one hostname. It fails with "could not
       translate host name", which reads like DNS and is not -- and it prints
       part of the password to the terminal on the way out. Prefer the PG*
       environment variables, which need no encoding at all.

  Everything runs inside one transaction with ON_ERROR_STOP, so a migration
  that fails halfway leaves the database exactly as it was. That matters most
  for the ones that rewrite existing data.

.PARAMETER File
  Path to the .sql file, e.g. Supabase/migrations/20261024090000_order_scan_log_directions.sql

.PARAMETER ConnectionString
  Supabase DIRECT connection string (port 5432, NOT the 6543 pooler):
    postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
  Project Settings > Database > Connection string > URI.

  Every one of @ : / ? # % in the password must be percent-encoded here ('@'
  becomes '%40'). If the password contains any of them, prefer the PG*
  environment variables below instead -- they take the password literally.

  Prefer an environment variable over this parameter either way, so the
  password never lands in your PowerShell history. Same convention as
  Migrate-Local.ps1.

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
  # Preferred: no percent-encoding, whatever the password contains.
  $env:PGHOST     = 'db.xxxx.supabase.co'
  $env:PGPORT     = '5432'
  $env:PGUSER     = 'postgres'
  $env:PGDATABASE = 'postgres'
  $env:PGPASSWORD = '<paste the password exactly>'
  .\Supabase\local\Apply-Migration.ps1 -File .\Supabase\migrations\20261104090000_punctuality.sql

.EXAMPLE
  # URI form. Only safe when the password contains none of @ : / ? # %
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

# FOURTH WAY THIS HAS GONE WRONG (2026-11-04). A Supabase database password
# containing '@' breaks the URI before psql ever opens a socket: the FIRST '@'
# ends the userinfo section, so libpq reads the rest of the password plus the
# real host as one hostname and fails with
#   could not translate host name "<tail-of-password>@db.<ref>.supabase.co"
# which reads like DNS or a VPN problem and is neither. Worse, it prints part
# of the password into the terminal, and from there into whatever the operator
# pastes for help.
#
# So there are two supported shapes, and the env-var one is now preferred:
#
#   1. $env:PGHOST + $env:PGPASSWORD (+ PGUSER/PGDATABASE/PGPORT) -- libpq's
#      own variables. The password is passed as a literal and needs NO
#      percent-encoding, whatever is in it. Nothing is interpolated into a URL.
#   2. $env:SUPABASE_DB_URL / -ConnectionString -- a URI, which requires every
#      one of @ : / ? # % in the password to be percent-encoded.
$useEnvVars = [string]::IsNullOrWhiteSpace($ConnectionString) -and
              -not [string]::IsNullOrWhiteSpace($env:PGHOST)

if ($useEnvVars) {
  if ([string]::IsNullOrWhiteSpace($env:PGPASSWORD)) {
    throw '$env:PGHOST is set but $env:PGPASSWORD is empty, so psql would prompt and hang.'
  }
  Write-Host "target    : $env:PGHOST (from PG* environment variables)"
} elseif ([string]::IsNullOrWhiteSpace($ConnectionString)) {
  throw @'
No connection target. Use EITHER of these (note the $env: prefix -- plain
$NAME is a PowerShell variable, not an environment variable, and expands to
empty, which silently connects to localhost).

PREFERRED -- no encoding needed, whatever characters the password contains:

  $env:PGHOST     = 'db.<ref>.supabase.co'
  $env:PGPORT     = '5432'
  $env:PGUSER     = 'postgres'
  $env:PGDATABASE = 'postgres'
  $env:PGPASSWORD = '<password>'      # literal, paste it exactly

OR a URI, if the password contains none of @ : / ? # % (if it does, each one
must be percent-encoded -- '@' becomes '%40'):

  $env:SUPABASE_DB_URL = 'postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres'

Use the DIRECT connection on port 5432, not the 6543 pooler.
'@
} else {
  # Caught here rather than by DNS, so the message names the real cause and
  # does not echo the password. A well-formed URI has exactly one '@': the one
  # separating userinfo from host.
  $atCount = ([regex]::Matches($ConnectionString, '@')).Count
  if ($atCount -gt 1) {
    throw @'
The connection string has more than one '@', so libpq will read part of the
password as the hostname and fail with "could not translate host name".

The password almost certainly contains an '@'. Either percent-encode it ('@'
becomes '%40', and likewise %3A : / %2F ? %3F # %23 % %25), or avoid the URI
entirely -- which is the better option:

  $env:SUPABASE_DB_URL = ''           # clear the broken one first
  $env:PGHOST     = 'db.<ref>.supabase.co'
  $env:PGPORT     = '5432'
  $env:PGUSER     = 'postgres'
  $env:PGDATABASE = 'postgres'
  $env:PGPASSWORD = '<password>'

If a password fragment has already been printed to a terminal or pasted
anywhere, treat it as exposed and reset it: Project Settings > Database >
Reset database password.
'@
  }
}

# Empty array = no connection argument, so libpq falls back to the PG* vars.
$target = if ($useEnvVars) { @() } else { @($ConnectionString) }

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
  & $psql @target `
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
& $psql @target --set ON_ERROR_STOP=1 --quiet --no-psqlrc -c $insert
if ($LASTEXITCODE -eq 0) {
  Write-Host "Recorded in schema_migrations as $version." -ForegroundColor Green
} elseif ($RecordOnly) {
  Write-Warning "Could not write the schema_migrations row. Nothing else was attempted:`n$insert"
} else {
  Write-Warning "The migration APPLIED, but the schema_migrations row could not be written. Add it by hand:`n$insert"
}
