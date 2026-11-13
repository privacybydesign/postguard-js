#!/usr/bin/env bash
# Tests for the parsing in scripts/changesets-release.sh. Run from the
# repository root: `scripts/changesets-release-test.sh`.
set -euo pipefail

script=$(cd "$(dirname "$0")" && pwd)/changesets-release.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failures=0

check() {
    local name=$1 expected=$2 actual=$3
    if [ "$expected" = "$actual" ]; then
        echo "ok   $name"
    else
        echo "FAIL $name"
        echo "  expected: $(printf '%q' "$expected")"
        echo "  actual:   $(printf '%q' "$actual")"
        failures=$((failures + 1))
    fi
}

status() {
    local code=0
    "$@" > /dev/null 2>&1 || code=$?
    echo "$code"
}

# pending
mkdir -p "$work/none/.changeset" "$work/some/.changeset"
touch "$work/none/.changeset/README.md" "$work/none/.changeset/config.json"
touch "$work/some/.changeset/README.md" "$work/some/.changeset/brave-owls-sing.md"
check 'README.md and config.json alone are not a pending changeset' 1 \
    "$(cd "$work/none" && status "$script" pending)"
check 'a changeset file is pending' 0 \
    "$(cd "$work/some" && status "$script" pending)"

# notes
mkdir -p "$work/pkg"
cat > "$work/pkg/CHANGELOG.md" <<'CHANGELOG'
# @e4a/pg-js

## 2.6.0

### Minor Changes

- ecb9411: Route Cryptify-only headers to Cryptify.

## 2.5.0

### Patch Changes

- d0d3034: Answer the upload challenge.

## 2.5.0-rc.1

- an earlier entry
CHANGELOG
check 'notes returns the section of the newest version' \
    $'### Minor Changes\n\n- ecb9411: Route Cryptify-only headers to Cryptify.' \
    "$("$script" notes "$work/pkg" 2.6.0)"
check 'notes stops at the next version heading' \
    $'### Patch Changes\n\n- d0d3034: Answer the upload challenge.' \
    "$("$script" notes "$work/pkg" 2.5.0)"
check 'notes matches the whole heading, not a prefix of it' \
    '- an earlier entry' \
    "$("$script" notes "$work/pkg" 2.5.0-rc.1)"
check 'notes is empty for a version the changelog does not have' '' \
    "$("$script" notes "$work/pkg" 9.9.9)"
check 'notes is empty when there is no changelog' '' \
    "$("$script" notes "$work" 2.6.0)"

# tags
publish_log=$'🦋  info npm info @e4a/pg-js\n🦋  success packages published successfully:\n🦋  @e4a/pg-js@2.6.0\n🦋  Creating git tag...\n🦋  New tag:  @e4a/pg-js@2.6.0\n🦋  New tag:  other-pkg@1.0.1'
check 'tags lists every tag changeset publish created' \
    $'@e4a/pg-js@2.6.0\nother-pkg@1.0.1' \
    "$(printf '%s\n' "$publish_log" | "$script" tags)"
check 'tags is empty when nothing was published' '' \
    "$(printf '%s\n' '🦋  warn No unpublished projects to publish' | "$script" tags)"

# package-dir
check 'package-dir finds the published SDK' packages/pg-js \
    "$("$script" package-dir @e4a/pg-js)"
check 'package-dir fails for a package this workspace does not have' 1 \
    "$(status "$script" package-dir no-such-package)"

check 'an unknown subcommand is a usage error' 2 "$(status "$script" bogus)"

if [ "$failures" -ne 0 ]; then
    echo "$failures test(s) failed"
    exit 1
fi
echo 'all tests passed'
