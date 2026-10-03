#!/usr/bin/env bash
# Demo 11 — The aran command-line tool.
# Run from the repository root after `npm run build`:  bash demos/11-cli.sh
set -euo pipefail
ARAN="node dist/cli.js"     # in your own project: npx aran
OUT=demos/output
mkdir -p "$OUT"

cat > "$OUT/note.txt" <<'TXT'
Patient Ravi Kumar (patient ID P123456), age 52.
Email ravi.kumar@example.com, phone +91 98765 43210.
TXT

echo "## aran doctor";               $ARAN doctor || true
echo; echo "## aran scan";           $ARAN scan "$OUT/note.txt"
echo; echo "## aran scan --json";    $ARAN scan "$OUT/note.txt" --json
echo; echo "## aran protect";        $ARAN protect "$OUT/note.txt" --policy healthcare --out "$OUT/note.safe.txt" --force
echo; echo "## result";              cat "$OUT/note.safe.txt"; echo
echo; echo "## blocked example (exit code 3)"
# synthetic GitHub-style token, split so secret scanners do not flag this file
echo "token ghp""_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8" > "$OUT/secret.txt"
set +e; $ARAN protect "$OUT/secret.txt" --policy strict --force >/dev/null; echo "exit code: $?"; set -e
if [ -f "$OUT/sample-report.pdf" ]; then
  echo; echo "## PDF document mode"; $ARAN protect "$OUT/sample-report.pdf" --mode document --out "$OUT/cli.sanitized.pdf" --force
fi
echo; echo "## policy validate"
printf 'name: demo\nextends: healthcare\nentities:\n  EMAIL: redact\n' > "$OUT/policy.yaml"
$ARAN policy validate "$OUT/policy.yaml"
echo; echo "## lists"; $ARAN policies list; $ARAN providers list
