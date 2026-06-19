import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { getApiLayer } from '@/api';
import type { AssistantTurn } from '@/api';

export const AssistantView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<AssistantTurn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const res = await getApiLayer().assistant.status();
      if (!cancelled) setAvailable(res.success && res.data ? res.data.available : false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const history = messages;
    const next: AssistantTurn[] = [...messages, { role: 'user', text: trimmed }];
    setMessages(next);
    setInput('');
    setSending(true);
    const res = await getApiLayer().assistant.chat(trimmed, history);
    setSending(false);
    const reply = res.success && res.data ? res.data.reply : res.error?.message || t('assistant_error');
    setMessages([...next, { role: 'assistant', text: reply }]);
  };

  const examples = [t('assistant_example_1'), t('assistant_example_2')];

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onClose}
          className="p-2 -ml-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors"
          aria-label={t('back')}
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <div className="w-8 h-8 rounded-lg uv-gradient-brand flex items-center justify-center">
          <Icons.MessageCircle size={16} className="text-white" />
        </div>
        <h1 className="text-lg font-bold">{t('assistant_title')}</h1>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {available === false && (
          <div className="text-center py-16 uv-text-muted text-sm">{t('assistant_unavailable')}</div>
        )}

        {available !== false && messages.length === 0 && (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl uv-gradient-brand flex items-center justify-center">
              <Icons.MessageCircle size={32} className="text-white" />
            </div>
            <div>
              <p className="font-bold uv-text-primary">{t('assistant_greeting')}</p>
              <p className="text-xs uv-text-muted mt-1">{t('assistant_disclaimer')}</p>
            </div>
            <div className="space-y-2 max-w-xs mx-auto">
              {examples.map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  disabled={available === null}
                  className="w-full uv-surface-2 uv-text-primary text-sm px-4 py-2.5 rounded-xl disabled:opacity-50 active:scale-[0.98] transition-all"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                m.role === 'user'
                  ? 'bg-[var(--color-primary)] text-white rounded-br-sm'
                  : 'uv-surface-2 uv-text-primary rounded-bl-sm'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="uv-surface-2 px-4 py-3 rounded-2xl rounded-bl-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '120ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '240ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-3 flex items-end gap-2 flex-shrink-0">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          disabled={available === false}
          placeholder={t('assistant_placeholder')}
          className="flex-1 resize-none max-h-32 bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-2.5 rounded-2xl outline-none focus:border-[var(--color-primary)] transition-all disabled:opacity-50"
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || sending || available === false}
          className="w-11 h-11 shrink-0 rounded-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-all"
          aria-label={t('assistant_send')}
        >
          <Icons.Send size={18} />
        </button>
      </div>
    </div>
  );
};
