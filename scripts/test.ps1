param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

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
    go test ./...
    node --check frontend/src/markdown-serializer.js
    node --check frontend/src/main.js
    npm ci --prefix tests
    npm test --prefix tests

    if (-not $SkipBuild) {
        wails build -clean -skipbindings
    }
}
finally {
    Pop-Location
}
