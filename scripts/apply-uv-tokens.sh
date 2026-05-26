#!/usr/bin/env bash
# Mass-apply Unified Vision design tokens across all remaining views.
# Idempotent: re-running on already-migrated files is a no-op.
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

# ── Surfaces (container backgrounds) ─────────────────────────────
apply 'bg-white dark:bg-surface-dark'      'uv-surface-1'
apply 'bg-white dark:bg-gray-800'          'uv-surface-1'
apply 'bg-white dark:bg-gray-900'          'uv-surface-1'
apply 'bg-gray-50 dark:bg-gray-800'        'uv-surface-2'
apply 'bg-gray-50 dark:bg-surface-dark'    'uv-surface-2'
apply 'bg-gray-100 dark:bg-gray-800'       'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]'
apply 'bg-gray-100 dark:bg-gray-700'       'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]'

# ── Text colors ──────────────────────────────────────────────────
apply 'text-slate-900 dark:text-white'       'uv-text-primary'
apply 'text-slate-900 dark:text-slate-100'   'uv-text-primary'
apply 'text-slate-800 dark:text-slate-100'   'uv-text-primary'
apply 'text-gray-900 dark:text-white'        'uv-text-primary'
apply 'text-gray-500 dark:text-gray-400'     'uv-text-muted'
apply 'text-gray-600 dark:text-gray-400'     'uv-text-secondary'
apply 'text-gray-700 dark:text-gray-300'     'uv-text-secondary'

# ── Borders / dividers ───────────────────────────────────────────
apply 'border-gray-100 dark:border-gray-800' 'border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
apply 'border-gray-200 dark:border-gray-700' 'border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
apply 'border-gray-200 dark:border-gray-800' 'border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
apply 'divide-gray-100 dark:divide-gray-800' 'divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]'
apply 'divide-gray-200 dark:divide-gray-700' 'divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]'

# ── Brand gradients ──────────────────────────────────────────────
apply 'bg-gradient-to-br from-primary to-accent'             'uv-gradient-brand'
apply 'bg-gradient-to-br from-primary to-blue-600'           'uv-gradient-brand'
apply 'bg-gradient-to-r from-primary to-blue-600'            'uv-gradient-brand'
apply 'bg-gradient-to-br from-blue-500 to-blue-600'          'uv-gradient-brand'
apply 'bg-gradient-to-br from-blue-600 to-blue-700'          'uv-gradient-brand'
apply 'bg-gradient-to-r from-blue-500 to-blue-600'           'uv-gradient-brand'

# ── Hover surfaces (list rows) ──────────────────────────────────
apply 'hover:bg-gray-50 dark:hover:bg-gray-800/50'   'hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]'
apply 'hover:bg-gray-100 dark:hover:bg-gray-700'     'hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)]'
apply 'hover:bg-gray-100 dark:hover:bg-gray-800'     'hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)]'

# ── Primary button improvements ──────────────────────────────────
apply 'bg-primary text-white' 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white'

echo "✓ Unified Vision tokens applied across $(echo "$FILES" | wc -w) files"
