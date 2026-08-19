#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$PROJECT_DIR"

DEFAULT_VERSION=$(node -p "require('./package.json').version")
RELEASE_VERSION=${RELEASE_VERSION:-$DEFAULT_VERSION}
TARGET_PLATFORM=${TARGET_PLATFORM:-linux/amd64}
IMAGE_REPOSITORY=${IMAGE_REPOSITORY:-pi-web-separated-backend}
IMAGE_NAME=${IMAGE_NAME:-$IMAGE_REPOSITORY:$RELEASE_VERSION}
OUTPUT_PATH=${OUTPUT_PATH:-$PROJECT_DIR/dist/pi-agent-backend-$RELEASE_VERSION.tar}

case "$RELEASE_VERSION" in
  ''|*[!A-Za-z0-9._-]*)
    echo "RELEASE_VERSION may contain only letters, digits, dots, underscores and hyphens" >&2
    exit 1
    ;;
esac

mkdir -p "$(dirname -- "$OUTPUT_PATH")"
docker buildx build --platform "$TARGET_PLATFORM" --load -t "$IMAGE_NAME" backend
rm -f "$OUTPUT_PATH"
docker save -o "$OUTPUT_PATH" "$IMAGE_NAME"
chmod 0644 "$OUTPUT_PATH"

printf 'Image: %s\nPlatform: %s\nArchive: %s\n' "$IMAGE_NAME" "$TARGET_PLATFORM" "$OUTPUT_PATH"
