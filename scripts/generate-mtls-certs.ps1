#!/usr/bin/env pwsh
# Generate mTLS Certificates for Hospital Federation (Windows)
# This creates certificates for secure mutual TLS authentication between hospitals
# Supports any number of hospitals dynamically.

param(
    [Parameter(Mandatory=$false)]
    [string[]]$Hospitals = @("hospital-a", "hospital-b"),
    
    [Parameter(Mandatory=$false)]
    [string]$CertsDir = "certs"
)

New-Item -ItemType Directory -Force -Path $CertsDir | Out-Null

Write-Host "🔐 Generating mTLS Certificates for Hospital Federation..." -ForegroundColor Cyan
Write-Host "   Hospitals: $($Hospitals -join ', ')" -ForegroundColor Gray
Write-Host ""

# Check if OpenSSL is available
$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $openssl) {
    Write-Host "❌ OpenSSL not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install OpenSSL:" -ForegroundColor Yellow
    Write-Host "  Option 1: choco install openssl" -ForegroundColor Gray
    Write-Host "  Option 2: Download from https://slproweb.com/products/Win32OpenSSL.html" -ForegroundColor Gray
    exit 1
}

# 1. Generate CA (Certificate Authority) - only if it doesn't exist yet
if (-not (Test-Path "$CertsDir/ca-cert.pem")) {
    Write-Host "Step 1: Generating Certificate Authority (CA)..." -ForegroundColor Yellow
    openssl genrsa -out "$CertsDir/ca-key.pem" 4096 2>$null
    openssl req -new -x509 -days 3650 -key "$CertsDir/ca-key.pem" -out "$CertsDir/ca-cert.pem" `
        -subj "/C=US/ST=State/L=City/O=Hospital Federation/CN=Federation CA" 2>$null
    Write-Host "  ✓ CA certificate generated" -ForegroundColor Green
} else {
    Write-Host "Step 1: CA certificate already exists, reusing..." -ForegroundColor Yellow
    Write-Host "  ✓ Using existing CA" -ForegroundColor Green
}
Write-Host ""

# 2. Generate certificate for each hospital
$stepNum = 2
foreach ($hospitalID in $Hospitals) {
    $certFile = "$CertsDir/${hospitalID}-cert.pem"
    
    if (Test-Path $certFile) {
        Write-Host "Step ${stepNum}: Certificate for '$hospitalID' already exists, skipping..." -ForegroundColor Yellow
        Write-Host "  ✓ Using existing certificate" -ForegroundColor Green
    } else {
        # Derive display name for the org field
        $suffix = ($hospitalID -replace '^hospital-', '').ToUpper()
        $orgName = "Hospital $suffix"
        
        Write-Host "Step ${stepNum}: Generating $orgName certificates..." -ForegroundColor Yellow
        openssl genrsa -out "$CertsDir/${hospitalID}-key.pem" 4096 2>$null
        openssl req -new -key "$CertsDir/${hospitalID}-key.pem" -out "$CertsDir/${hospitalID}-csr.pem" `
            -subj "/C=US/ST=State/L=City/O=$orgName/CN=${hospitalID}.local" 2>$null
        openssl x509 -req -days 3650 -in "$CertsDir/${hospitalID}-csr.pem" `
            -CA "$CertsDir/ca-cert.pem" -CAkey "$CertsDir/ca-key.pem" -CAcreateserial `
            -out "$CertsDir/${hospitalID}-cert.pem" 2>$null
        Write-Host "  ✓ $orgName certificates generated" -ForegroundColor Green
    }
    Write-Host ""
    $stepNum++
}

# 3. Clean up CSRs
Remove-Item "$CertsDir/*.csr.pem" -ErrorAction SilentlyContinue
Remove-Item "$CertsDir/ca-cert.srl" -ErrorAction SilentlyContinue

Write-Host "✅ mTLS Certificates Generated Successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Generated files in '$CertsDir' directory:" -ForegroundColor Cyan
Write-Host "  - ca-cert.pem          (CA certificate - trust anchor)" -ForegroundColor Gray
Write-Host "  - ca-key.pem           (CA private key)" -ForegroundColor Gray
foreach ($hospitalID in $Hospitals) {
    Write-Host "  - ${hospitalID}-cert.pem  (certificate)" -ForegroundColor Gray
    Write-Host "  - ${hospitalID}-key.pem   (private key)" -ForegroundColor Gray
}
Write-Host ""
Write-Host "📋 Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Deploy with: .\scripts\deploy.ps1 -Hospital <id> -Start" -ForegroundColor Yellow
Write-Host "  2. Certificates are auto-mounted into containers" -ForegroundColor Yellow
