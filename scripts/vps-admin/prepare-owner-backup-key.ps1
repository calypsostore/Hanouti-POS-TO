$ErrorActionPreference = 'Stop'
$keyHome = Join-Path (Join-Path $env:USERPROFILE '.ssh') 'hanouti-pos-backup-key'
$gpgCommand = Get-Command gpg.exe -ErrorAction SilentlyContinue
if (-not $gpgCommand) {
    $gitGpgPaths = @()
    if ($env:ProgramFiles) {
        $gitGpgPaths += Join-Path $env:ProgramFiles 'Git\usr\bin\gpg.exe'
    }
    if (${env:ProgramFiles(x86)}) {
        $gitGpgPaths += Join-Path ${env:ProgramFiles(x86)} 'Git\usr\bin\gpg.exe'
    }
    $gitGpgPath = $gitGpgPaths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
    if ($gitGpgPath) {
        $gpgCommand = [pscustomobject]@{ Source = $gitGpgPath }
    }
}
if (-not $gpgCommand) {
    throw 'GPG is unavailable. No backup key was generated; install GnuPG from its official source and rerun this script.'
}
$gpgBinDirectory = Split-Path -Parent $gpgCommand.Source
$env:PATH = "$gpgBinDirectory;$env:PATH"
$gpgHome = $keyHome
$cygpath = Join-Path $gpgBinDirectory 'cygpath.exe'
if (Test-Path -LiteralPath $cygpath -PathType Leaf) {
    $gpgHome = (& $cygpath -u $keyHome).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $gpgHome.StartsWith('/')) {
        throw 'The Git-bundled GPG home path could not be converted safely.'
    }
}

if (Test-Path -LiteralPath $keyHome) {
    throw "Refusing to overwrite an existing backup key directory: $keyHome"
}
New-Item -ItemType Directory -Path $keyHome | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$userSid = $identity.User.Value
$icacls = Join-Path $env:WINDIR 'System32\icacls.exe'
& $icacls $keyHome '/inheritance:r' '/grant:r' `
    "*$($userSid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'
if ($LASTEXITCODE -ne 0) {
    & $icacls $keyHome '/inheritance:e' | Out-Null
    throw 'Could not restrict the owner backup-key directory ACL.'
}

$previousHome = $env:GNUPGHOME
$env:GNUPGHOME = $gpgHome
try {
    Write-Output 'GPG will prompt for an OpenPGP key. Choose an encryption-capable RSA key, 4096 bits, and set a strong private-key passphrase.'
    Write-Output 'The passphrase is entered only in the local GPG prompt; do not save or share it in chat, scripts, or logs.'
    & $gpgCommand.Source --homedir $gpgHome --full-generate-key
    if ($LASTEXITCODE -ne 0) {
        throw 'GPG key generation did not complete successfully.'
    }

    $colonOutput = & $gpgCommand.Source --homedir $gpgHome --batch --with-colons --list-secret-keys
    if ($LASTEXITCODE -ne 0) {
        throw 'The generated secret key could not be inspected.'
    }
    $fingerprints = @()
    $keyRecord = $false
    $encryptionCapable = $false
    foreach ($line in $colonOutput) {
        $fields = $line -split ':'
        if ($fields[0] -in @('sec', 'ssb')) {
            $keyRecord = $true
            if ($fields.Count -gt 11 -and $fields[11].ToLowerInvariant().Contains('e')) {
                $encryptionCapable = $true
            }
        }
        elseif ($fields[0] -eq 'fpr' -and $keyRecord -and $fields.Count -gt 9) {
            $fingerprints += $fields[9]
            $keyRecord = $false
        }
    }
    if ($fingerprints.Count -lt 1 -or -not $encryptionCapable) {
        throw 'The generated key does not expose a usable encryption capability.'
    }
    $fingerprint = $fingerprints[0]
    $publicPath = Join-Path $keyHome 'backup-recipient.asc'
    $fingerprintPath = Join-Path $keyHome 'backup-recipient-fingerprint'
    $publicKey = & $gpgCommand.Source --homedir $gpgHome --batch --armor --export $fingerprint
    if ($LASTEXITCODE -ne 0 -or -not $publicKey) {
        throw 'The public backup recipient key could not be exported.'
    }
    [IO.File]::WriteAllText(
        $publicPath,
        (($publicKey -join "`n") + "`n"),
        [Text.Encoding]::ASCII
    )
    [IO.File]::WriteAllText($fingerprintPath, "$fingerprint`n", [Text.Encoding]::ASCII)
    Write-Output "Public recipient: $publicPath"
    Write-Output "Pinned fingerprint: $fingerprint"
    Write-Output 'The private key remains in the protected GPG home. Back it up to encrypted offline media before any server bootstrap.'
}
finally {
    if ($null -eq $previousHome) {
        Remove-Item Env:\GNUPGHOME -ErrorAction SilentlyContinue
    }
    else {
        $env:GNUPGHOME = $previousHome
    }
}
