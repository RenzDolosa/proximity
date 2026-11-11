<#
.SYNOPSIS
  Shared psql discovery and connection handling for the scripts in this
  directory. Dot-source it; it defines functions and runs nothing.

.DESCRIPTION
  Apply-Migration.ps1 accumulated five hard-won guards, each one written after
  a specific failure against the live project:

    1. psql is installed but not on PATH, so `psql ...` fails outright.
    2. PowerShell is not bash: `psql "$DATABASE_URL"` passes an EMPTY string,
       because $DATABASE_URL is an undefined PowerShell variable rather than
       an environment variable. The env-var spelling is $env:NAME.
    3. A password containing '@' breaks the URI before a socket is opened:
       the first '@' ends the userinfo section, so libpq treats the rest of
       the password plus the real host as one hostname. It fails with "could
       not translate host name", which reads like DNS and is not -- and it
       prints part of the password to the terminal on the way out.
    4. db.<ref>.supabase.co is IPv6-ONLY. On a network without IPv6 psql
       fails with "could not translate host name ... Name or service not
       known", which reads as a mistyped hostname or a deleted project and
       is neither.
    5. psql takes client_encoding from the Windows console locale, usually
       WIN1252 here, and a multi-byte character in a SQL comment is then
       enough to abort a whole transaction with "invalid byte sequence for
       encoding".

  They live here rather than in one script because a second copy is how they
  come back. test/psql-tooling.test.mjs fails if either script redefines
  them locally.
#>

# Newest major version first, so a 17 client is preferred over an older one.
# A client older than the server refuses to connect cleanly.
function Find-Psql {
  $onPath = Get-Command psql -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
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

function Get-PsqlOrThrow {
  $psql = Find-Psql
  if (-not $psql) {
    throw "psql not found. Install the PostgreSQL 17 client tools (winget install -e --id PostgreSQL.PostgreSQL.17), or add its bin\ directory to PATH."
  }
  return $psql
}

# Checked BEFORE connecting, because the answer ("use the session-mode pooler,
# with a different username") is not guessable from psql's own error text.
function Test-HostReachable([string] $HostName) {
  if ([string]::IsNullOrWhiteSpace($HostName)) { return }

  $hasA = $false
  $hasAAAA = $false
  try { $hasA = [bool](Resolve-DnsName $HostName -Type A -ErrorAction Stop | Where-Object { $_.Type -eq 'A' }) } catch {}
  try { $hasAAAA = [bool](Resolve-DnsName $HostName -Type AAAA -ErrorAction Stop | Where-Object { $_.Type -eq 'AAAA' }) } catch {}

  if ($hasA) { return }  # An IPv4 path exists; nothing to warn about.

  # Warn rather than throw: this may be transient DNS, and psql's own error is
  # more informative than a guess would be.
  if (-not $hasAAAA) {
    Write-Warning "$HostName does not resolve at all. Check the hostname and this machine's DNS."
    return
  }

  $globalV6 = Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue |
    Where-Object { $_.PrefixOrigin -ne 'WellKnown' -and $_.IPAddress -notlike 'fe80*' -and $_.IPAddress -ne '::1' }
  if ($globalV6) { return }

  throw @"
$HostName resolves to IPv6 only, and this machine has no global IPv6 address.

psql would fail with "could not translate host name ... Name or service not
known", which looks like a typo and is not: the hostname is correct and the
project is fine, but db.<ref>.supabase.co lost its IPv4 address when Supabase
removed dedicated IPv4 from direct connections.

Use the SESSION-MODE POOLER instead, which has IPv4. Note the username:

  `$env:PGHOST     = 'aws-N-<region>.pooler.supabase.com'   # N + region from the dashboard
  `$env:PGPORT     = '5432'                                 # 5432, NOT 6543
  `$env:PGUSER     = 'postgres.<project-ref>'               # NOT plain 'postgres'
  `$env:PGDATABASE = 'postgres'
  `$env:PGPASSWORD = '<password>'

Project Settings > Database > Connection string > "Session pooler" has the
exact host and user. Port 6543 on that same host is TRANSACTION mode, which
hands back a different backend per transaction; 5432 is session mode.
"@
}

<#
.SYNOPSIS
  Works out how psql should connect, without ever echoing the password.

.OUTPUTS
  A hashtable:
    Args    - splat straight onto psql. EMPTY when the PG* variables are in
              use, so libpq reads them itself; nothing is interpolated.
    Display - a safe one-line description of the target, for printing.
    Host    - the hostname, for Test-HostReachable.
#>
function Resolve-PsqlTarget([string] $ConnectionString) {
  $useEnvVars = [string]::IsNullOrWhiteSpace($ConnectionString) -and
                -not [string]::IsNullOrWhiteSpace($env:PGHOST)

  if ($useEnvVars) {
    if ([string]::IsNullOrWhiteSpace($env:PGPASSWORD)) {
      throw '$env:PGHOST is set but $env:PGPASSWORD is empty, so psql would prompt and hang.'
    }
    return @{
      Args    = @()
      Display = "$env:PGHOST (from PG* environment variables)"
      Host    = $env:PGHOST
    }
  }

  if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
    throw @'
No connection target. Use EITHER of these (note the $env: prefix -- plain
$NAME is a PowerShell variable, not an environment variable, and expands to
empty, which silently connects to localhost).

PREFERRED -- no encoding needed, whatever characters the password contains:

  $env:PGHOST     = 'aws-N-<region>.pooler.supabase.com'
  $env:PGPORT     = '5432'
  $env:PGUSER     = 'postgres.<project-ref>'
  $env:PGDATABASE = 'postgres'
  $env:PGPASSWORD = '<password>'      # literal, paste it exactly

OR a URI, if the password contains none of @ : / ? # % (if it does, each one
must be percent-encoded -- '@' becomes '%40'):

  $env:SUPABASE_DB_URL = 'postgresql://postgres.<ref>:<password>@aws-N-<region>.pooler.supabase.com:5432/postgres'

Project Settings > Database > Connection string > "Session pooler" has the
exact host and user -- note the user is postgres.<ref>, not plain postgres.
Use port 5432 on that host, NOT 6543.
'@
  }

  # Caught here rather than by DNS, so the message names the real cause and
  # does not echo the password. A well-formed URI has exactly one '@': the one
  # separating userinfo from host.
  if (([regex]::Matches($ConnectionString, '@')).Count -gt 1) {
    throw @'
The connection string has more than one '@', so libpq will read part of the
password as the hostname and fail with "could not translate host name".

The password almost certainly contains an '@'. Either percent-encode it ('@'
becomes '%40', and likewise %3A : / %2F ? %3F # %23 % %25), or avoid the URI
entirely -- which is the better option:

  $env:SUPABASE_DB_URL = ''           # clear the broken one first
  $env:PGHOST     = 'aws-N-<region>.pooler.supabase.com'
  $env:PGPORT     = '5432'
  $env:PGUSER     = 'postgres.<project-ref>'
  $env:PGDATABASE = 'postgres'
  $env:PGPASSWORD = '<password>'

If a password fragment has already been printed to a terminal or pasted
anywhere, treat it as exposed and reset it: Project Settings > Database >
Reset database password.
'@
  }

  # Everything after the LAST '@' is the hostspec, so the password is never
  # read or printed on the way to the hostname.
  $authority = ($ConnectionString -replace '^[a-z]+://', '')
  $hostspec = $authority.Substring($authority.LastIndexOf('@') + 1)

  return @{
    Args    = @($ConnectionString)
    Display = ($hostspec -split '[:/?]')[0]
    Host    = ($hostspec -split '[:/?]')[0]
  }
}

# The migration and query files here are UTF-8 (em-dashes and arrows in
# comments, in nearly all of them). Setting this explicitly is why any of this
# works from PowerShell at all -- see guard 5 above.
function Set-PsqlEncoding {
  $env:PGCLIENTENCODING = 'UTF8'
}
