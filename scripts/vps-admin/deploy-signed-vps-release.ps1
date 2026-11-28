[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('edge-functions', 'supabase-stack')]
    [string]$ReleaseType,

    [Parameter(Mandatory = $true)]
    [ValidateSet('DEPLOY')]
    [string]$Confirmation,

    [string]$BackupId
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$gitCommand = Get-Command git.exe -ErrorAction Stop
$pythonCommand = Get-Command python.exe -ErrorAction Stop
$sshKeygen = Get-Command ssh-keygen.exe -ErrorAction Stop
$sshCommand = Get-Command ssh.exe -ErrorAction Stop
$scpCommand = Get-Command scp.exe -ErrorAction Stop

$branch = (& $gitCommand.Source -C $repositoryRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'feature/supabase-vps-deployment') {
    throw 'Signed VPS releases must be built from feature/supabase-vps-deployment.'
}
$worktree = & $gitCommand.Source -C $repositoryRoot status --porcelain --untracked-files=normal
if ($LASTEXITCODE -ne 0 -or $worktree) {
    throw 'Commit all intended release inputs before creating a signed VPS release.'
}
$commit = (& $gitCommand.Source -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') {
    throw 'Could not identify the committed release source.'
}

$signingKey = Join-Path (Join-Path $env:USERPROFILE '.ssh\hanouti-pos-v3-signing') 'functions-signing'
$sshDirectory = Join-Path $env:USERPROFILE '.ssh'
$deploymentKey = Join-Path $sshDirectory 'hanouti-vps-deploy'
$knownHosts = Join-Path $sshDirectory 'hanouti-vps-known_hosts'
$allowedSigners = Join-Path $repositoryRoot 'scripts\vps-admin\keys\edge-functions.allowed_signers'
foreach ($requiredFile in @($signingKey, $deploymentKey, $knownHosts, $allowedSigners)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required local signing or pinned SSH file is missing: $requiredFile"
    }
}

$releaseAttempt = Get-Random -Minimum 1000 -Maximum 9999
$releaseId = '{0}-{1}-{2}' -f $commit, [DateTime]::UtcNow.ToString('yyyyMMddHHmmss'), $releaseAttempt
if ($releaseId -notmatch '^[0-9a-f]{40}-[0-9]{1,20}-[0-9]{1,4}$') {
    throw 'Generated release ID did not match the fixed release format.'
}

$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) (
    'hanouti-pos-release-' + [Guid]::NewGuid().ToString('N')
)
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
$archiveName = if ($ReleaseType -eq 'edge-functions') {
    "supabase-edge-functions-$releaseId.tar.gz"
}
else {
    "supabase-stack-$releaseId.tar.gz"
}
$archivePath = Join-Path $temporaryDirectory $archiveName
$checksumPath = "$archivePath.sha256"
$signaturePath = "$archivePath.sig"

function Assert-Signature([string]$Namespace, [string]$SignerId) {
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $sshKeygen.Source
    $startInfo.Arguments = '-Y verify -f "{0}" -I {1} -n {2} -s "{3}"' -f `
        $allowedSigners, $SignerId, $Namespace, $signaturePath
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw 'Could not start local signed-artifact verification.'
    }
    $archiveStream = [IO.File]::OpenRead($archivePath)
    $exitCode = 1
    try {
        $archiveStream.CopyTo($process.StandardInput.BaseStream)
        $process.StandardInput.Close()
        $process.WaitForExit()
        $exitCode = $process.ExitCode
    }
    finally {
        $archiveStream.Dispose()
        $process.Dispose()
    }
    if ($exitCode -ne 0) {
        throw 'The locally generated release signature did not verify.'
    }
}

try {
    if ($ReleaseType -eq 'edge-functions') {
        if ($PSBoundParameters.ContainsKey('BackupId')) {
            throw '-BackupId is accepted only for a Supabase stack deployment.'
        }
        & $pythonCommand.Source (Join-Path $repositoryRoot '.github\scripts\package-supabase-vps-functions.py') `
            --output $archivePath
        if ($LASTEXITCODE -ne 0) {
            throw 'Edge Function package validation failed.'
        }
        $signatureNamespace = 'hanouti-pos-edge-functions'
        $action = 'functions-deploy'
        $stageName = 'supabase-edge-functions'
    }
    else {
        if ($BackupId -notmatch '^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$') {
            throw 'Supabase stack deployment requires a verified -BackupId.'
        }
        & $pythonCommand.Source (Join-Path $repositoryRoot '.github\scripts\package-supabase-vps-stack.py') `
            --compose (Join-Path $repositoryRoot 'deploy\supabase-vps\docker-compose.yml') `
            --release-id $releaseId `
            --output $archivePath
        if ($LASTEXITCODE -ne 0) {
            throw 'Supabase stack package validation failed.'
        }
        $signatureNamespace = 'hanouti-pos-supabase-stack'
        $action = 'stack-deploy'
        $stageName = 'supabase-stack'
    }
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        throw 'The signed release archive was not created.'
    }

    $digest = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText(
        $checksumPath,
        "$digest  $archiveName`n",
        [Text.Encoding]::ASCII
    )
    & $sshKeygen.Source -Y sign -f $signingKey -n $signatureNamespace $archivePath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $signaturePath -PathType Leaf)) {
        throw 'The release archive could not be signed with the local protected key.'
    }
    Assert-Signature $signatureNamespace 'hanouti-pos-functions'

    $remote = 'hanouti-deploy@84.247.176.105'
    $sshOptions = @(
        '-i', $deploymentKey,
        '-o', 'IdentitiesOnly=yes',
        '-o', 'BatchMode=yes',
        '-o', 'PreferredAuthentications=publickey',
        '-o', 'PasswordAuthentication=no',
        '-o', 'KbdInteractiveAuthentication=no',
        '-o', 'StrictHostKeyChecking=yes',
        '-o', "UserKnownHostsFile=$knownHosts",
        '-o', 'ConnectTimeout=12'
    )
    $remoteStage = "/home/hanouti-deploy/staging/$stageName/$releaseId"
    $stageScript = @"
set -euo pipefail
test "`$(id -un)" = "hanouti-deploy"
home_dir="`$(realpath -e -- /home/hanouti-deploy)"
stage_parent="`$home_dir/staging/$stageName"
if [[ -L "`$home_dir/staging" || -L "`$stage_parent" ]]; then
    echo "Release staging path contains a symlink." >&2
    exit 1
fi
umask 077
mkdir -p -- "`$stage_parent"
test "`$(realpath -e -- "`$stage_parent")" = "`$stage_parent"
test -O "`$stage_parent" && test -w "`$stage_parent" && test -x "`$stage_parent"
stage_dir="`$stage_parent/$releaseId"
if [[ -e "`$stage_dir" || -L "`$stage_dir" ]]; then
    echo "Release ID is already staged." >&2
    exit 1
fi
mkdir -- "`$stage_dir"
chmod 700 -- "`$stage_dir"
printf '%s\n' "`$stage_dir"
"@
    $stageOutput = $stageScript | & $sshCommand.Source @sshOptions $remote 'bash -s'
    if ($LASTEXITCODE -ne 0 -or ($stageOutput -join '').Trim() -ne $remoteStage) {
        throw 'The remote release staging directory failed its ownership check.'
    }

    & $scpCommand.Source @sshOptions $archivePath $checksumPath $signaturePath "$remote`:$remoteStage/"
    if ($LASTEXITCODE -ne 0) {
        throw 'The signed release artifacts could not be staged over pinned SSH.'
    }
    $requestData = @{ action = $action; release_id = $releaseId }
    if ($ReleaseType -eq 'supabase-stack') {
        $requestData.backup_id = $BackupId
    }
    $request = $requestData | ConvertTo-Json -Compress
    $result = $request | & $sshCommand.Source @sshOptions $remote `
        'sudo -n /usr/local/sbin/hanouti-pos-admin-v3'
    if ($LASTEXITCODE -ne 0 -or ($result -join '').Trim() -ne "$action=completed release_id=$releaseId") {
        throw 'The VPS did not confirm the verified release activation.'
    }

    $cleanup = "rm -- '$archiveName' '$archiveName.sha256' '$archiveName.sig' && rmdir -- '$remoteStage'"
    & $sshCommand.Source @sshOptions $remote $cleanup
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'Release activated, but the non-root staging directory cleanup failed.'
    }
    Write-Output "release=$ReleaseType release_id=$releaseId"
}
finally {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
