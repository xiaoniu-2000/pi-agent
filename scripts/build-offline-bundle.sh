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
BUNDLE_DIR="$PROJECT_DIR/dist/install-$RELEASE_VERSION"
ARCHIVE_PATH="$PROJECT_DIR/dist/pi-agent-install-$RELEASE_VERSION.tar.gz"
BACKEND_TAR_NAME="pi-agent-backend-$RELEASE_VERSION.tar"

case "$RELEASE_VERSION" in
  ''|*[!A-Za-z0-9._-]*)
    echo "RELEASE_VERSION may contain only letters, digits, dots, underscores and hyphens" >&2
    exit 1
    ;;
esac

if [ -n "${PI_WEB_API_BASE_URL:-}" ]; then
  PI_WEB_API_BASE_URL="$PI_WEB_API_BASE_URL" npm run build:war -w frontend
else
  npm run build:war -w frontend
fi
docker buildx build --platform "$TARGET_PLATFORM" --load -t "$IMAGE_NAME" backend

rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/runtime/pi-agent" \
  "$BUNDLE_DIR/runtime/user-data" \
  "$BUNDLE_DIR/extensions/python_sandbox"

docker save -o "$BUNDLE_DIR/$BACKEND_TAR_NAME" "$IMAGE_NAME"
chmod 0644 "$BUNDLE_DIR/$BACKEND_TAR_NAME"
cp frontend/dist/ROOT.war "$BUNDLE_DIR/ROOT.war"
cp compose.offline.yaml "$BUNDLE_DIR/compose.yaml"
awk -v image="$IMAGE_NAME" '
  /^PI_WEB_BACKEND_IMAGE=/ { print "PI_WEB_BACKEND_IMAGE=" image; next }
  { print }
' .env.example > "$BUNDLE_DIR/.env.example"
cp deploy/run-backend.sh "$BUNDLE_DIR/run-backend.sh"
cp extensions/python_sandbox/README.md "$BUNDLE_DIR/extensions/python_sandbox/README.md"
cp runtime/pi-agent/README.md "$BUNDLE_DIR/runtime/pi-agent/README.md"
cp runtime/user-data/README.md "$BUNDLE_DIR/runtime/user-data/README.md"
cp deploy/DEPLOY.txt "$BUNDLE_DIR/DEPLOY.txt"

rm -f "$ARCHIVE_PATH"
tar -czf "$ARCHIVE_PATH" -C "$BUNDLE_DIR" .
echo "$ARCHIVE_PATH"
