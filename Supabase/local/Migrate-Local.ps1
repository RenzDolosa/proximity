<#
.SYNOPSIS
  Copies the live Supabase database into a local PostgreSQL 17 instance.

.DESCRIPTION
  The Windows/PowerShell counterpart to export-project.sh + a restore. Runs in
  four stages so a failure tells you which half broke:

    1. preflight  - tool versions, local server reachable, target name free
    2. export     - pg_dump from Supabase (read-only; nothing is modified there)
    3. bootstrap  - create the Supabase roles a dump cannot carry
    4. restore    - pg_restore into the local database, then verify row counts

  Stage 2 is read-only against Supabase: pg_dump issues no DDL or DML.

.PARAMETER SourceUrl
  Supabase DIRECT connection string (port 5432, NOT the 6543 pooler):
    postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
  Get it from Project Settings > Database > Connection string > URI.

  Prefer setting $env:SUPABASE_DB_URL and omitting this parameter, so the
  password does not land in your PowerShell history.

.PARAMETER TargetDb
  Local database name to create. Default: proximity_local

.PARAMETER LocalUser
  Local superuser. Default: postgres

.PARAMETER OutDir
  Where the export is written. Default: .\supabase-export-<timestamp>

.EXAMPLE
  $env:SUPABASE_DB_URL = 'postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres'
  .\Supabase\local\Migrate-Local.ps1

.NOTES
  Requires PostgreSQL 17+ client tools AND a local server:
    winget install -e --id PostgreSQL.PostgreSQL.17
  A client older than the server refuses to dump ("server version mismatch"),
  which is the most common failure here.
#>
[CmdletBinding()]
param(
  [string] $SourceUrl = $env:SUPABASE_DB_URL,
  [string] $TargetDb  = 'proximity_local',
  [string] $LocalUser = 'postgres',
  [string] $OutDir    = ".\supabase-export-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn($msg)     { Write-Host "    !   $msg" -ForegroundColor Yellow }
function Die($msg)      { Write-Host "`nFAILED: $msg" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- preflight --
Step 1 'Preflight'

# The Windows PostgreSQL installer does NOT add its bin directory to PATH, so
# a perfectly good install still looks absent to Get-Command — which is the
# first thing that actually happened here. Locate it ourselves and prepend for
# the lifetime of this process only: no system or user PATH is modified, so
# there is nothing to undo afterwards.
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  $pgBin = @("$env:ProgramFiles\PostgreSQL", "${env:ProgramFiles(x86)}\PostgreSQL") |
    Where-Object { Test-Path $_ } |
    ForEach-Object { Get-ChildItem $_ -Directory -ErrorAction SilentlyContinue } |
    Where-Object { ($_.Name -as [int]) -ne $null -and [int]$_.Name -ge 17 } |
    Sort-Object { [int]$_.Name } -Descending |
    ForEach-Object { Join-Path $_.FullName 'bin' } |
    Where-Object { Test-Path (Join-Path $_ 'pg_dump.exe') } |
    Select-Object -First 1

  if ($pgBin) {
    $env:Path = "$pgBin;$env:Path"
    Ok "located PostgreSQL tools at $pgBin (PATH set for this run only)"
  }
}

foreach ($t in 'pg_dump','pg_restore','psql','createdb') {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
    Die "$t not found.`n       If PostgreSQL 17 is not installed:  winget install -e --id PostgreSQL.PostgreSQL.17`n       If it IS installed, its bin directory is somewhere this script did not look -`n       add it to PATH for this session:  `$env:Path += ';C:\Program Files\PostgreSQL\17\bin'"
  }
}

# Major version must be >= the Supabase server (17). Parsing the major number
# only: "pg_dump (PostgreSQL) 17.2" -> 17.
$dumpVersionText = (& pg_dump --version) -join ' '
if ($dumpVersionText -notmatch '(\d+)\.') { Die "could not parse pg_dump version from '$dumpVersionText'" }
$major = [int]$Matches[1]
if ($major -lt 17) {
  Die "pg_dump is version $major; Supabase runs PostgreSQL 17 and a client older than the server refuses to dump. Install PostgreSQL 17 client tools."
}
Ok "client tools v$major"

# Interactive fallback. $env: variables are per-window, so the most common
# failure here is setting one in one terminal and running the script in
# another — prompting is strictly better than failing on that. -AsSecureString
# keeps the password off the screen and out of PowerShell history, and
# EscapeDataString handles passwords containing @ : / # ? ,  which would
# otherwise terminate the URI's userinfo early and surface as a baffling
# "could not translate host name" instead of an auth error.
if (-not $SourceUrl -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
  Warn 'No $env:SUPABASE_DB_URL in this window.'
  $ref = Read-Host '    Supabase project ref (e.g. kjwttqmbcjvkivgmwuev), or blank to abort'
  if ($ref) {
    $sec = Read-Host "    Database password for $ref" -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
               [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    if ($plain) {
      $SourceUrl = "postgresql://postgres:$([uri]::EscapeDataString($plain))@db.$ref.supabase.co:5432/postgres"
      Ok 'connection string built from prompt (not stored, not echoed)'
    }
    Remove-Variable plain, sec -ErrorAction SilentlyContinue
  }
}

if (-not $SourceUrl) {
  Die "No source connection string. Set `$env:SUPABASE_DB_URL in THIS window, or pass -SourceUrl.`n       Project Settings > Database > Connection string > URI (port 5432, not 6543)."
}
if ($SourceUrl -match ':6543/') {
  Die "That is the transaction pooler (port 6543). pg_dump needs the DIRECT connection on port 5432."
}
if ($SourceUrl -match '://postgres:PASS@') {
  Die "The connection string still contains the literal placeholder 'PASS'. Substitute your real database password."
}
Ok 'source connection string looks well-formed'

# Local server reachable?
$env:PGCLIENTENCODING = 'UTF8'
# Windows PowerShell 5.1 wraps a native executable's stderr in ErrorRecords
# whenever a stream is redirected, and with $ErrorActionPreference = 'Stop'
# that turns an ordinary psql exit-1 into a raw NativeCommandError that
# terminates the script BEFORE the diagnostic below can run — so the operator
# sees a stack trace instead of being told what to do. Relax the preference
# around native calls and judge them solely by $LASTEXITCODE, which is the
# only trustworthy signal for a native process anyway.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$probe = & psql -U $LocalUser -d postgres -c 'select 1' 2>&1
$probeCode = $LASTEXITCODE
$ErrorActionPreference = $prevEap

if ($probeCode -ne 0) {
  $hint = if ("$probe" -match 'password authentication failed') {
@"
The local 'postgres' password is wrong or not set. In THIS window:
           `$env:PGPASSWORD = '<the superuser password you chose in the PostgreSQL installer>'
       That is the LOCAL password, not the Supabase one. Supabase reads its own
       from the connection string, so the two do not collide.
"@
  } elseif ("$probe" -match 'could not connect|refused|No such host') {
@"
The server is not reachable. Check the service:
           Get-Service postgresql*
"@
  } else { "psql said: $probe" }
  Die "cannot connect to the local PostgreSQL server as '$LocalUser'.`n       $hint"
}
Ok "local server reachable as '$LocalUser'"

$exists = (& psql -U $LocalUser -d postgres -At -c "select 1 from pg_database where datname = '$TargetDb'")
if ($exists -eq '1') {
  Die "database '$TargetDb' already exists. Drop it first, or pass -TargetDb with a different name.`n       Refusing to restore over an existing database - that would silently merge two datasets."
}
Ok "target '$TargetDb' is free"

# ------------------------------------------------------------------- export --
Step 2 "Export from Supabase (read-only) -> $OutDir"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$dumpFile = Join-Path $OutDir 'full.dump'
$schemaFile = Join-Path $OutDir 'public-schema.sql'

# Custom format = the restore artifact. Plain public schema alongside it,
# because that is what Phase 0 diffs against Supabase/migrations/ to recover
# the nine RPCs and the alerts/scanners tables that have no migration file.
& pg_dump $SourceUrl --format=custom --no-owner `
    --schema=public --schema=auth --schema=storage `
    --file=$dumpFile
if ($LASTEXITCODE -ne 0) { Die 'pg_dump failed - see the error above.' }
Ok "archive: $dumpFile ($([math]::Round((Get-Item $dumpFile).Length/1MB,2)) MB)"

& pg_dump $SourceUrl --schema-only --no-owner --no-privileges `
    --schema=public --file=$schemaFile
if ($LASTEXITCODE -ne 0) { Warn 'plain schema dump failed; the custom archive above is still usable.' }
else { Ok "plain schema: $schemaFile" }

# Baseline to verify the restore against.
$countsFile = Join-Path $OutDir 'row-counts-source.txt'
& psql $SourceUrl -At -c @"
select 'employees', count(*) from public.employees
union all select 'proximity_cards', count(*) from public.proximity_cards
union all select 'scan_events', count(*) from public.scan_events
union all select 'profiles', count(*) from public.profiles
union all select 'auth.users', count(*) from auth.users
order by 1
"@ > $countsFile
if ($LASTEXITCODE -eq 0) { Ok "source row counts: $countsFile" } else { Warn 'could not read source row counts' }

# ---------------------------------------------------------------- bootstrap --
Step 3 "Create '$TargetDb' and the Supabase roles"

& createdb -U $LocalUser $TargetDb
if ($LASTEXITCODE -ne 0) { Die "createdb failed for '$TargetDb'" }
Ok "created database '$TargetDb'"

$rolesSql = Join-Path $scriptDir 'bootstrap-roles.sql'
if (-not (Test-Path $rolesSql)) { Die "missing $rolesSql" }
& psql -U $LocalUser -d $TargetDb -v ON_ERROR_STOP=1 -f $rolesSql
if ($LASTEXITCODE -ne 0) { Die 'bootstrap-roles.sql failed - see the error above.' }
Ok 'roles, schemas and available extensions created'

# ------------------------------------------------------------------ restore --
Step 4 "Restore into '$TargetDb'"

# No --exit-on-error: the dump references extensions stock PostgreSQL does not
# have (pg_cron, pg_graphql, pgjwt, supabase_vault). Those errors are expected
# and harmless for a schema/data migration; aborting on the first one would
# throw away a restore that is otherwise complete. Everything is logged so a
# real failure is still visible.
$restoreLog = Join-Path $OutDir 'restore.log'
# Same PowerShell 5.1 stderr-wrapping trap as the preflight probe above: this
# call redirects, and pg_restore is EXPECTED to write errors here (the missing
# extensions), so without relaxing the preference the script would abort on a
# restore that is actually fine.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& pg_restore --no-owner --dbname "postgresql://$LocalUser@localhost/$TargetDb" $dumpFile 2>&1 |
  Tee-Object -FilePath $restoreLog | Out-Null
$ErrorActionPreference = $prevEap

$errors = Select-String -Path $restoreLog -Pattern '^pg_restore: error' -ErrorAction SilentlyContinue
$expected = 'pg_cron|pg_graphql|pgjwt|supabase_vault|must be owner|already exists'
$unexpected = $errors | Where-Object { $_.Line -notmatch $expected }

Ok "restore log: $restoreLog"
if ($errors)     { Warn "$($errors.Count) restore error(s) logged" }
if ($unexpected) {
  Warn "$($unexpected.Count) UNEXPECTED error(s) - these are not the known missing-extension ones:"
  $unexpected | Select-Object -First 10 | ForEach-Object { Write-Host "      $($_.Line)" -ForegroundColor Yellow }
}

# ------------------------------------------------------------------- verify --
Step 5 'Verify'

$targetCounts = & psql -U $LocalUser -d $TargetDb -At -c @"
select 'employees', count(*) from public.employees
union all select 'proximity_cards', count(*) from public.proximity_cards
union all select 'scan_events', count(*) from public.scan_events
union all select 'profiles', count(*) from public.profiles
union all select 'auth.users', count(*) from auth.users
order by 1
"@

Write-Host "`n    source (Supabase)          local ($TargetDb)" -ForegroundColor Gray
$src = if (Test-Path $countsFile) { Get-Content $countsFile } else { @() }
$mismatch = $false
for ($i = 0; $i -lt [Math]::Max($src.Count, $targetCounts.Count); $i++) {
  $s = if ($i -lt $src.Count) { $src[$i] } else { '(missing)' }
  $t = if ($i -lt $targetCounts.Count) { $targetCounts[$i] } else { '(missing)' }
  $same = ($s -eq $t)
  if (-not $same) { $mismatch = $true }
  Write-Host ("    {0,-26} {1}  {2}" -f $s, $t, $(if ($same) { 'match' } else { 'MISMATCH' })) `
    -ForegroundColor $(if ($same) { 'Green' } else { 'Red' })
}

Write-Host ''
if ($mismatch) {
  Die "row counts differ. Do NOT treat '$TargetDb' as a valid copy until this is explained - read $restoreLog."
}
Write-Host "Local copy verified: $TargetDb" -ForegroundColor Green
Write-Host @"

Next:
  - Diff $schemaFile against Supabase\migrations\ to recover the nine RPCs and
    the alerts/scanners tables that have no migration file (see
    docs\LOCAL_DATABASE_ARCHITECTURE.md section 2).
  - This is a DATABASE copy only. The browser still talks to Supabase for RLS,
    Auth, Realtime, Storage and Edge Functions - see the runbook before
    assuming the app can point at this.
  - pg_cron jobs did not come across. Check the archival / scan-log-trim /
    scanner-silence schedules.
"@ -ForegroundColor Gray
