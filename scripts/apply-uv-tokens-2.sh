#!/usr/bin/env bash
# Second pass — catch standalone primary/accent colors and remaining
# hardcoded surfaces that didn't match the paired dark: variants.
set -e
cd "$(dirname "$0")/.."

FILES=$(find src/views src/components -name "*.tsx" ! -name "*.test.tsx")

apply() {
  local pattern="$1"
  local replacement="$2"
  for f in $FILES; do
    sed -i "s|$pattern|$replacement|g" "$f"
  done
}

# ── Standalone primary references (CTAs) ──────────────────────
apply ' bg-primary/10 text-primary'  ' bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
apply '"bg-primary/10 text-primary'  '"bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
apply ' bg-primary/20 text-primary'  ' bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
apply '"text-primary"'               '"text-[var(--color-primary)]"'
apply '"text-primary '               '"text-[var(--color-primary)] '
apply ' text-primary"'               ' text-[var(--color-primary)]"'
apply 'text-primary font-'           'text-[var(--color-primary)] font-'

# ── Lonely text-gray-500 instances ──────────────────────────
apply '"text-gray-500"'              '"uv-text-muted"'
apply '"text-gray-400"'              '"uv-text-muted"'

# ── Remaining lonely surfaces ───────────────────────────────
apply '"bg-white dark:bg-surface-dark'  '"uv-surface-1'
apply ' bg-white dark:bg-surface-dark'  ' uv-surface-1'

# ── Background of overlay views (TransactionsView pattern) ──
apply ' bg-background dark:bg-background-dark' ' bg-[var(--color-background)] dark:bg-[var(--color-background-dark)]'

echo "✓ second pass done"
