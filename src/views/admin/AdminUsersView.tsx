import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { getApiLayer } from '@/api';
import type { AdminUser, AdminUserStatus } from '@/api/repositories/admin.repository';

type Tab = 'search' | 'blocked';
type Translate = (key: string) => string;

const MIN_TERM = 3;
const REASON_MAX = 500;

const LOCALE_BY_LANG: Record<string, string> = {
  es: 'es-CR',
  en: 'en-US',
  fr: 'fr-FR',
  pt: 'pt-BR',
  'zh-cn': 'zh-CN',
  ja: 'ja-JP',
  hi: 'hi-IN',
};

const CHIP_BY_STATUS: Record<AdminUserStatus, string> = {
  active: 'uv-chip-success',
  blocked: 'uv-chip-danger',
  suspended: 'uv-chip-warning',
  closed: 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-muted',
};

// Contract error codes map to app-language copy; anything unknown falls back to
// the generic message so the raw backend text never reaches the screen.
function errorKey(code?: string | null): string {
  switch (code) {
    case 'CANNOT_BLOCK_SELF': return 'admin_users_err_self';
    case 'CANNOT_BLOCK_ADMIN': return 'admin_users_err_admin';
    case 'REASON_REQUIRED': return 'admin_users_err_reason';
    case 'SEARCH_TERM_TOO_SHORT': return 'admin_users_search_hint';
    default: return 'admin_users_action_failed';
  }
}

function fullName(u: AdminUser): string {
  return `${u.firstName} ${u.lastName}`.trim();
}

function formatWhen(iso: string | null, locale: string, fallback: string): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

interface UserCardProps {
  user: AdminUser;
  busy: boolean;
  locale: string;
  t: Translate;
  onBlock: (u: AdminUser) => void;
  onUnblock: (u: AdminUser) => void;
}

const UserCard: React.FC<UserCardProps> = ({ user, busy, locale, t, onBlock, onUnblock }) => {
  const blocked = user.status === 'blocked';
  return (
    <article className="uv-surface-1 rounded-2xl uv-shadow-soft p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold uv-text-primary truncate">{fullName(user)}</p>
          <p className="text-xs uv-text-muted mt-0.5">
            {t('admin_users_last_login')} · {formatWhen(user.lastLoginAt, locale, t('admin_users_never'))}
          </p>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${CHIP_BY_STATUS[user.status]}`}>
          {t(`admin_users_status_${user.status}`)}
        </span>
      </div>

      <ul className="mt-3 space-y-1.5 text-sm">
        <li className="flex items-center gap-2 min-w-0">
          <Icons.Hash size={14} className="uv-text-muted shrink-0" aria-hidden="true" />
          <span className="uv-text-secondary tabular-nums truncate">{user.cedulaMasked}</span>
        </li>
        <li className="flex items-center gap-2 min-w-0">
          <Icons.Phone size={14} className="uv-text-muted shrink-0" aria-hidden="true" />
          <span className="uv-text-secondary tabular-nums truncate">{user.phoneMasked}</span>
        </li>
        <li className="flex items-center gap-2 min-w-0">
          <Icons.Mail size={14} className="uv-text-muted shrink-0" aria-hidden="true" />
          <span className="uv-text-secondary truncate">{user.emailMasked}</span>
        </li>
      </ul>

      {blocked && (
        <dl className="mt-3 pt-3 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="uv-text-muted">{t('admin_users_blocked_at')}</dt>
          <dd className="uv-text-primary tabular-nums">{formatWhen(user.blockedAt, locale, '—')}</dd>
          {user.blockedByName && (
            <>
              <dt className="uv-text-muted">{t('admin_users_blocked_by')}</dt>
              <dd className="uv-text-primary truncate">{user.blockedByName}</dd>
            </>
          )}
          <dt className="uv-text-muted">{t('admin_users_blocked_reason_label')}</dt>
          <dd className="uv-text-primary break-words">{user.blockedReason}</dd>
        </dl>
      )}

      <div className="mt-3">
        {blocked ? (
          <button
            type="button"
            onClick={() => onUnblock(user)}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 border border-[var(--color-primary)] text-[var(--color-primary)] py-2.5 rounded-xl font-bold disabled:opacity-50"
          >
            <Icons.Unlock size={16} aria-hidden="true" />
            {t('admin_users_unblock')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onBlock(user)}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 border border-[var(--color-danger)] text-[var(--color-danger)] py-2.5 rounded-xl font-bold disabled:opacity-50"
          >
            <Icons.Lock size={16} aria-hidden="true" />
            {t('admin_users_block')}
          </button>
        )}
      </div>
    </article>
  );
};

export const AdminUsersView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t, language } = useLanguage();
  const locale = LOCALE_BY_LANG[language] || 'es-CR';

  const [tab, setTab] = useState<Tab>('search');

  const [query, setQuery] = useState('');
  const [shortTerm, setShortTerm] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<AdminUser[]>([]);
  // Error codes live in state and are translated at render time so the effects
  // never depend on t (it is recreated on every render).
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  const [blocked, setBlocked] = useState<AdminUser[]>([]);
  const [loadingBlocked, setLoadingBlocked] = useState(false);
  const [blockedError, setBlockedError] = useState<string | null>(null);

  const [acting, setActing] = useState<string | null>(null);
  const actingRef = useRef(false);
  const [blocking, setBlocking] = useState<AdminUser | null>(null);
  const [unblocking, setUnblocking] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');
  const [sheetError, setSheetError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'blocked') return;
    let cancelled = false;
    const run = async () => {
      setLoadingBlocked(true);
      setBlockedError(null);
      const api = getApiLayer();
      if (!api.admin) { if (!cancelled) setLoadingBlocked(false); return; }
      const res = await api.admin.listBlockedUsers();
      if (cancelled) return;
      if (res.success) setBlocked(res.data ?? []);
      else setBlockedError(res.error?.code || 'ADMIN_ACTION_FAILED');
      setLoadingBlocked(false);
    };
    run();
    return () => { cancelled = true; };
  }, [tab]);

  const runSearch = async () => {
    const term = query.trim();
    if (term.length < MIN_TERM) { setShortTerm(true); return; }
    setShortTerm(false);
    setSearchError(null);
    setSearching(true);
    const seq = ++searchSeq.current;
    try {
      const api = getApiLayer();
      if (!api.admin) return;
      const res = await api.admin.searchUsers(term);
      // A newer search superseded this one: its answer must not land.
      if (seq !== searchSeq.current) return;
      if (res.success) { setResults(res.data ?? []); setSearched(true); }
      else setSearchError(res.error?.code || 'ADMIN_ACTION_FAILED');
    } catch {
      if (seq === searchSeq.current) setSearchError('ADMIN_ACTION_FAILED');
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  const applyUpdate = (u: AdminUser) => {
    setResults((list) => list.map((x) => (x.id === u.id ? u : x)));
    setBlocked((list) => list.map((x) => (x.id === u.id ? u : x)));
  };

  const openBlock = (u: AdminUser) => { setReason(''); setSheetError(null); setBlocking(u); };
  const openUnblock = (u: AdminUser) => { setSheetError(null); setUnblocking(u); };

  const confirmBlock = async () => {
    if (!blocking || actingRef.current) return;
    const why = reason.trim();
    if (!why) { setSheetError('REASON_REQUIRED'); return; }
    actingRef.current = true;
    setActing(blocking.id);
    setSheetError(null);
    try {
      const api = getApiLayer();
      if (!api.admin) return;
      const res = await api.admin.blockUser(blocking.id, why);
      if (res.success && res.data) {
        applyUpdate(res.data);
        setBlocking(null);
        setReason('');
      } else {
        setSheetError(res.error?.code || 'ADMIN_ACTION_FAILED');
      }
    } catch {
      setSheetError('ADMIN_ACTION_FAILED');
    } finally {
      actingRef.current = false;
      setActing(null);
    }
  };

  const confirmUnblock = async () => {
    if (!unblocking || actingRef.current) return;
    actingRef.current = true;
    setActing(unblocking.id);
    setSheetError(null);
    try {
      const api = getApiLayer();
      if (!api.admin) return;
      const res = await api.admin.unblockUser(unblocking.id);
      if (res.success && res.data) {
        applyUpdate(res.data);
        setUnblocking(null);
      } else {
        setSheetError(res.error?.code || 'ADMIN_ACTION_FAILED');
      }
    } catch {
      setSheetError('ADMIN_ACTION_FAILED');
    } finally {
      actingRef.current = false;
      setActing(null);
    }
  };

  const spinner = (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const emptyState = (icon: React.ReactNode, text: string) => (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] flex items-center justify-center mb-4">
        {icon}
      </div>
      <p className="font-semibold uv-text-primary">{text}</p>
    </div>
  );

  const list = (users: AdminUser[]) => (
    <div className="px-4 py-4 space-y-3">
      {users.map((u) => (
        <UserCard key={u.id} user={u} busy={acting === u.id} locale={locale} t={t} onBlock={openBlock} onUnblock={openUnblock} />
      ))}
    </div>
  );

  const tabClass = (active: boolean) =>
    `flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
      active ? 'bg-white dark:bg-gray-700 uv-text-primary shadow-sm' : 'text-gray-500'
    }`;

  const sheetPerson = (u: AdminUser) => (
    <div>
      <p className="font-bold uv-text-primary">{fullName(u)}</p>
      <p className="text-xs uv-text-muted tabular-nums mt-0.5">{u.cedulaMasked}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]" aria-label={t('back')}>
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('admin_users_title')}</h1>
        <span className="w-9" />
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        <div className="px-4 pt-3">
          <div className="flex bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] p-1 rounded-xl" role="tablist" aria-label={t('admin_users_title')}>
            <button type="button" role="tab" aria-selected={tab === 'search'} onClick={() => setTab('search')} className={tabClass(tab === 'search')}>
              <Icons.Search size={14} aria-hidden="true" />
              {t('admin_users_tab_search')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'blocked'} onClick={() => setTab('blocked')} className={tabClass(tab === 'blocked')}>
              <Icons.Lock size={14} aria-hidden="true" />
              {t('admin_users_tab_blocked')}
            </button>
          </div>
        </div>

        {tab === 'search' && (
          <>
            <form onSubmit={(e) => { e.preventDefault(); void runSearch(); }} className="px-4 pt-4">
              <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <Icons.Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 uv-text-muted pointer-events-none" aria-hidden="true" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); if (shortTerm) setShortTerm(false); }}
                    placeholder={t('admin_users_search_placeholder')}
                    aria-label={t('admin_users_search_placeholder')}
                    aria-invalid={shortTerm || undefined}
                    aria-describedby="admin-users-search-hint"
                    enterKeyHint="search"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]"
                  />
                </div>
                <button type="submit" disabled={searching} className="shrink-0 px-4 rounded-xl bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-bold disabled:opacity-50">
                  {t('admin_users_search_action')}
                </button>
              </div>
              <p id="admin-users-search-hint" className={`mt-1.5 text-xs ${shortTerm ? 'text-[var(--color-danger)]' : 'uv-text-muted'}`} aria-live="polite">
                {t('admin_users_search_hint')}
              </p>
            </form>
            {searchError && <p className="px-4 pt-3 text-[var(--color-danger)] text-sm" role="alert">{t(errorKey(searchError))}</p>}
            {searching
              ? spinner
              : searched && results.length === 0
                ? emptyState(<Icons.Search size={26} className="uv-text-muted" />, t('admin_users_empty'))
                : list(results)}
          </>
        )}

        {tab === 'blocked' && (
          <>
            {blockedError && <p className="px-4 pt-3 text-[var(--color-danger)] text-sm" role="alert">{t(errorKey(blockedError))}</p>}
            {loadingBlocked
              ? spinner
              : blocked.length === 0
                ? emptyState(<Icons.Unlock size={26} className="uv-text-muted" />, t('admin_users_no_blocked'))
                : list(blocked)}
          </>
        )}
      </div>

      <BottomSheet isOpen={blocking !== null} onClose={() => { if (!acting) setBlocking(null); }} title={t('admin_users_block_title')} dismissable={acting === null}>
        {blocking && (
          <div className="space-y-4">
            {sheetPerson(blocking)}
            <div className="flex gap-3 rounded-xl bg-[var(--color-danger-soft)] p-3">
              <Icons.AlertTriangle size={18} className="shrink-0 mt-0.5 text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]" aria-hidden="true" />
              <p className="text-sm text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">{t('admin_users_block_warning')}</p>
            </div>
            <div>
              <label htmlFor="admin-users-block-reason" className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('admin_users_block_reason')}</label>
              <textarea
                id="admin-users-block-reason"
                value={reason}
                onChange={(e) => { setReason(e.target.value); if (sheetError) setSheetError(null); }}
                rows={3}
                maxLength={REASON_MAX}
                autoFocus
                disabled={acting !== null}
                aria-invalid={sheetError === 'REASON_REQUIRED' || undefined}
                aria-describedby="admin-users-block-reason-hint"
                className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)] resize-none"
              />
              <div className="flex justify-between gap-3 mt-1 text-xs uv-text-muted">
                <span id="admin-users-block-reason-hint">{t('admin_users_block_reason_hint')}</span>
                <span className="tabular-nums shrink-0">{reason.length}/{REASON_MAX}</span>
              </div>
            </div>
            {sheetError && <p className="text-sm text-[var(--color-danger)]" role="alert">{t(errorKey(sheetError))}</p>}
            <button
              type="button"
              onClick={() => void confirmBlock()}
              disabled={acting !== null}
              className="w-full bg-[var(--color-danger)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50"
            >
              {acting ? t('loading') : t('admin_users_block_confirm')}
            </button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet isOpen={unblocking !== null} onClose={() => { if (!acting) setUnblocking(null); }} title={t('admin_users_unblock_title')} dismissable={acting === null}>
        {unblocking && (
          <div className="space-y-4">
            {sheetPerson(unblocking)}
            <p className="text-sm uv-text-secondary">{t('admin_users_unblock_warning')}</p>
            {sheetError && <p className="text-sm text-[var(--color-danger)]" role="alert">{t(errorKey(sheetError))}</p>}
            <button
              type="button"
              onClick={() => void confirmUnblock()}
              disabled={acting !== null}
              className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50"
            >
              {acting ? t('loading') : t('admin_users_unblock_confirm')}
            </button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
};
