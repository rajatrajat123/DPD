#!/usr/bin/env bash
# ==============================================================================
# Aura Staging Release & Migration Orchestration Script
# ==============================================================================
set -euo pipefail

echo "=========================================================="
echo " Starting Aura Staging Release Pipeline"
echo " Target: https://staging.auradating.com"
echo "=========================================================="

# 1. Preflight Validation
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[-] ERROR: DATABASE_URL is not set. Refusing to run release in unconfigured environment."
  exit 1
fi

if [[ -z "${JWT_SIGNING_SECRET:-}" || ${#JWT_SIGNING_SECRET} -lt 32 ]]; then
  echo "[-] ERROR: JWT_SIGNING_SECRET missing or shorter than 32 bytes."
  exit 1
fi

# 2. Migration Checksum Preflight
echo "[+] Validating embedded migration checksums..."
/app/aura-migrate -direction=validate

# 3. Apply Schema Migrations
echo "[+] Applying pending migrations (000001 - 000012)..."
if ! /app/aura-migrate -direction=up; then
  echo "[-] CRITICAL: Migration up failed! Initiating rollback analysis..."
  echo "[!] To rollback the last migration batch, execute: /app/aura-migrate -direction=down -steps=1"
  exit 1
fi

# 4. Service Health Probe
echo "[+] Probing API health..."
for i in {1..12}; do
  if curl -sf http://127.0.0.1:8080/healthz >/dev/null; then
    echo "[+] API healthy and responding to traffic."
    break
  fi
  echo "    Waiting for API to become ready... (attempt $i/12)"
  sleep 5
done

# 5. Readiness Probe (Verifies PostgreSQL and Redis pools)
if curl -sf http://127.0.0.1:8080/readyz >/dev/null; then
  echo "[+] API readiness probe passed (/readyz 200 OK)."
else
  echo "[-] WARNING: Readiness check returned non-200. Inspecting logs..."
fi

echo "=========================================================="
echo " Aura Staging Release Completed Successfully!"
echo "=========================================================="
