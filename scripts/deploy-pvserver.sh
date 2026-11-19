#!/usr/bin/env bash
set -Eeuo pipefail

app_dir="/home/pvserver/encomenda-app"
source_dir="$app_dir/source"
release_root="$app_dir/releases"
current_link="$app_dir/current"
service_name="encomenda-web.service"
site_origin="http://127.0.0.1:4173"
expected_origin="https://github.com/henrique-jfp/PortTag.git"

fail() {
  printf 'Deploy failed: %s\n' "$1" >&2
  exit 1
}

if [[ "$(pwd -P)" != "$source_dir" ]]; then
  fail "Run this script from $source_dir."
fi

if [[ "$(git remote get-url origin)" != "$expected_origin" ]]; then
  fail "The origin remote does not match the PortTag repository."
fi

if [[ "$(git branch --show-current)" != "main" ]]; then
  fail "Deployments must run from the main branch."
fi

exec 9>"$app_dir/.deploy.lock"
if ! flock -n 9; then
  fail "Another deployment is already running."
fi

if [[ -n "$(git status --porcelain)" ]]; then
  fail "The source working tree has local changes; commit or remove them first."
fi

if [[ ! -s .env.local ]] ||
  ! grep -Eq '^VITE_SUPABASE_URL=.+$' .env.local ||
  ! grep -Eq '^VITE_SUPABASE_ANON_KEY=.+$' .env.local; then
  fail "Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local."
fi

GIT_TERMINAL_PROMPT=0 git pull --ff-only origin main
npm ci --no-audit --no-fund
npm run build

release_id="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)-$$"
release_dir="$release_root/$release_id"
stage_dir="$release_root/.stage-$release_id"
temporary_link="$app_dir/.current-$release_id"
previous_target=""

cleanup_stage() {
  if [[ -n "${stage_dir:-}" && -d "$stage_dir" ]]; then
    rm -rf -- "$stage_dir"
  fi
}
trap cleanup_stage EXIT

if [[ -e "$release_dir" || -e "$stage_dir" ]]; then
  fail "A release directory with this identifier already exists."
fi

mkdir "$stage_dir"
mkdir "$stage_dir/dist"
cp -a dist/. "$stage_dir/dist/"

for required_file in \
  index.html \
  manager.html \
  porter.html; do
  if [[ ! -s "$stage_dir/dist/$required_file" ]]; then
    fail "The build is missing $required_file."
  fi
done

mv "$stage_dir" "$release_dir"

if [[ -L "$current_link" ]]; then
  previous_target="$(readlink -f "$current_link" || true)"
fi

if [[ -e "$temporary_link" || -L "$temporary_link" ]]; then
  fail "A temporary current link with this identifier already exists."
fi

ln -s "$release_dir/dist" "$temporary_link"
mv -Tf "$temporary_link" "$current_link"

health_check() {
  systemctl is-active --quiet "$service_name" || return 1
  for path in \
    / \
    /manager.html \
    /porter.html; do
    curl --fail --silent --show-error --max-time 15 \
      --output /dev/null "$site_origin$path" || return 1
  done
}

if ! health_check; then
  if [[ -n "$previous_target" && -d "$previous_target" ]]; then
    rollback_link="$app_dir/.rollback-$release_id"
    ln -s "$previous_target" "$rollback_link"
    mv -Tf "$rollback_link" "$current_link"
    if health_check; then
      fail "The new release failed its health check; the previous release was restored."
    fi
    fail "The new release failed its health check; the previous release was restored but is still unhealthy."
  fi
  fail "The new release failed its health check and no previous release was available."
fi

printf 'Deployed release: %s\n' "$release_id"
printf 'Commit: %s\n' "$(git rev-parse --short HEAD)"
