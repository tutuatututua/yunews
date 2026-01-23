param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
)

$ErrorActionPreference = "Stop"

# Work around Docker BuildKit issues on Windows when the repo is inside OneDrive.
# BuildKit rejects OneDrive cloud/reparse-point files with: "invalid file request ...".
$env:DOCKER_BUILDKIT = "0"
$env:COMPOSE_DOCKER_CLI_BUILD = "1"

if (-not $Args -or $Args.Count -eq 0) {
    docker compose up --build
    exit $LASTEXITCODE
}

docker compose @Args
exit $LASTEXITCODE
