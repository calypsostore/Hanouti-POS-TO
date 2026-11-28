[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        'host-status',
        'paths',
        'compose-validate',
        'compose-preflight',
        'compose-status',
        'compose-health',
        'compose-log-summary',
        'database-ready',
        'endpoint-health',
        'frontend-status',
        'nginx-test',
        'certificate-status',
        'database-backup-list',
        'database-backup',
        'database-backup-verify',
        'database-backup-export',
        'backup-signer',
        'functions-deploy',
        'functions-rollback',
        'stack-deploy',
        'stack-rollback'
    )]
    [string]$Action,

    [ValidateSet(
        'db',
        'auth',
        'rest',
        'realtime',
        'storage',
        'imgproxy',
        'functions',
        'meta',
        'studio',
        'kong',
        'supavisor'
    )]
    [string]$Service,

    [string]$BackupId,
    [string]$ReleaseId,
    [ValidateSet('ROLLBACK')]
    [string]$Confirmation,
    [switch]$ValidateOnly
)

$requiresService = $Action -eq 'compose-log-summary'
if ($requiresService -and -not $PSBoundParameters.ContainsKey('Service')) {
    throw "$Action requires an allowlisted -Service."
}
if (-not $requiresService -and $PSBoundParameters.ContainsKey('Service')) {
    throw '-Service is accepted only with compose-log-summary.'
}

$request = @{ action = $Action }
if ($requiresService) {
    $request.service = $Service
}
if ($Action -in @('database-backup-verify', 'database-backup-export')) {
    if ($BackupId -notmatch '^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$') {
        throw "$Action requires a valid -BackupId."
    }
    $request.backup_id = $BackupId
}
elseif ($Action -eq 'stack-deploy') {
    if ($BackupId -notmatch '^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$') {
        throw 'stack-deploy requires a valid -BackupId that has already passed verification.'
    }
    $request.backup_id = $BackupId
}
elseif ($PSBoundParameters.ContainsKey('BackupId')) {
    throw '-BackupId is accepted only with a backup or stack deployment action.'
}

if ($Action -in @('functions-deploy', 'stack-deploy')) {
    if ($ReleaseId -notmatch '^[a-f0-9]{40}-[0-9]{1,20}-[0-9]{1,4}$') {
        throw "$Action requires a valid -ReleaseId."
    }
    $request.release_id = $ReleaseId
}
elseif ($PSBoundParameters.ContainsKey('ReleaseId')) {
    throw '-ReleaseId is accepted only with a deploy action.'
}

if ($Action -in @('functions-rollback', 'stack-rollback')) {
    if ($Confirmation -ne 'ROLLBACK') {
        throw "$Action requires -Confirmation ROLLBACK."
    }
}
elseif ($PSBoundParameters.ContainsKey('Confirmation')) {
    throw '-Confirmation is accepted only with a rollback action.'
}

$requestJson = $request | ConvertTo-Json -Compress
if ($ValidateOnly) {
    Write-Output "request-valid action=$Action"
    return
}
if ($Action -eq 'database-backup-export') {
    throw 'Use scripts\vps-admin\export-backup.ps1 so binary backup bytes are preserved.'
}

$sshDirectory = Join-Path $env:USERPROFILE '.ssh'
$privateKey = Join-Path $sshDirectory 'hanouti-vps-deploy'
$knownHosts = Join-Path $sshDirectory 'hanouti-vps-known_hosts'
if (-not (Test-Path -LiteralPath $privateKey -PathType Leaf)) {
    throw 'The configured Hanouti VPS SSH key is missing.'
}
if (-not (Test-Path -LiteralPath $knownHosts -PathType Leaf)) {
    throw 'The configured Hanouti VPS known_hosts file is missing.'
}
$sshCommand = Get-Command ssh.exe -ErrorAction Stop
$sshArguments = @(
    '-i', $privateKey,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', "UserKnownHostsFile=$knownHosts",
    '-o', 'ConnectTimeout=12',
    'hanouti-deploy@84.247.176.105',
    'sudo -n /usr/local/sbin/hanouti-pos-admin-v3'
)

$requestJson | & $sshCommand.Source @sshArguments
if ($LASTEXITCODE -ne 0) {
    throw "Hanouti POS v3 administrative request failed with exit code $LASTEXITCODE."
}
