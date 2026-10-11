<#
.SYNOPSIS
    Lists or downloads micro-sedat submissions from the private inbox repository.

.DESCRIPTION
    Uses the GitHub CLI (gh) which must be installed and authenticated on the machine.
    Downloaded submissions are stored in .\submissions\<submissionId>\ with the metadata
    saved as metadata.json.

.PARAMETER List
    List recent submission releases instead of downloading one.

.PARAMETER SubmissionId
    The submission id (uuid) to download. The release tag is "sub-<submissionId>".

.PARAMETER Repo
    Inbox repository in owner/name form. Default: WooZoZooW/micro-sedat-inbox.

.PARAMETER OutputDir
    Destination root directory. Default: .\submissions

.EXAMPLE
    .\fetch-submission.ps1 -List

.EXAMPLE
    .\fetch-submission.ps1 -SubmissionId 0f8e7d6c-1234-4abc-9def-0123456789ab
#>
param(
    [switch]$List,
    [string]$SubmissionId,
    [string]$Repo = "WooZoZooW/micro-sedat-inbox",
    [string]$OutputDir = ".\submissions"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/"
}

if ($List -or [string]::IsNullOrWhiteSpace($SubmissionId)) {
    Write-Host "Recent submissions in $Repo:"
    gh release list --repo $Repo --limit 20
    if ([string]::IsNullOrWhiteSpace($SubmissionId)) {
        Write-Host ""
        Write-Host "Re-run with -SubmissionId <uuid> to download one."
    }
    exit 0
}

$tag = "sub-$SubmissionId"
$destination = Join-Path $OutputDir $SubmissionId
New-Item -ItemType Directory -Force -Path $destination | Out-Null

Write-Host "Downloading release $tag ..."
gh release download $tag --repo $Repo --dir $destination

Write-Host "Downloading metadata ..."
$metadataPath = Join-Path $destination "metadata.json"
$apiPath = "repos/$Repo/contents/submissions/$SubmissionId.json"
gh api $apiPath -H "Accept: application/vnd.github.raw" | Set-Content -Encoding UTF8 -Path $metadataPath

Write-Host ""
Write-Host "Submission downloaded to: $destination"
Get-ChildItem $destination | Select-Object Name, Length | Format-Table -AutoSize
Write-Host "Read metadata.json for the written instructions before making changes."
