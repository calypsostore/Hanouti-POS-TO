[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$')]
    [string]$BackupId,

    [string]$OutputPath
)

$sshDirectory = Join-Path $env:USERPROFILE '.ssh'
$privateKey = Join-Path $sshDirectory 'hanouti-vps-deploy'
$knownHosts = Join-Path $sshDirectory 'hanouti-vps-known_hosts'
foreach ($requiredFile in @($privateKey, $knownHosts)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required pinned SSH configuration is missing: $requiredFile"
    }
}

if (-not $PSBoundParameters.ContainsKey('OutputPath')) {
    $downloads = Join-Path $env:USERPROFILE 'Downloads'
    $OutputPath = Join-Path $downloads "hanouti-pos-$BackupId.tar"
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    throw 'The output directory does not exist.'
}
if (Test-Path -LiteralPath $OutputPath) {
    throw 'Refusing to overwrite an existing backup bundle.'
}

$request = @{ action = 'database-backup-export'; backup_id = $BackupId } |
    ConvertTo-Json -Compress
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) (
    'hanouti-pos-export-' + [Guid]::NewGuid().ToString('N')
)
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
$requestPath = Join-Path $temporaryDirectory 'request.json'
$partialPath = Join-Path $temporaryDirectory 'backup.tar'
$errorPath = Join-Path $temporaryDirectory 'ssh.stderr'
try {
    [IO.File]::WriteAllText($requestPath, $request + "`n", [Text.Encoding]::ASCII)
    $sshCommand = Get-Command ssh.exe -ErrorAction Stop
    $arguments = @(
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
    $quotedArguments = foreach ($argument in $arguments) {
        '"' + ($argument -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
    }
    $process = Start-Process -FilePath $sshCommand.Source `
        -ArgumentList ($quotedArguments -join ' ') `
        -RedirectStandardInput $requestPath `
        -RedirectStandardOutput $partialPath `
        -RedirectStandardError $errorPath `
        -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $partialPath -PathType Leaf)) {
        throw "Encrypted backup export failed with exit code $($process.ExitCode)."
    }
    Move-Item -LiteralPath $partialPath -Destination $OutputPath
    Write-Output "Encrypted backup exported to $OutputPath"
}
finally {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
