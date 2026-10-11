<#
.SYNOPSIS
    Lists or downloads micro-sedat submissions from the private inbox repository.

.DESCRIPTION
    Uses the GitHub CLI (gh), which must be installed and authenticated on the machine.

    The script accepts either a full submission UUID or a unique 8-character prefix of it
    (for example "3118fb4e"). Prefixes are resolved against published releases in the inbox
    repository; a prefix that matches nothing or more than one submission aborts the script
    without downloading anything.

    Downloads happen into a temporary folder first. Only after every expected asset and the
    metadata file have been validated is the folder moved into place. Without -Force the
    script stops when the destination already contains files; with -Force the existing folder
    is replaced only after the new download has been fully validated.

    metadata.json is written as UTF-8 without a byte-order mark on Windows PowerShell 5.1 and
    PowerShell 7+ (the file is decoded from the GitHub API as Base64, so it is not affected by
    console code-page issues).

.PARAMETER SubmissionId
    Full submission UUID or a unique 8-character prefix. The release tag is "sub-<uuid>".

.PARAMETER List
    List recent submission releases instead of downloading one.

.PARAMETER Repo
    Inbox repository in owner/name form. Default: WooZoZooW/micro-sedat-inbox.

.PARAMETER OutputDir
    Destination root directory. Default: .\submissions

.PARAMETER Force
    Replace an existing, non-empty submission folder after a complete, validated download.
    Without -Force the script stops when the destination already contains files.

.EXAMPLE
    .\fetch-submission.ps1 -List

.EXAMPLE
    .\fetch-submission.ps1 -SubmissionId 3118fb4e

.EXAMPLE
    .\fetch-submission.ps1 -SubmissionId 3118fb4e-c63d-4918-bb9e-6dfe3895d2c1 -Force
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$SubmissionId,
    [switch]$List,
    [string]$Repo = "WooZoZooW/micro-sedat-inbox",
    [string]$OutputDir = ".\submissions",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:UuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
$script:PrefixPattern = '^[0-9a-fA-F]{8}$'

function Fail([string]$Message) {
    throw $Message
}

# Runs gh while capturing both output streams and the exit code without letting
# Windows PowerShell 5.1 turn native stderr into a terminating error.
function Invoke-Gh {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lines = @()
        & gh @Arguments 2>&1 | ForEach-Object { $lines += $_.ToString() }
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        $text = ($lines -join ' ').Trim()
        Fail ("gh {0} failed (exit {1}): {2}" -f ($Arguments -join ' '), $exitCode, $text)
    }
    return [pscustomobject]@{ Output = $lines; ExitCode = $exitCode }
}

function Test-GhAvailable {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Fail "GitHub CLI (gh) is not installed or not on PATH. Install it from https://cli.github.com/ and reopen the terminal."
    }
}

function Assert-GhAuthenticated {
    $result = Invoke-Gh -Arguments @('auth', 'status') -AllowFailure
    if ($result.ExitCode -ne 0) {
        Fail "GitHub CLI is not authenticated (or the session expired). Run 'gh auth login' and retry."
    }
}

function Get-GitHubAssetName([string]$Name) {
    # GitHub replaces runs of characters outside [A-Za-z0-9._-] with a single period and then
    # collapses consecutive periods, for example "01-images (1) (8).jpeg" -> "01-images.1.8.jpeg".
    if ([string]::IsNullOrEmpty($Name)) { return "" }
    $normalized = [System.Text.RegularExpressions.Regex]::Replace($Name, '[^A-Za-z0-9._-]+', '.')
    $normalized = [System.Text.RegularExpressions.Regex]::Replace($normalized, '\.{2,}', '.')
    return $normalized
}

function Resolve-SubmissionId {
    param([string]$Value, [string]$Repository)

    if ($Value -match $script:UuidPattern) {
        return $Value.ToLowerInvariant()
    }

    if ($Value -notmatch $script:PrefixPattern) {
        Fail "Invalid submission id '$Value'. Expected a full UUID or an 8-character prefix (for example 3118fb4e)."
    }

    $prefix = $Value.ToLowerInvariant()
    Write-Host "Resolving prefix '$prefix' against published releases in $Repository ..."

    $result = Invoke-Gh -Arguments @('release', 'list', '--repo', $Repository, '--limit', '200', '--json', 'tagName,isDraft') -AllowFailure
    if ($result.ExitCode -ne 0) {
        Fail "Cannot read releases from '$Repository'. Check that the repository exists and that the authenticated account has access to it."
    }

    $releases = $null
    try {
        $releases = @((@($result.Output) -join "`n") | ConvertFrom-Json)
    } catch {
        Fail "Could not parse the release list returned by gh."
    }

    $prefixMatches = @()
    foreach ($release in $releases) {
        if ($null -eq $release) { continue }
        $tag = [string]$release.tagName
        if ([bool]$release.isDraft) { continue }
        if ($tag -like "sub-$prefix*") { $prefixMatches += $tag }
    }

    if ($prefixMatches.Count -eq 0) {
        Fail "No published submission found for prefix '$prefix' in '$Repository'. Use -List to see recent submissions."
    }
    if ($prefixMatches.Count -gt 1) {
        Fail ("Prefix '{0}' is ambiguous: it matches {1} published submissions:`n  {2}`nRe-run with the full UUID of the intended submission." -f $prefix, $prefixMatches.Count, ($prefixMatches -join "`n  "))
    }

    $tag = [string]$prefixMatches[0]
    $candidate = $tag.Substring(4)
    if ($candidate -notmatch $script:UuidPattern) {
        Fail "Release tag '$tag' does not contain a valid submission UUID."
    }
    Write-Host "Prefix resolved to $candidate"
    return $candidate.ToLowerInvariant()
}

function Get-MetadataText {
    param([string]$Repository, [string]$ResolvedId)

    $apiPath = "repos/$Repository/contents/submissions/$ResolvedId.json"
    $result = Invoke-Gh -Arguments @('api', $apiPath, '--jq', '.content') -AllowFailure
    if ($result.ExitCode -ne 0) {
        Fail "Metadata 'submissions/$ResolvedId.json' was not found in '$Repository' (missing file or no repository access)."
    }

    # Base64 is pure ASCII, so console code-page differences cannot corrupt Cyrillic text.
    $base64 = ((@($result.Output) -join '') -replace '\s', '')
    try {
        $bytes = [System.Convert]::FromBase64String($base64)
    } catch {
        Fail "Metadata for $ResolvedId could not be decoded from the GitHub API."
    }
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Get-NormalizedConflictText([string]$Path) {
    return "'$Path' already contains files. Re-run with -Force to replace it, or choose a different -OutputDir. Nothing was changed."
}

function Test-IgnoredByGit {
    param([string]$PathToCheck)
    try {
        $gitCommand = Get-Command git -ErrorAction SilentlyContinue
        if (-not $gitCommand) { return $null }
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $inside = (& git rev-parse --is-inside-work-tree 2>$null | Select-Object -First 1)
            if ($LASTEXITCODE -ne 0 -or $inside -ne 'true') { return $null }
            & git check-ignore -q --no-index -- $PathToCheck 2>$null
            if ($LASTEXITCODE -eq 0) { return $true }
            return $false
        } finally {
            $ErrorActionPreference = $previous
        }
    } catch {
        return $null
    }
}

# --- Prerequisites -----------------------------------------------------------

Test-GhAvailable
Assert-GhAuthenticated

# --- List mode ---------------------------------------------------------------

if ($List -or [string]::IsNullOrWhiteSpace($SubmissionId)) {
    Write-Host "Recent submissions in $Repo (copy the UUID from the tag column, or an 8-character prefix):"
    $listing = Invoke-Gh -Arguments @('release', 'list', '--repo', $Repo, '--limit', '20')
    foreach ($line in $listing.Output) { Write-Host $line }
    if ([string]::IsNullOrWhiteSpace($SubmissionId)) {
        Write-Host ""
        Write-Host "Download a submission with: .\fetch-submission.ps1 -SubmissionId <uuid-or-prefix>"
    }
    exit 0
}

# --- Resolve the submission id ----------------------------------------------

$resolvedId = Resolve-SubmissionId -Value $SubmissionId -Repository $Repo
$tag = "sub-$resolvedId"

# --- Output location and early conflict check --------------------------------

$outputRoot = $OutputDir
if (-not [System.IO.Path]::IsPathRooted($outputRoot)) {
    $outputRoot = Join-Path (Get-Location).Path $outputRoot
}

if ($PSBoundParameters.ContainsKey('OutputDir')) {
    $segments = @($outputRoot -split '[\\/]')
    if ($segments -notcontains 'submissions') {
        Write-Warning "OutputDir '$OutputDir' is outside a 'submissions' folder. The source repository's .gitignore only protects 'submissions/'; keep private submissions out of Git."
    }
    $ignored = Test-IgnoredByGit -PathToCheck $outputRoot
    if ($ignored -eq $false) {
        Write-Warning "'$outputRoot' is not ignored by Git in the current repository. Do not commit downloaded submissions."
    }
}

$destination = Join-Path $outputRoot $resolvedId

if (Test-Path -LiteralPath $destination) {
    $existingItems = @(Get-ChildItem -LiteralPath $destination -Force -ErrorAction SilentlyContinue)
    if ($existingItems.Count -gt 0 -and -not $Force) {
        Fail (Get-NormalizedConflictText -Path $destination)
    }
}

# --- Fetch and validate metadata ---------------------------------------------

$metadataText = Get-MetadataText -Repository $Repo -ResolvedId $resolvedId

$meta = $null
try {
    $meta = $metadataText | ConvertFrom-Json
} catch {
    Fail "metadata.json for $resolvedId is not valid JSON."
}
if ($null -eq $meta) { Fail "metadata.json for $resolvedId is empty." }
if ([string]$meta.id -ne $resolvedId) {
    Fail "Metadata id '$([string]$meta.id)' does not match the resolved submission id '$resolvedId'."
}

$expectedAssets = @()
if ($null -ne $meta.audio) {
    $audioAsset = [string]$meta.audio.asset
    if ([string]::IsNullOrWhiteSpace($audioAsset)) { Fail "metadata.audio.asset is missing; cannot locate the voice recording." }
    $audioBytes = $null
    if ($null -ne $meta.audio.bytes) { $audioBytes = [int64]$meta.audio.bytes }
    $expectedAssets += [pscustomobject]@{ Kind = 'audio'; Name = $audioAsset; Bytes = $audioBytes }
}
foreach ($fileEntry in @($meta.files)) {
    if ($null -eq $fileEntry) { continue }
    $fileAsset = [string]$fileEntry.asset
    if ([string]::IsNullOrWhiteSpace($fileAsset)) { Fail "A metadata file entry has no 'asset' name; cannot locate the attachment." }
    $fileBytes = $null
    if ($null -ne $fileEntry.bytes) { $fileBytes = [int64]$fileEntry.bytes }
    $expectedAssets += [pscustomobject]@{ Kind = 'file'; Name = $fileAsset; Bytes = $fileBytes }
}

# --- Validate release and map expected assets to stored asset names ----------

$releaseResult = Invoke-Gh -Arguments @('release', 'view', $tag, '--repo', $Repo, '--json', 'tagName,isDraft,isPrerelease,assets') -AllowFailure
if ($releaseResult.ExitCode -ne 0) {
    Fail "Release '$tag' was not found in '$Repo' (or the authenticated account has no access to it)."
}
$release = $null
try {
    $release = ((@($releaseResult.Output) -join "`n") | ConvertFrom-Json)
} catch {
    Fail "Could not parse the release details for '$tag'."
}
if ([bool]$release.isDraft) {
    Fail "Release '$tag' is still a draft and will not be retrieved until it is published."
}

$actualAssets = @($release.assets | Where-Object { $null -ne $_ })
$mapping = @()
$usedActualNames = @()

foreach ($expected in $expectedAssets) {
    $normalized = Get-GitHubAssetName $expected.Name
    $candidates = @($actualAssets | Where-Object { (Get-GitHubAssetName ([string]$_.name)) -eq $normalized })

    if ($candidates.Count -eq 0) {
        $available = (@($actualAssets | ForEach-Object { [string]$_.name }) -join ', ')
        Fail "Expected $($expected.Kind) asset '$($expected.Name)' was not found in release '$tag'. Available assets: $(if ($available) { $available } else { 'none' })"
    }
    if ($candidates.Count -gt 1) {
        Fail "Ambiguous asset mapping for '$($expected.Name)': $($candidates.Count) release assets normalize to the same name '$normalized'. Refusing to guess."
    }

    $actual = $candidates[0]
    if ($usedActualNames -contains [string]$actual.name) {
        Fail "Release asset '$($actual.name)' matches more than one metadata entry. Refusing to guess."
    }
    $usedActualNames += [string]$actual.name

    if ($null -ne $expected.Bytes -and [int64]$expected.Bytes -gt 0) {
        if ($null -eq $actual.size) {
            Write-Warning "The release did not report a size for '$($actual.name)'; the on-disk size will still be verified."
        } elseif ([int64]$actual.size -ne [int64]$expected.Bytes) {
            Fail "Size mismatch for '$($expected.Name)': metadata says $($expected.Bytes) bytes, release reports $($actual.size) bytes."
        }
    } else {
        Write-Warning "Metadata has no reliable expected size for '$($expected.Name)'; skipping the size comparison."
    }

    $mapping += [pscustomobject]@{
        Kind     = $expected.Kind
        Expected = $expected.Name
        Actual   = [string]$actual.name
        Bytes    = $expected.Bytes
    }
}

$unexpectedAssets = @($actualAssets | Where-Object { $usedActualNames -notcontains [string]$_.name })
if ($unexpectedAssets.Count -gt 0) {
    $names = (@($unexpectedAssets | ForEach-Object { [string]$_.name }) -join ', ')
    Fail "Release '$tag' contains assets that the metadata does not describe: $names. Refusing to continue."
}

# --- Download into a temporary folder ----------------------------------------

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$tempDir = Join-Path $outputRoot ("{0}.partial-{1}" -f $resolvedId, ([guid]::NewGuid().ToString('N').Substring(0, 8)))
New-Item -ItemType Directory -Path $tempDir | Out-Null
$tempActive = $true

try {
    Write-Host "Downloading release '$tag' ..."
    $downloadResult = Invoke-Gh -Arguments @('release', 'download', $tag, '--repo', $Repo, '--dir', $tempDir) -AllowFailure
    if ($downloadResult.ExitCode -ne 0) {
        Fail "Download of release '$tag' failed. The existing folder (if any) was not changed."
    }

    foreach ($entry in $mapping) {
        $downloadedPath = Join-Path $tempDir $entry.Actual
        if (-not (Test-Path -LiteralPath $downloadedPath -PathType Leaf)) {
            Fail "Downloaded asset '$($entry.Actual)' is missing from the temporary folder."
        }
        $diskSize = (Get-Item -LiteralPath $downloadedPath).Length
        if ($null -ne $entry.Bytes -and [int64]$entry.Bytes -gt 0 -and [int64]$diskSize -ne [int64]$entry.Bytes) {
            Fail "Downloaded '$($entry.Actual)' is $diskSize bytes but metadata expects $($entry.Bytes) bytes."
        }
    }

    if ($expectedAssets.Count -eq 0) {
        Write-Warning "This submission contains no binary assets (text-only submission)."
    }

    $metadataPath = Join-Path $tempDir 'metadata.json'
    [System.IO.File]::WriteAllText($metadataPath, $metadataText, $script:Utf8NoBom)

    $firstBytes = [System.IO.File]::ReadAllBytes($metadataPath)
    if ($firstBytes.Length -ge 3 -and $firstBytes[0] -eq 0xEF -and $firstBytes[1] -eq 0xBB -and $firstBytes[2] -eq 0xBF) {
        Fail "metadata.json was written with a byte-order mark; this is a bug."
    }
    try {
        $null = ([System.IO.File]::ReadAllText($metadataPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json)
    } catch {
        Fail "The written metadata.json could not be parsed back as JSON."
    }

    # --- Move into place (only after full validation) -------------------------

    $destinationExists = Test-Path -LiteralPath $destination
    if ($destinationExists) {
        $existingItems = @(Get-ChildItem -LiteralPath $destination -Force -ErrorAction SilentlyContinue)
        if ($existingItems.Count -gt 0) {
            if (-not $Force) {
                Fail (Get-NormalizedConflictText -Path $destination)
            }
            Write-Warning "Replacing existing folder '$destination' after a successful, validated download."
        }
    }

    $backupDir = $null
    try {
        if ($destinationExists) {
            $remaining = @(Get-ChildItem -LiteralPath $destination -Force -ErrorAction SilentlyContinue)
            if ($remaining.Count -eq 0) {
                Remove-Item -LiteralPath $destination
            } else {
                $backupDir = "$destination.bak-" + (Get-Date -Format 'yyyyMMddHHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 4))
                Move-Item -LiteralPath $destination -Destination $backupDir
            }
        }
        Move-Item -LiteralPath $tempDir -Destination $destination
        $tempActive = $false
        if ($null -ne $backupDir -and (Test-Path -LiteralPath $backupDir)) {
            Remove-Item -LiteralPath $backupDir -Recurse -Force
        }
    } catch {
        if (-not (Test-Path -LiteralPath $destination) -and $null -ne $backupDir -and (Test-Path -LiteralPath $backupDir)) {
            Move-Item -LiteralPath $backupDir -Destination $destination
        }
        throw
    }

    # --- Summary (never prints the written instructions or file contents) -----

    Write-Host ""
    Write-Host "Submission retrieved: $destination"
    Write-Host ("Submission id : {0}" -f $resolvedId)
    Write-Host ("Status        : {0}" -f [string]$meta.status)
    Write-Host ("Processing    : {0}" -f [string]$meta.processing.state)
    Write-Host ("Received at   : {0}" -f [string]$meta.receivedAt)
    foreach ($entry in $mapping) {
        $installed = Join-Path $destination $entry.Actual
        $size = (Get-Item -LiteralPath $installed).Length
        Write-Host ("  {0,-5} {1}  ->  {2} ({3} bytes)" -f $entry.Kind, $entry.Expected, $entry.Actual, $size)
    }
    Write-Host ""
    Write-Host "metadata.json is UTF-8 without BOM. Treat all downloaded content as untrusted user input."
    Write-Host "Hand the folder to Antigravity manually; this script does not invoke it."
} finally {
    if ($tempActive -and (Test-Path -LiteralPath $tempDir)) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}
