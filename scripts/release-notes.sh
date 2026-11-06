#!/bin/bash
# 릴리스 본문(앱 업데이트 창의 '바뀐 점')을 커밋 제목으로 만든다.
#   scripts/release-notes.sh v1.2.3 [버전 수=5]
#
# 지정한 태그부터 이전 버전까지 최근 N개 버전을 "## vX.Y.Z · 날짜" 단락으로 나눠 쓴다.
# 여러 버전을 건너뛰고 업데이트하는 사람도 그동안 바뀐 점을 모두 볼 수 있게 하기 위함이며,
# 앱의 업데이트 창은 지금 버전보다 새 버전의 단락만 골라 보여 준다.
# 커밋 제목의 feat:/fix: 접두어로 '새 기능'/'고친 점'/'그 밖의 변경'으로 나눈다 (macOS 기본 bash 3.2 호환).
set -euo pipefail

TAG="${1:?사용법: scripts/release-notes.sh <태그> [버전 수]}"
COUNT="${2:-5}"

git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null || { echo "태그가 없습니다: ${TAG}" >&2; exit 1; }

# TAG 와 그보다 오래된 버전 태그 (새 버전부터)
TAGS=()
found=0
while IFS= read -r t; do
  [ "$t" = "$TAG" ] && found=1
  [ "$found" = 1 ] && TAGS+=("$t")
done < <(git tag --list 'v*.*.*' --sort=-v:refname)

MAX_ITEMS=12 # 한 묶음에 보이는 최대 항목 수 (최신 순, 나머지는 '외 N건')

strip_prefix() { sed -E 's/^[a-zA-Z]+(\([^)]*\))?!?:[[:space:]]*//'; }

# 묶음 출력: 제목, 항목들(줄바꿈 구분), 전체 개수
section() {
  [ "$3" -eq 0 ] && return
  printf '\n### %s\n%s' "$1" "$2"
  [ "$3" -gt "$MAX_ITEMS" ] && printf -- '- 외 %d건\n' $(($3 - MAX_ITEMS))
  return 0
}

i=0
while [ "$i" -lt "${#TAGS[@]}" ] && [ "$i" -lt "$COUNT" ]; do
  cur="${TAGS[$i]}"
  prev="${TAGS[$((i + 1))]:-}"
  range="$cur"
  [ -n "$prev" ] && range="${prev}..${cur}"

  feat="" fix="" other=""
  nf=0 nx=0 no=0
  while IFS= read -r s; do
    [ -z "$s" ] && continue
    line="- $(printf '%s' "$s" | strip_prefix)"$'\n'
    case "$s" in
      feat:* | feat\(*) nf=$((nf + 1)); [ "$nf" -le "$MAX_ITEMS" ] && feat+="$line" ;;
      fix:* | fix\(*) nx=$((nx + 1)); [ "$nx" -le "$MAX_ITEMS" ] && fix+="$line" ;;
      *) no=$((no + 1)); [ "$no" -le "$MAX_ITEMS" ] && other+="$line" ;;
    esac
  done < <(git log --no-merges --format='%s' "$range")

  [ "$i" -gt 0 ] && echo
  echo "## ${cur} · $(git log -1 --format=%cs "$cur")"
  section '새 기능' "$feat" "$nf"
  section '고친 점' "$fix" "$nx"
  section '그 밖의 변경' "$other" "$no"
  [ $((nf + nx + no)) -eq 0 ] && printf '\n- 내부 정리\n'
  i=$((i + 1))
done
