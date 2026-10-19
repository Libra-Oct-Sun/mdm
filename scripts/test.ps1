param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

function Assert-Success([string]$label) {
    if ($LASTEXITCODE -ne 0) {
        throw "$label failed with exit code $LASTEXITCODE."
    }
}

try {
    $env:GOCACHE = Join-Path $root ".gocache"
    $env:GOMODCACHE = Join-Path $root ".gomodcache"

    $goFiles = @(git ls-files -- "*.go")
    if (-not $goFiles) {
        throw "No Go source files found."
    }
    $unformatted = @(gofmt -l $goFiles)
    if ($unformatted) {
        throw "Go files need formatting:`n$($unformatted -join "`n")"
    }

    go vet ./...
    Assert-Success "go vet"
    go test ./...
    Assert-Success "go test"
    node --check frontend/src/markdown-serializer.js
    Assert-Success "markdown serializer syntax check"
    node --check frontend/src/main.js
    Assert-Success "editor syntax check"
    npm ci --prefix tests
    Assert-Success "npm ci"
    npm test --prefix tests
    Assert-Success "frontend tests"

    if (-not $SkipBuild) {
        wails build -clean -skipbindings
        Assert-Success "wails build"
    }
}
finally {
    Pop-Location
}
