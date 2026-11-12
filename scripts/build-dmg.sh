#!/usr/bin/env bash
# macOS 설치 파일(DMG) 만들기
# wails build 로 .app 을 만든 뒤, '응용 프로그램' 바로가기와 함께 DMG 로 묶는다.
# DMG 를 열고 Stock Manager 를 Applications 로 끌어다 놓으면 설치된다.
#
# 사용법: scripts/build-dmg.sh [--universal] [--skip-build]
#   --universal   Apple Silicon + Intel 겸용으로 빌드 (기본: 이 맥의 아키텍처)
#   --skip-build  build/bin 에 이미 있는 .app 으로 DMG 만 다시 만든다
# 결과: build/bin/StockManager-<버전>-<아키텍처>.dmg
#
# 버전은 git describe (예: v1.2.0, 태그 뒤 개발 빌드면 v1.2.0-3-gabc1234). APP_VERSION 환경 변수로 바꿀 수 있다.
# 이 버전이 앱(사이드바 표시·업데이트 확인)에 그대로 들어가므로, 업데이트 확인이 되는 빌드는 이 스크립트로 만든다.
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
VERSION="${APP_VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}"
export APP_VERSION="$VERSION" # 프론트엔드 빌드(vite.config.ts)도 같은 버전을 쓴다
ARCH="${PLATFORM#darwin/}"
DMG="build/bin/StockManager-${VERSION}-${ARCH}.dmg"

if [[ $SKIP_BUILD -eq 0 ]]; then
  if ! command -v wails >/dev/null; then
    echo "wails CLI 가 없습니다: go install github.com/wailsapp/wails/v2/cmd/wails@latest" >&2
    exit 1
  fi
  wails build -platform "$PLATFORM" -ldflags "-X main.appVersion=${VERSION}"
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
# GitHub 의 macOS 러너에서는 hdiutil 이 가끔 'Resource busy' 로 실패한다 → 잠깐 쉬었다가 몇 번 다시 시도
for attempt in 1 2 3 4 5; do
  if hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null; then
    break
  fi
  if [[ $attempt -eq 5 ]]; then
    echo "DMG 를 만들지 못했습니다 (hdiutil create 5번 실패)" >&2
    exit 1
  fi
  echo "hdiutil create 실패 — $((attempt * 10))초 뒤 다시 시도 ($attempt/5)" >&2
  rm -f "$DMG"
  sleep $((attempt * 10))
done
echo "만들었습니다: $DMG"
