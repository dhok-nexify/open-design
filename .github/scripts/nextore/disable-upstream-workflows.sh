#!/usr/bin/env bash
# Disable the upstream OpenDesign workflows in this repository (NXD-D37).
#
# The NexTore fork keeps the upstream workflow files for reference and for the
# eventual upstream merge, but the fork's CI is .github/workflows/nextore-ci.yml.
# Editing dozens of workflow files would change their semantics and trip the
# upstream topology checks, so the switch lives in repository settings instead.
#
# Dry run (default) prints what would change. Pass --apply to disable.
#
# Requires: gh CLI authenticated with admin rights on the repository.
set -euo pipefail

KEEP=("nextore-ci.yml")

apply=0
for arg in "$@"; do
  case "$arg" in
    --apply) apply=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"
repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"

shopt -s nullglob
for path in .github/workflows/*.yml; do
  name="$(basename "$path")"
  keep=0
  for kept in "${KEEP[@]}"; do
    if [ "$name" = "$kept" ]; then keep=1; fi
  done
  if [ "$keep" -eq 1 ]; then
    echo "keep          $name"
    continue
  fi
  if [ "$apply" -eq 1 ]; then
    gh workflow disable "$name" --repo "$repo"
    echo "disabled      $name"
  else
    echo "would disable $name"
  fi
done
