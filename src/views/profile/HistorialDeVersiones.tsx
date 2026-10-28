import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { cambiosEn, cargarNotasTraducidas, getAllVersions, type NotasTraducidas } from '../../config/version';

// Lo que trajo cada version, en el idioma de la persona. La vigente va primero y
// lleva la etiqueta "Actual", que sale del diccionario como el resto de la app.
// Las traducciones se piden solo si el idioma no es el espanol, del que sale el
// changelog; mientras llegan se lee el espanol.
export const HistorialDeVersiones: React.FC = () => {
  const { t, language } = useLanguage();
  const [traducidas, setTraducidas] = useState<NotasTraducidas>({});

  useEffect(() => {
    if (language === 'es') return;
    let vigente = true;
    cargarNotasTraducidas()
      .then((notas) => {
        if (vigente) setTraducidas(notas);
      })
      .catch(() => {
        /* sin el archivo se lee el espanol, que siempre esta */
      });
    return () => {
      vigente = false;
    };
  }, [language]);

  return (
    <>
      {getAllVersions().map((version, index) => (
        <div key={version.version} className="uv-surface-2 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="font-bold uv-text-primary">
                v{version.version}
              </span>
              {index === 0 && (
                <span className="bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs px-2 py-0.5 rounded-full">
                  {t('current')}
                </span>
              )}
            </div>
            <span className="text-xs text-gray-500">{version.releaseDate}</span>
          </div>
          <ul className="space-y-1.5">
            {cambiosEn(version, language, traducidas).map((change, i) => (
              <li key={i} className="flex items-start gap-2 text-sm uv-text-secondary">
                <span className="text-[var(--color-primary)] mt-0.5">•</span>
                {change}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
};
