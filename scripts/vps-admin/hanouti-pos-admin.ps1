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
        'compose-pull',
        'compose-up',
        'compose-stop',
        'compose-restart',
        'database-ready',
        'endpoint-health',
        'frontend-status',
        'nginx-test',
        'certificate-status'
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

    [switch]$ValidateOnly
)

$requiresService = $Action -in @('compose-restart', 'compose-log-summary')
if ($requiresService -and -not $PSBoundParameters.ContainsKey('Service')) {
    throw "$Action requires an allowlisted -Service."
}
if (-not $requiresService -and $PSBoundParameters.ContainsKey('Service')) {
    throw '-Service is accepted only with compose-restart or compose-log-summary.'
}

$request = @{ action = $Action }
if ($requiresService) {
    $request.service = $Service
}
$requestJson = $request | ConvertTo-Json -Compress
if ($ValidateOnly) {
    Write-Output "request-valid action=$Action"
    return
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
    'sudo -n /usr/local/sbin/hanouti-pos-admin'
)

$requestJson | & $sshCommand.Source @sshArguments
if ($LASTEXITCODE -ne 0) {
    throw "Hanouti POS administrative request failed with exit code $LASTEXITCODE."
}
