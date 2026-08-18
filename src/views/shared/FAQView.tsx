import React, { useMemo, useState } from 'react';
import { Icons } from '../../components/Icons';
import { useLanguage } from '../../i18n/LanguageContext';

interface FAQViewProps {
  onClose: () => void;
}

/**
 * Centro de ayuda: el índice desde AFUERA de cada función.
 *
 * La ayuda contextual (el botón "?") solo la encuentra quien ya llegó a la
 * pantalla. Esto responde a la pregunta que la deja al descubierto: "¿cómo veo
 * la guía de algo que no sé?". Aquí están todos los temas juntos y buscables,
 * incluidos los mismos textos que muestra el "?", para no mantener dos
 * versiones de la misma explicación.
 *
 * Antes esta pantalla era una lista fija escrita a mano y solo en español, con
 * respuestas que el producto ya no cumple (envíos a otros bancos por ₡150,
 * chat 24/7, reembolsos automáticos). Ahora sale de las claves de idioma y dice
 * lo que la app hace hoy, incluido lo que todavía no funciona.
 */

type CategoryKey =
  | 'help_cat_features'
  | 'help_cat_general'
  | 'help_cat_send'
  | 'help_cat_limits'
  | 'help_cat_payments'
  | 'help_cat_security';

interface HelpEntry {
  id: string;
  category: CategoryKey;
  titleKey: string;
  bodyKey: string;
}

// Los temas de las funciones reusan las claves del botón "?" (help_<tema>_*),
// así que una corrección se escribe una sola vez y aparece en los dos lugares.
const FEATURE_TOPICS = [
  'assistant',
  'savings',
  'splitpay',
  'marketplace',
  'cards',
  'loyalty',
  'staking',
  'payout',
  'kyc',
  'mfa',
  'webhooks',
] as const;

const ENTRIES: HelpEntry[] = [
  ...FEATURE_TOPICS.map((topic) => ({
    id: `topic-${topic}`,
    category: 'help_cat_features' as const,
    titleKey: `help_${topic}_title`,
    bodyKey: `help_${topic}_body`,
  })),
  { id: 'faq1', category: 'help_cat_general', titleKey: 'faq_q1', bodyKey: 'faq_a1' },
  { id: 'faq2', category: 'help_cat_general', titleKey: 'faq_q2', bodyKey: 'faq_a2' },
  { id: 'faq3', category: 'help_cat_send', titleKey: 'faq_q3', bodyKey: 'faq_a3' },
  { id: 'faq4', category: 'help_cat_send', titleKey: 'faq_q4', bodyKey: 'faq_a4' },
  { id: 'faq5', category: 'help_cat_limits', titleKey: 'faq_q5', bodyKey: 'faq_a5' },
  { id: 'faq6', category: 'help_cat_payments', titleKey: 'faq_q6', bodyKey: 'faq_a6' },
  { id: 'faq7', category: 'help_cat_payments', titleKey: 'faq_q7', bodyKey: 'faq_a7' },
  { id: 'faq8', category: 'help_cat_security', titleKey: 'faq_q8', bodyKey: 'faq_a8' },
  { id: 'faq9', category: 'help_cat_general', titleKey: 'faq_q9', bodyKey: 'faq_a9' },
];

const CATEGORIES: CategoryKey[] = [
  'help_cat_general',
  'help_cat_send',
  'help_cat_limits',
  'help_cat_payments',
  'help_cat_security',
  'help_cat_features',
];

export const FAQView: React.FC<FAQViewProps> = ({ onClose }) => {
  const { t } = useLanguage();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Arranca en "Todo" a propósito: quien no sabe qué busca necesita ver el
  // catálogo completo, no una categoría elegida por nosotros.
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const entries = useMemo(
    () => ENTRIES.map((e) => ({ ...e, title: t(e.titleKey), body: t(e.bodyKey) })),
    [t],
  );

  const query = searchQuery.trim().toLowerCase();
  const filtered = entries.filter((e) => {
    // Buscar ignora la categoría: si escribís "staking" no deberías tener que
    // adivinar primero en qué pestaña vive.
    const matchesCategory = query !== '' || selectedCategory === 'all' || e.category === selectedCategory;
    const matchesSearch =
      query === '' || e.title.toLowerCase().includes(query) || e.body.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });

  const toggleExpand = (id: string) => setExpandedId(expandedId === id ? null : id);

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-surface-dark/95 backdrop-blur-lg border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
        <div className="flex items-center justify-between px-4 h-14">
          <button
            onClick={onClose}
            aria-label={t('back')}
            className="p-2 -ml-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)]"
          >
            <Icons.ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-bold">{t('help_center')}</h1>
          <div className="w-10" />
        </div>

        {/* Buscador */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Icons.Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={t('help_search_ph')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Categorías */}
        <div className="px-4 pb-3 overflow-x-auto no-scrollbar">
          <div className="flex gap-2">
            {(['all', ...CATEGORIES] as const).map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === category
                    ? 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white'
                    : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-secondary'
                }`}
              >
                {category === 'all' ? t('help_cat_all') : t(category)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Contenido */}
      <div className="p-4 pb-24 overflow-y-auto h-[calc(100vh-200px)]">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-full flex items-center justify-center mb-4">
              <Icons.HelpCircle size={40} className="uv-text-muted" />
            </div>
            <h3 className="text-lg font-semibold mb-1">{t('help_no_results')}</h3>
            <p className="text-gray-500 text-sm text-center">{t('help_no_results_desc')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="uv-surface-1 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] overflow-hidden"
              >
                <button
                  onClick={() => toggleExpand(item.id)}
                  aria-expanded={expandedId === item.id}
                  className="w-full flex items-center justify-between p-4 text-left"
                >
                  <span className="font-medium text-sm pr-4">{item.title}</span>
                  <Icons.ChevronRight
                    size={20}
                    className={`flex-shrink-0 text-gray-400 transition-transform ${
                      expandedId === item.id ? 'rotate-90' : ''
                    }`}
                  />
                </button>
                {expandedId === item.id && (
                  <div className="px-4 pb-4 animate-in slide-in-from-top-2 duration-200">
                    <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                      <p className="text-sm uv-text-secondary leading-relaxed whitespace-pre-line">
                        {item.body}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Soporte: antes prometía chat y llamada 24/7 con dos botones que no
            hacían nada. Hoy el único canal real es el asistente. */}
        <div className="mt-8 uv-surface-1 rounded-2xl p-5 border border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
          <h3 className="font-bold text-base uv-text-primary mb-1">{t('chat_support')}</h3>
          <p className="uv-text-secondary text-sm">{t('support_soon_desc')}</p>
        </div>
      </div>
    </div>
  );
};
