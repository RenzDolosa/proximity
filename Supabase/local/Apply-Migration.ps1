<#
.SYNOPSIS
  Applies one migration file to the live Supabase project, in a single
  transaction, and records it in supabase_migrations.schema_migrations.

.DESCRIPTION
  Migrations here are applied by hand (see Supabase/README.md). That has gone
  wrong in five distinct ways before, and this script exists to close all
  five:

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
    5. db.<ref>.supabase.co is IPv6-ONLY. Supabase removed dedicated IPv4
       from direct connections, so that name has an AAAA record and no A
       record; on a network without IPv6 psql fails with "could not translate
       host name ... Name or service not known", which reads as a mistyped
       hostname or a deleted project and is neither. The session-mode pooler
       (port 5432 on aws-N-<region>.pooler.supabase.com, user
       postgres.<ref>) has IPv4 and is the fix. Checked before connecting,
       because the answer is not guessable from the error.

  Everything runs inside one transaction with ON_ERROR_STOP, so a migration
  that fails halfway leaves the database exactly as it was. That matters most
  for the ones that rewrite existing data.

.PARAMETER File
  Path to the .sql file, e.g. Supabase/migrations/20261024090000_order_scan_log_directions.sql

.PARAMETER ConnectionString
  A connection string that can run DDL in one transaction. Two work; one does
  not:

    SESSION-MODE POOLER (port 5432) -- has IPv4, and is the only option on a
    network without IPv6. Note the user is postgres.<ref>, not postgres:
      postgresql://postgres.<ref>:<password>@aws-N-<region>.pooler.supabase.com:5432/postgres
      Project Settings > Database > Connection string > Session pooler.

    DIRECT (port 5432) -- db.<ref>.supabase.co is IPv6-ONLY, so this only
    works from a network with IPv6:
      postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres

    TRANSACTION-MODE POOLER (port 6543) -- NOT for migrations. It hands back
    a different backend per transaction, so --single-transaction and
    session-level state are not safe. 5432 on the same pooler host is session
    mode and is fine.

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

# The five guards below used to live in this file. They are shared with
# Invoke-Sql.ps1 now, because a second copy of a bug fix is how the bug comes
# back -- test/psql-tooling.test.mjs fails if either script redefines them.
. (Join-Path $PSScriptRoot '_PsqlCommon.ps1')

if (-not (Test-Path $File)) { throw "Migration file not found: $File" }
$resolved = (Resolve-Path $File).Path
$name = [System.IO.Path]::GetFileNameWithoutExtension($resolved)

# Supabase keys migrations on the leading timestamp; the rest is the label.
if ($name -notmatch '^(?<version>\d{14})_(?<label>.+)$') {
  throw "Filename must be <14-digit-timestamp>_<name>.sql, got: $name"
}
$version = $Matches['version']
$label = $Matches['label']

$psql = Get-PsqlOrThrow

Write-Host "psql      : $psql"
Write-Host "migration : $name"
Write-Host "version   : $version"

if ($WhatIfOnly) {
  Write-Host "`n-- would apply, in one transaction --`n"
  Get-Content $resolved -Raw | Write-Host
  return
}

# Guards 2 through 5 in the docstring above are implemented in
# _PsqlCommon.ps1, dot-sourced near the top: choosing between the PG*
# variables and a URI, catching a password that contains '@' before libpq
# reads half of it as a hostname, and refusing an IPv6-only host on a network
# without IPv6. Resolve-PsqlTarget returns an EMPTY argument array for the
# PG* path, so nothing is interpolated and no password is ever printed.
$target = Resolve-PsqlTarget $ConnectionString
Write-Host "target    : $($target.Display)"
Test-HostReachable $target.Host
$conn = $target.Args

# Guard 5: UTF-8, or a multi-byte character in a SQL comment aborts the whole
# transaction with "invalid byte sequence for encoding".
Set-PsqlEncoding

if ($RecordOnly) {
  Write-Host 'Recording only - the SQL is NOT run.' -ForegroundColor Yellow
} else {
  # --single-transaction + ON_ERROR_STOP: all of it lands, or none of it does.
  & $psql @conn `
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
& $psql @conn --set ON_ERROR_STOP=1 --quiet --no-psqlrc -c $insert
if ($LASTEXITCODE -eq 0) {
  Write-Host "Recorded in schema_migrations as $version." -ForegroundColor Green
} elseif ($RecordOnly) {
  Write-Warning "Could not write the schema_migrations row. Nothing else was attempted:`n$insert"
} else {
  Write-Warning "The migration APPLIED, but the schema_migrations row could not be written. Add it by hand:`n$insert"
}
