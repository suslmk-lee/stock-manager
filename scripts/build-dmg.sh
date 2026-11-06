#!/usr/bin/env bash
# macOS 설치 파일(DMG) 만들기
# wails build 로 .app 을 만든 뒤, '응용 프로그램' 바로가기와 함께 DMG 로 묶는다.
# DMG 를 열고 Stock Manager 를 Applications 로 끌어다 놓으면 설치된다.
#
# 사용법: scripts/build-dmg.sh [--universal] [--skip-build]
#   --universal   Apple Silicon + Intel 겸용으로 빌드 (기본: 이 맥의 아키텍처)
#   --skip-build  build/bin 에 이미 있는 .app 으로 DMG 만 다시 만든다
# 결과: build/bin/StockManager-<git 버전>-<아키텍처>.dmg
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "DMG 는 macOS 에서만 만들 수 있습니다" >&2
  exit 1
fi

PLATFORM="darwin/$(uname -m | sed 's/x86_64/amd64/')"
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --universal) PLATFORM="darwin/universal" ;;
    --skip-build) SKIP_BUILD=1 ;;
    *)
      echo "알 수 없는 옵션: $arg" >&2
      exit 1
      ;;
  esac
done

# go·wails 를 PATH 에서 못 찾으면 흔한 설치 위치를 더한다
for dir in "$HOME/sdk/go/bin" "/usr/local/go/bin" "$HOME/go/bin"; do
  if [[ -d "$dir" ]]; then PATH="$PATH:$dir"; fi
done
export PATH

APP_NAME="Stock Manager"
BUILT_APP="build/bin/stock-manager.app"
VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo dev)"
ARCH="${PLATFORM#darwin/}"
DMG="build/bin/StockManager-${VERSION}-${ARCH}.dmg"

if [[ $SKIP_BUILD -eq 0 ]]; then
  if ! command -v wails >/dev/null; then
    echo "wails CLI 가 없습니다: go install github.com/wailsapp/wails/v2/cmd/wails@latest" >&2
    exit 1
  fi
  wails build -platform "$PLATFORM"
fi

if [[ ! -d "$BUILT_APP" ]]; then
  echo "$BUILT_APP 이 없습니다. --skip-build 없이 다시 실행하세요" >&2
  exit 1
fi

# 앱 정보와 서명이 정상인지 확인 (Info.plist 가 깨지면 아이콘이 안 나오고 서명이 번들이 아닌 실행 파일에만 붙는다)
# build/darwin/Info.plist 는 Wails 가 값을 채워 넣는 템플릿({{...}})이라 검사 대상이 아니다. 완성된 앱의 것을 본다.
if ! plutil -lint -s "$BUILT_APP/Contents/Info.plist" >/dev/null; then
  echo "$BUILT_APP/Contents/Info.plist 형식이 잘못됐습니다 (wails.json 의 info 값에 & 같은 XML 특수문자가 있는지 확인)" >&2
  exit 1
fi
codesign --verify --deep --strict "$BUILT_APP"

# DMG 안에 들어갈 내용: 앱(설치 후 이름 'Stock Manager') + Applications 바로가기
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$BUILT_APP" "$STAGE/$APP_NAME.app"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
echo "만들었습니다: $DMG"
