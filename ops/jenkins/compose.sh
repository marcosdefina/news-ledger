#!/usr/bin/env bash
set -euo pipefail

: "${WORKSPACE:?WORKSPACE is required}"
: "${JENKINS_CONTROLLER_CONTAINER:?JENKINS_CONTROLLER_CONTAINER is required}"
: "${COMPOSE_HELPER_IMAGE:?COMPOSE_HELPER_IMAGE is required}"

exec docker run --rm \
  --volumes-from "$JENKINS_CONTROLLER_CONTAINER" \
  -e IMAGE_REF \
  -w "$WORKSPACE" \
  "$COMPOSE_HELPER_IMAGE" \
  docker compose "$@"
