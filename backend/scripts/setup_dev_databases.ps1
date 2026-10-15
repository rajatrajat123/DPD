<#
.SYNOPSIS
    Aura Platform - Least-Privilege PostgreSQL Provisioning Script.
.DESCRIPTION
    Prompts for superuser password and application password securely without echoing or hardcoding.
    Configures dedicated 'aura' role without SUPERUSER, CREATEDB, or CREATEROLE privileges.
    Idempotently creates 'aura_dev' and 'aura_test' databases without dropping existing data.
    Configures required extensions ('postgis', 'pgcrypto', 'citext') and public schema privileges.
    Safely updates backend/.env with URL-encoded credentials without overwriting unrelated settings.
    Verifies all database, extension, and least-privilege invariants before declaring completion.
#>
[CmdletBinding()]
param (
    [Alias("AdminUser")]
    [string]$Superuser = "postgres",

    [Alias("Host")]
    [string]$DbHost = "127.0.0.1",

    [int]$Port = 5432
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Aura Platform - Least-Privilege PostgreSQL Provisioning ===" -ForegroundColor Cyan

# 1. Locate psql.exe
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
if (-not (Test-Path -Path $psql)) {
    $found = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($found) {
        $psql = $found.Source
    } else {
        Write-Error "psql.exe was not found. Please ensure PostgreSQL 18 is installed."
        exit 1
    }
}

# 2. Secure credential inputs (passwords masked from console)
Write-Host "1. Enter password for superuser '$Superuser' on ${DbHost}:${Port}:"
$superPass = Read-Host -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($superPass)
$superPassPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

Write-Host "2. Enter password for application role 'aura' (used to synchronize backend/.env):"
$auraPass = Read-Host -AsSecureString
$BSTR2 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($auraPass)
$auraPassPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR2)

# Pass superuser password to psql via environment variable
$env:PGPASSWORD = $superPassPlain

try {
    # Helper to execute query and safely return trimmed string output without null exceptions
    function Invoke-PsqlScalar {
        param (
            [string]$Query,
            [string]$Database = "postgres"
        )

        $output = & $psql -U $Superuser -h $DbHost -p $Port -d $Database -t -A -c $Query
        if ($LASTEXITCODE -ne 0) {
            throw "psql failed with exit code $LASTEXITCODE for query on '$Database': $Query"
        }

        if ($null -eq $output) {
            return ""
        }
        if ($output -is [array]) {
            return ([string]::Join("`n", $output)).Trim()
        }
        return ([string]$output).Trim()
    }

    # Helper to execute non-query commands and verify exit code
    function Invoke-PsqlCommand {
        param (
            [string]$Command,
            [string]$Database = "postgres"
        )

        & $psql -U $Superuser -h $DbHost -p $Port -d $Database -c $Command
        if ($LASTEXITCODE -ne 0) {
            throw "psql command failed with exit code $LASTEXITCODE on '$Database': $Command"
        }
    }

    # 3. Handle application role 'aura'
    Write-Host "Checking if application role 'aura' exists..."
    $roleExists = Invoke-PsqlScalar -Query "SELECT 1 FROM pg_roles WHERE rolname = 'aura';"

    if ($roleExists -eq "1") {
        Write-Host "Application role 'aura' already exists." -ForegroundColor Yellow
        if (-not [string]::IsNullOrWhiteSpace($auraPassPlain)) {
            Write-Host "Updating password for application role 'aura'..."
            $escapedSqlPass = $auraPassPlain.Replace("'", "''")
            Invoke-PsqlCommand -Command "ALTER ROLE aura WITH PASSWORD '$escapedSqlPass';"
        } else {
            Write-Host "Preserving existing password for role 'aura'." -ForegroundColor Green
        }
    } else {
        if ([string]::IsNullOrWhiteSpace($auraPassPlain)) {
            throw "Application role 'aura' does not exist yet. A password must be provided to create it."
        }
        Write-Host "Creating application role 'aura' (WITHOUT SUPERUSER / CREATEDB / CREATEROLE)..."
        Invoke-PsqlCommand -Command "CREATE ROLE aura WITH LOGIN;"
        $escapedSqlPass = $auraPassPlain.Replace("'", "''")
        Invoke-PsqlCommand -Command "ALTER ROLE aura WITH PASSWORD '$escapedSqlPass';"
    }

    # Strictly enforce least-privilege security invariants
    Write-Host "Enforcing least-privilege invariants on role 'aura' (NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION)..."
    Invoke-PsqlCommand -Command "ALTER ROLE aura NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;"

    # 4. Helper function to idempotently create databases without fragile \gexec or dropping data
    function Ensure-DatabaseExists {
        param (
            [string]$DatabaseName,
            [string]$Owner = "aura"
        )

        Write-Host "Checking if database '$DatabaseName' exists..."
        $exists = Invoke-PsqlScalar -Query "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName';"

        if ($exists -eq "1") {
            Write-Host "Database '$DatabaseName' already exists. Preserving existing database." -ForegroundColor Yellow
        } else {
            Write-Host "Creating database '$DatabaseName' owned by '$Owner'..."
            Invoke-PsqlCommand -Command "CREATE DATABASE $DatabaseName OWNER $Owner;"
            Write-Host "Database '$DatabaseName' created successfully." -ForegroundColor Green
        }
    }

    # 5. Create 'aura_dev' and 'aura_test' idempotently
    Ensure-DatabaseExists -DatabaseName "aura_dev" -Owner "aura"
    Ensure-DatabaseExists -DatabaseName "aura_test" -Owner "aura"

    # 6. Configure PostGIS, pgcrypto, citext and public schema permissions in 'aura_dev'
    Write-Host "Configuring extensions and schema permissions in 'aura_dev'..."
    $extSql = "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS postgis; GRANT ALL ON SCHEMA public TO aura; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO aura; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO aura;"
    Invoke-PsqlCommand -Command $extSql -Database "aura_dev"

    # 7. Configure PostGIS, pgcrypto, citext and public schema permissions in 'aura_test'
    Write-Host "Configuring extensions and schema permissions in 'aura_test'..."
    Invoke-PsqlCommand -Command $extSql -Database "aura_test"

    # 8. Safe handling and updates to backend/.env
    $scriptDir = $PSScriptRoot
    if ([string]::IsNullOrEmpty($scriptDir)) {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    $backendDir = Split-Path -Parent $scriptDir
    $envPath = Join-Path -Path $backendDir -ChildPath ".env"

    if (-not [string]::IsNullOrWhiteSpace($auraPassPlain)) {
        # Safe URL encoding for passwords containing special characters
        $encodedAuraPass = [System.Uri]::EscapeDataString($auraPassPlain)
        $databaseUrl = "postgres://aura:${encodedAuraPass}@${DbHost}:${Port}/aura_dev?sslmode=disable"
        $testDatabaseUrl = "postgres://aura:${encodedAuraPass}@${DbHost}:${Port}/aura_test?sslmode=disable"

        $updatedKeys = @{
            "DATABASE_URL"      = $databaseUrl
            "TEST_DATABASE_URL" = $testDatabaseUrl
        }

        if (Test-Path -Path $envPath) {
            $lines = [System.Collections.Generic.List[string]]::new()
            $foundKeys = @{}
            $existingContent = Get-Content -Path $envPath

            foreach ($line in $existingContent) {
                $trimmed = $line.Trim()
                if ($trimmed.StartsWith("#") -or [string]::IsNullOrWhiteSpace($trimmed)) {
                    $lines.Add($line)
                    continue
                }

                $eqIdx = $line.IndexOf('=')
                if ($eqIdx -gt 0) {
                    $key = $line.Substring(0, $eqIdx).Trim()
                    if ($updatedKeys.ContainsKey($key)) {
                        $lines.Add("${key}=$($updatedKeys[$key])")
                        $foundKeys[$key] = $true
                        continue
                    }
                }
                $lines.Add($line)
            }

            foreach ($key in $updatedKeys.Keys) {
                if (-not $foundKeys.ContainsKey($key)) {
                    $lines.Add("${key}=$($updatedKeys[$key])")
                }
            }

            [System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.Encoding]::UTF8)
            Write-Host "Safely synchronized database URLs in existing backend/.env (preserved other settings)." -ForegroundColor Green
        } else {
            $exampleFile = Join-Path -Path $backendDir -ChildPath ".env.example"
            if (-not (Test-Path -Path $exampleFile)) {
                $rootDir = Split-Path -Parent $backendDir
                $exampleFile = Join-Path -Path $rootDir -ChildPath ".env.example"
            }

            $lines = [System.Collections.Generic.List[string]]::new()
            if (Test-Path -Path $exampleFile) {
                $exampleContent = Get-Content -Path $exampleFile
                foreach ($line in $exampleContent) {
                    $trimmed = $line.Trim()
                    if ($trimmed.StartsWith("#") -or [string]::IsNullOrWhiteSpace($trimmed)) {
                        $lines.Add($line)
                        continue
                    }
                    $eqIdx = $line.IndexOf('=')
                    if ($eqIdx -gt 0) {
                        $key = $line.Substring(0, $eqIdx).Trim()
                        if ($updatedKeys.ContainsKey($key)) {
                            $lines.Add("${key}=$($updatedKeys[$key])")
                            continue
                        }
                    }
                    $lines.Add($line)
                }
                if (-not $lines.Contains("TEST_DATABASE_URL=$testDatabaseUrl")) {
                    $lines.Add("TEST_DATABASE_URL=$testDatabaseUrl")
                }
            } else {
                $lines.Add("APP_ENV=development")
                $lines.Add("DATABASE_URL=$databaseUrl")
                $lines.Add("TEST_DATABASE_URL=$testDatabaseUrl")
                $lines.Add("JWT_SIGNING_SECRET=local-dev-only-jwt-signing-secret-must-be-changed-32b")
            }

            [System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.Encoding]::UTF8)
            Write-Host "Created backend/.env with local development credentials." -ForegroundColor Green
        }
    } else {
        if (Test-Path -Path $envPath) {
            Write-Host "Preserved existing database URLs in backend/.env." -ForegroundColor Green
        } else {
            Write-Host "Warning: backend/.env does not exist and no password was provided to create it." -ForegroundColor Yellow
        }
    }

    # 9. Rigorous post-provisioning verification gate
    Write-Host "=== Running Post-Provisioning Verification Gate ===" -ForegroundColor Cyan

    # Verification A: Verify role 'aura' exists and strictly conforms to least-privilege invariants
    Write-Host "Verifying 'aura' role least-privilege status..."
    $roleCheck = Invoke-PsqlScalar -Query "SELECT rolsuper, rolcreatedb, rolcanlogin FROM pg_roles WHERE rolname = 'aura';"
    if ([string]::IsNullOrWhiteSpace($roleCheck)) {
        throw "Verification gate failed: application role 'aura' could not be found in pg_roles."
    }
    $roleParts = $roleCheck.Split('|')
    if ($roleParts.Count -lt 3) {
        throw "Verification gate failed: unexpected role query response: '$roleCheck'."
    }
    $isSuper = $roleParts[0].Trim().ToLower()
    $isCreatedb = $roleParts[1].Trim().ToLower()
    $canLogin = $roleParts[2].Trim().ToLower()

    if ($canLogin -ne "t" -and $canLogin -ne "true") {
        throw "Verification gate failed: role 'aura' cannot log in (rolcanlogin != true)."
    }
    if ($isSuper -eq "t" -or $isSuper -eq "true") {
        throw "SECURITY VIOLATION: role 'aura' possesses SUPERUSER privileges."
    }
    if ($isCreatedb -eq "t" -or $isCreatedb -eq "true") {
        throw "SECURITY VIOLATION: role 'aura' possesses CREATEDB privileges."
    }
    Write-Host "  [OK] Role 'aura' verified: login allowed, NOSUPERUSER, NOCREATEDB." -ForegroundColor Green

    # Verification B: Verify both databases exist
    Write-Host "Verifying database existence..."
    foreach ($db in @("aura_dev", "aura_test")) {
        $dbCheck = Invoke-PsqlScalar -Query "SELECT 1 FROM pg_database WHERE datname = '$db';"
        if ($dbCheck -ne "1") {
            throw "Verification gate failed: database '$db' does not exist in pg_database."
        }
        Write-Host "  [OK] Database '$db' confirmed present." -ForegroundColor Green
    }

    # Verification C: Verify extensions ('pgcrypto', 'citext', 'postgis') in both databases
    Write-Host "Verifying extensions in 'aura_dev' and 'aura_test'..."
    foreach ($db in @("aura_dev", "aura_test")) {
        $extCheck = Invoke-PsqlScalar -Query "SELECT count(*) FROM pg_extension WHERE extname IN ('pgcrypto', 'citext', 'postgis');" -Database $db
        $count = 0
        if (-not [int]::TryParse($extCheck, [ref]$count) -or $count -lt 3) {
            throw "Verification gate failed: expected 3 extensions in '$db', but found: '$extCheck'."
        }
        Write-Host "  [OK] Database '$db' has all 3 required extensions installed." -ForegroundColor Green
    }

    # Verification D: Verify schema privileges for 'aura'
    Write-Host "Verifying schema privileges for 'aura'..."
    foreach ($db in @("aura_dev", "aura_test")) {
        $privCheck = Invoke-PsqlScalar -Query "SELECT has_schema_privilege('aura', 'public', 'USAGE, CREATE');" -Database $db
        if ($privCheck.ToLower() -ne "t" -and $privCheck.ToLower() -ne "true") {
            throw "Verification gate failed: 'aura' lacks USAGE/CREATE privilege on schema public in '$db'."
        }
        Write-Host "  [OK] Role 'aura' has schema privileges in '$db'." -ForegroundColor Green
    }

    Write-Host "=== Least-privilege PostgreSQL provisioning complete! ===" -ForegroundColor Green
} finally {
    # 10. Clean up sensitive plaintext credentials from memory and environment
    $env:PGPASSWORD = ""
    if ($BSTR -ne [System.IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
    }
    if ($BSTR2 -ne [System.IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR2)
    }
    $superPassPlain = $null
    $auraPassPlain = $null
}
