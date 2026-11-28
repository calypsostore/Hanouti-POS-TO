[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $env:USERPROFILE 'Documents\hanouti-pos-backup.allowed_signers')
)

$sshDirectory = Join-Path $env:USERPROFILE '.ssh'
$privateKey = Join-Path $sshDirectory 'hanouti-vps-deploy'
$knownHosts = Join-Path $sshDirectory 'hanouti-vps-known_hosts'
foreach ($requiredFile in @($privateKey, $knownHosts)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required pinned SSH configuration is missing: $requiredFile"
    }
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $OutputPath) {
    throw 'Refusing to overwrite an existing backup signer file.'
}
$parent = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw 'The output directory does not exist.'
}

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
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) (
    'hanouti-pos-signer-' + [Guid]::NewGuid().ToString('N')
)
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
$requestPath = Join-Path $temporaryDirectory 'request.json'
$outputTemp = Join-Path $temporaryDirectory 'signers'
$errorPath = Join-Path $temporaryDirectory 'ssh.stderr'
try {
    [IO.File]::WriteAllText(
        $requestPath,
        '{"action":"backup-signer"}' + "`n",
        [Text.Encoding]::ASCII
    )
    $process = Start-Process -FilePath $sshCommand.Source `
        -ArgumentList ($quotedArguments -join ' ') `
        -RedirectStandardInput $requestPath `
        -RedirectStandardOutput $outputTemp `
        -RedirectStandardError $errorPath `
        -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Backup signer export failed with exit code $($process.ExitCode)."
    }
    $data = [IO.File]::ReadAllText($outputTemp, [Text.Encoding]::ASCII)
    if ($data -notmatch '^hanouti-pos-backup ssh-ed25519 [A-Za-z0-9+/]+={0,2} hanouti-pos-backup-manifest\r?\n$') {
        throw 'The VPS returned a backup signer file with an unexpected format.'
    }
    [IO.File]::WriteAllText($OutputPath, $data, [Text.Encoding]::ASCII)
    Write-Output "Pinned backup signer saved to $OutputPath"
}
finally {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
