#!/usr/bin/env bash
#
# 아이디어 브랜치와 폴더를 한 번에 만든다.
#
#   scripts/new-idea.sh <slug> ["아이디어 제목"]
#   예: scripts/new-idea.sh breakwater-guard "방파제 보행자 위험 경보 에이전트"
#
# main 에서 idea/NNN-<slug> 브랜치를 파고 ideas/NNN-<slug>/ 에 템플릿을 복사한다.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

slug="${1:-}"
title="${2:-}"

if [[ -z "$slug" ]]; then
	echo "사용법: scripts/new-idea.sh <slug> [\"아이디어 제목\"]" >&2
	echo "  예:   scripts/new-idea.sh breakwater-guard \"방파제 보행자 위험 경보 에이전트\"" >&2
	exit 1
fi

if [[ ! "$slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
	echo "slug 는 영문 소문자, 숫자, 하이픈만 쓴다: $slug" >&2
	exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
	echo "커밋되지 않은 변경이 있다. 먼저 정리하고 다시 실행할 것:" >&2
	git status --short >&2
	exit 1
fi

# 다음 번호 = 기존 ideas/NNN-* 중 최대값 + 1
next=1
for d in ideas/[0-9][0-9][0-9]-*/; do
	[[ -d "$d" ]] || continue
	n=$(basename "$d")
	n=${n%%-*}
	# 10진수로 강제 (008 같은 값이 8진수로 해석되지 않도록)
	(( 10#$n >= next )) && next=$((10#$n + 1))
done
num=$(printf "%03d" "$next")

dir="ideas/${num}-${slug}"
branch="idea/${num}-${slug}"
[[ -n "$title" ]] || title="$slug"

if git show-ref --verify --quiet "refs/heads/${branch}"; then
	echo "브랜치가 이미 있다: ${branch}" >&2
	exit 1
fi

if ! git show-ref --verify --quiet refs/heads/main; then
	echo "main 브랜치가 없다. 레포 상태를 확인할 것." >&2
	exit 1
fi

git switch main
git switch -c "$branch"

cp -R ideas/_template "$dir"

# 치환값은 환경변수로 넘긴다. 제목에 슬래시나 따옴표가 들어가도 안전하다.
for f in "$dir/README.md" "$dir/data.md"; do
	IDEA_TITLE="$title" IDEA_NUM="$num" IDEA_BRANCH="$branch" IDEA_DATE="$(date +%Y-%m-%d)" \
		perl -pi -e '
			s/\{\{TITLE\}\}/$ENV{IDEA_TITLE}/g;
			s/\{\{NUM\}\}/$ENV{IDEA_NUM}/g;
			s/\{\{BRANCH\}\}/$ENV{IDEA_BRANCH}/g;
			s/\{\{DATE\}\}/$ENV{IDEA_DATE}/g;
		' "$f"
done

echo
echo "생성 완료"
echo "  브랜치: $branch"
echo "  폴더:   $dir/"
echo
echo "다음 할 일"
echo "  1. $dir/README.md 를 채운다"
echo "  2. 쓸 API 를 docs/api-catalog/README.md 에서 고르고 $dir/data.md 에 호출 결과를 남긴다"
echo "  3. git add $dir && git commit && git push -u origin $branch"
echo "  4. ideas/README.md 목록 표에 한 줄 추가 (main 머지할 때)"
