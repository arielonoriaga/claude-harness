#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/lib.sh"
fail=0
check(){ if [ "$1" = "$2" ]; then echo "ok: $3"; else echo "FAIL: $3 (got [$1] want [$2])"; fail=1; fi; }

check "$(is_source_file foo.rs && echo y || echo n)" "y" ".rs is source"
check "$(is_source_file foo.tsx && echo y || echo n)" "y" ".tsx is source"
check "$(is_source_file foo.ts && echo y || echo n)" "y" ".ts is source"
check "$(is_source_file foo.js && echo y || echo n)" "y" ".js is source"
check "$(is_source_file foo.go && echo y || echo n)" "y" ".go is source"
check "$(is_source_file foo.py && echo y || echo n)" "y" ".py is source"
check "$(is_source_file foo.lua && echo y || echo n)" "y" ".lua is source"
check "$(is_source_file README.md && echo y || echo n)" "n" ".md not source"
check "$(is_source_file foo.json && echo y || echo n)" "n" ".json not source"

# artifact paths: source-extension but compiled output
check "$(is_artifact_path dist/index.js && echo y || echo n)" "y" "dist/ at root is artifact"
check "$(is_artifact_path target/debug/build/x/out/private.rs && echo y || echo n)" "y" "target/ is artifact"
check "$(is_artifact_path packages/ui/dist/a.js && echo y || echo n)" "y" "nested dist/ is artifact"
check "$(is_artifact_path build/main.js && echo y || echo n)" "y" "build/ is artifact"
check "$(is_artifact_path crate/out/gen.rs && echo y || echo n)" "y" "out/ is artifact"
check "$(is_artifact_path app.min.js && echo y || echo n)" "y" ".min.js is artifact"
check "$(is_artifact_path src/main.rs && echo y || echo n)" "n" "real source not artifact"
check "$(is_artifact_path src/distribute.ts && echo y || echo n)" "n" "dist substring in filename not artifact"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init -q
git -C "$TMP" config user.email t@t; git -C "$TMP" config user.name t
echo "fn main(){}" > "$TMP/a.rs"
echo "# doc" > "$TMP/README.md"
mkdir -p "$TMP/dist" "$TMP/target/debug"
echo "var x" > "$TMP/dist/bundle.js"
echo "fn g(){}" > "$TMP/target/debug/gen.rs"
echo "min" > "$TMP/vendor.min.js"
out="$(changed_source_files "$TMP")"
check "$(echo "$out" | grep -c 'a.rs')" "1" "untracked .rs detected"
check "$(echo "$out" | grep -c 'README.md')" "0" ".md filtered out"
check "$(echo "$out" | grep -c 'dist/bundle.js')" "0" "dist/ artifact filtered out"
check "$(echo "$out" | grep -c 'target/debug/gen.rs')" "0" "target/ artifact filtered out"
check "$(echo "$out" | grep -c 'vendor.min.js')" "0" ".min.js filtered out"

exit $fail
