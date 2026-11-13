#!/usr/bin/env bash
# Version or publish with changesets, without changesets/action.
#
# The privacybydesign org only starts workflows whose actions are on its
# allowlist, and changesets/action is not: Delivery ended in startup_failure on
# every push to main. This script does the two things that action did.
#
#   - Changesets are pending: run `pnpm version-packages` on the branch
#     changeset-release/main, force-push it, and open or update the
#     "chore: version packages" pull request.
#   - No changesets are pending: run `pnpm release`, push the tags it created,
#     and publish a GitHub release for each one.
#
# Usage, from the repository root:
#   scripts/changesets-release.sh             the flow above (needs GITHUB_TOKEN)
#   scripts/changesets-release.sh pending     exit 0 when a changeset is pending
#   scripts/changesets-release.sh notes DIR VERSION
#                                             that version's section of DIR/CHANGELOG.md
#   scripts/changesets-release.sh tags        tags named on stdin by `changeset publish`
#   scripts/changesets-release.sh package-dir NAME
#                                             directory of the workspace package NAME
#
# The subcommands exist so scripts/changesets-release-test.sh can hold the
# parsing to fixtures; the flow itself only runs in Delivery.
set -euo pipefail

BRANCH=changeset-release/main
TITLE='chore: version packages'

pending() {
    find .changeset -maxdepth 1 -name '*.md' ! -name README.md | grep -q .
}

# The body under `## VERSION`, up to the next `## ` heading.
notes() {
    local dir=$1 version=$2
    [ -f "$dir/CHANGELOG.md" ] || return 0
    awk -v heading="## $version" '
        $0 == heading { found = 1; next }
        found && /^## / { exit }
        found { print }
    ' "$dir/CHANGELOG.md" | sed -e '/./,$!d'
}

# `changeset publish` prints one "New tag:" line for each package it published.
tags() {
    sed -n 's/.*New tag:[[:space:]]*\([^[:space:]]*\).*/\1/p'
}

package_dir() {
    local name=$1 manifest
    while IFS= read -r manifest; do
        if [ "$(node -p 'require(process.argv[1]).name' "./$manifest")" = "$name" ]; then
            dirname "$manifest"
            return 0
        fi
    done < <(git ls-files 'package.json' '*/package.json')
    return 1
}

version_pr() {
    git switch -C "$BRANCH"
    pnpm version-packages

    if [ -z "$(git status --porcelain)" ]; then
        echo 'version-packages changed nothing; no pull request to open'
        return 0
    fi

    local body manifest dir name version
    body=$(mktemp)
    {
        echo 'This pull request was opened by scripts/changesets-release.sh.'
        echo 'Merging it publishes the packages below to npm. Each changeset that'
        echo 'lands on main before then updates it.'
        echo
        echo '# Releases'
        while IFS= read -r manifest; do
            dir=$(dirname "$manifest")
            name=$(node -p 'require(process.argv[1]).name' "./$manifest")
            version=$(node -p 'require(process.argv[1]).version' "./$manifest")
            echo
            echo "## $name@$version"
            echo
            notes "$dir" "$version"
        done < <(git diff --name-only HEAD -- 'package.json' '*/package.json')
    } > "$body"

    git add -A
    git commit -m "$TITLE"
    # Force: the branch survives from the previous run, and this job owns it.
    git push --force origin "$BRANCH"

    local number
    number=$(gh pr list --head "$BRANCH" --base main --state open --json number --jq '.[0].number // empty')
    if [ -n "$number" ]; then
        gh pr edit "$number" --title "$TITLE" --body-file "$body"
    else
        gh pr create --head "$BRANCH" --base main --title "$TITLE" --body-file "$body"
    fi
}

publish() {
    local log tag name dir
    log=$(mktemp)
    pnpm release 2>&1 | tee "$log"

    while IFS= read -r tag; do
        git push origin "refs/tags/$tag"
        name=${tag%@*}
        dir=$(package_dir "$name")
        notes "$dir" "${tag##*@}" | gh release create "$tag" --title "$tag" --notes-file -
    done < <(tags < "$log")
}

case "${1:-}" in
    pending) pending ;;
    notes) notes "$2" "$3" ;;
    tags) tags ;;
    package-dir) package_dir "$2" ;;
    '')
        : "${GITHUB_TOKEN:?GITHUB_TOKEN must be set}"
        export GH_TOKEN=$GITHUB_TOKEN
        # Both flows need an identity: the version commit, and the annotated
        # tags `changeset publish` creates. Without one the tag fails while
        # publish still exits 0 and prints "New tag:", after the npm publish.
        git config user.name 'github-actions[bot]'
        git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
        if pending; then version_pr; else publish; fi
        ;;
    *)
        echo "unknown subcommand: $1" >&2
        exit 2
        ;;
esac
