<#
.SYNOPSIS
  Runs one read-only query against the live Supabase project and reports what
  it cost. For the VERIFY blocks at the foot of every migration in this repo.

.DESCRIPTION
  Every migration here ends in a VERIFY block, and running one meant either
  the dashboard SQL editor or a bare `psql`, which is installed but not on
  PATH on this machine -- failure mode 1 in Apply-Migration.ps1's own
  docstring. This is the same connection handling, for queries instead of
  files.

  WHAT IT COSTS, since that question governs every change in this project:

  - LOG INGESTION: **nothing**. The billed log line is written by the API
    gateway, one per HTTP request through PostgREST. psql speaks the Postgres
    wire protocol directly to the session pooler and never touches that path,
    so no amount of querying here moves the Log Ingestion number.

  - THE POSTGRES LOG is a different thing, and is not free. `postgres` -- the
    role psql connects as -- still has `log_min_duration_statement = 200`.
    20261017090000 raised it to 1000, but only on `anon`, `authenticated` and
    `service_role`, because those are the roles live traffic runs as. So a
    query here that takes over 200 ms writes one line. Catalog lookups are
    around a millisecond; a `count(*)` over scan_events may not be. The
    footer prints the slowest statement's server time and says which side of
    200 ms it landed on, so this is visible rather than assumed.

  - EGRESS: the bytes of the result set, and nothing else. A verification
    query returns a handful of rows. The footer prints the size so a careless
    `select * from scan_events` is obvious immediately instead of at the end
    of the month -- that one is ~150,000 rows, and it is the only way this
    script can cost real money.

  READ-ONLY BY DEFAULT. The session sets `default_transaction_read_only`, so
  an UPDATE with a mistyped WHERE fails with "cannot execute UPDATE in a
  read-only transaction" instead of running. Pass -Write to turn that off;
  schema changes belong in a migration applied by Apply-Migration.ps1, which
  records them, not in an ad-hoc query that leaves no trace.

.PARAMETER Sql
  The SQL to run. Mutually exclusive with -File.

.PARAMETER File
  A .sql file to run instead. Mutually exclusive with -Sql.

.PARAMETER ConnectionString
  Defaults to $env:SUPABASE_DB_URL. Prefer the PG* environment variables --
  see _PsqlCommon.ps1 for why a password containing '@' breaks the URI form.

.PARAMETER Write
  Allow writes. Off by default.

.PARAMETER TimeoutMs
  statement_timeout for the session. Default 15000. A verification query that
  needs longer than this is a query worth looking at before it is worth
  waiting for.

.PARAMETER Csv
  Unaligned CSV output, for piping into something else.

.PARAMETER WhatIfOnly
  Print what would run. Connects to nothing.

.EXAMPLE
  # The proof that 20261111120000 landed: a scalar return type cannot be
  # truncated by PostgREST's db-max-rows the way a set can.
  .\Supabase\local\Invoke-Sql.ps1 -Sql "select pg_get_function_result(oid) from pg_proc where proname = 'get_scan_events_page' and pronamespace = 'public'::regnamespace;"

.EXAMPLE
  .\Supabase\local\Invoke-Sql.ps1 -File .\Supabase\local\queries\row-counts.sql -Csv
#>
[CmdletBinding(DefaultParameterSetName = 'Inline')]
param(
  [Parameter(Mandatory = $true, Position = 0, ParameterSetName = 'Inline')] [string] $Sql,
  [Parameter(Mandatory = $true, ParameterSetName = 'FromFile')] [string] $File,
  [string] $ConnectionString = $env:SUPABASE_DB_URL,
  [switch] $Write,
  [int] $TimeoutMs = 15000,
  [switch] $Csv,
  [switch] $WhatIfOnly
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '_PsqlCommon.ps1')

if ($PSCmdlet.ParameterSetName -eq 'FromFile') {
  if (-not (Test-Path $File)) { throw "SQL file not found: $File" }
  $resolved = (Resolve-Path $File).Path
  $what = $resolved
} else {
  $what = $Sql
}

if ($WhatIfOnly) {
  Write-Host "-- would run, read-only=$(-not $Write), statement_timeout=${TimeoutMs}ms --`n"
  if ($PSCmdlet.ParameterSetName -eq 'FromFile') { Get-Content $resolved -Raw | Write-Host } else { Write-Host $Sql }
  return
}

$psql = Get-PsqlOrThrow
$target = Resolve-PsqlTarget $ConnectionString
Test-HostReachable $target.Host
Set-PsqlEncoding

Write-Host "psql   : $psql"
Write-Host "target : $($target.Display)"
Write-Host "mode   : $(if ($Write) { 'READ-WRITE' } else { 'read-only' })"
Write-Host ''

# Session setup, then the query. Multiple -c options run in order in ONE
# session, and a plain SET (not SET LOCAL) persists across them -- which is
# what makes the read-only guard apply to the statement that follows it.
#
# `\timing on` is a backslash command, which -c accepts on its own. It is how
# the footer gets a SERVER-side duration: wall-clock here would include
# process start and the TLS handshake to the pooler, which on a cold run is
# several hundred milliseconds all by itself and would report every query as
# having crossed the 200 ms log threshold.
$readOnly = if ($Write) { 'off' } else { 'on' }
$setup = "set statement_timeout = $TimeoutMs; set default_transaction_read_only = $readOnly;"

$psqlArgs = @($target.Args) + @('--no-psqlrc', '--set', 'ON_ERROR_STOP=1')
if ($Csv) { $psqlArgs += @('--csv') }
$psqlArgs += @('-c', $setup, '-c', '\timing on')
if ($PSCmdlet.ParameterSetName -eq 'FromFile') { $psqlArgs += @('-f', $resolved) } else { $psqlArgs += @('-c', $Sql) }

# NO `2>&1`. In Windows PowerShell 5.1 redirecting a native command's stderr
# wraps each line in an ErrorRecord (NativeCommandError) and sets $? to false
# even on exit code 0, which would make every successful query look like a
# failure. stderr goes straight to the console instead, where psql's own
# messages are more readable anyway.
$raw = & $psql @psqlArgs
$code = $LASTEXITCODE

$lines = @($raw | ForEach-Object { [string]$_ })

# `\timing on` prints "Time: 12.345 ms" after every statement, including the
# two setup ones. Folded into the footer rather than left in the body.
#
# NOT ANCHORED AT THE END, and that is the whole point. Past one second psql
# appends a human-readable form:
#
#   Time: 12.345 ms
#   Time: 1392.202 ms (00:01.392)
#
# The original pattern ended in `ms\s*$`, so it matched the first and not the
# second -- which meant the ONLY timings it ever captured were the fast ones.
# A query that ran for 1.4 seconds had its timing stripped from the body AND
# dropped from the footer, reported as "n/a", and never compared against the
# 200 ms threshold. The one case the warning exists for was the one case it
# could not see. Caught on 2026-11-12 by a verification query that took
# 1,392 ms and claimed to have no timing at all.
$timings = @()
$body = foreach ($line in $lines) {
  if ($line -match '^\s*Time:\s*([\d.]+)\s*ms') { $timings += [double]$Matches[1] } else { $line }
}

$text = ($body | Out-String).TrimEnd()
if ($text) { Write-Host $text }

if ($code -ne 0) {
  Write-Host ''
  throw "psql exited $code. Nothing above is a result set."
}

# UTF-8 bytes of psql's FORMATTED output: column borders and padding included,
# so this over-reports the wire size rather than under-reporting it. The point
# is the order of magnitude -- 400 B versus 12 MB -- not the exact figure.
$bytes = [System.Text.Encoding]::UTF8.GetByteCount($text)
$size = if ($bytes -lt 1000) { "$bytes B" } elseif ($bytes -lt 1000000) { "{0:N1} kB" -f ($bytes / 1000) } else { "{0:N1} MB" -f ($bytes / 1000000) }

# The setup statement is one of the timings and is always trivial; the slowest
# is the one that matters for the 200 ms threshold.
$slowest = if ($timings.Count) { ($timings | Measure-Object -Maximum).Maximum } else { $null }
$slowText = if ($null -ne $slowest) { "{0:N1} ms" -f $slowest } else { 'n/a' }

$rows = 0
foreach ($line in $body) { if ($line -match '^\((\d+) rows?\)$') { $rows += [int]$Matches[1] } }

Write-Host ''
Write-Host "rows: $rows  |  output: $size  |  slowest statement: $slowText" -ForegroundColor DarkGray
Write-Host 'log ingestion: 0 events (psql does not go through PostgREST)' -ForegroundColor DarkGray

# 200, not 1000: 20261017090000 raised log_min_duration_statement to 1000 ms
# on anon/authenticated/service_role only. The postgres role -- the one this
# connects as -- was left at 200.
if ($null -ne $slowest -and $slowest -gt 200) {
  Write-Warning ("Slowest statement was {0:N1} ms, over the 200 ms log_min_duration_statement set on the postgres role. That wrote a line to the Postgres log." -f $slowest)
}
if ($bytes -gt 1000000) {
  Write-Warning "That query returned $size of egress. Verification queries should be kilobytes; add a LIMIT or an aggregate."
}
