import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { LANGUAGES, type LanguageId } from '../docs/content';

/**
 * The chosen language sticks — and is shareable.
 *
 * It lives in the URL search param `?lang=swift` so a link shared into a Swift
 * team carries the language into any deep route, not only the single page it
 * used to. `localStorage` is the default for a visitor with no `?lang=`. The old
 * `#swift` hash form was single-page-specific and is gone with routing.
 */
const LANGUAGE_KEY = 'uarp-docs-language';
const KNOWN = LANGUAGES.map((entry) => entry.id) as string[];

function isLanguageId(value: string | null): value is LanguageId {
  return value !== null && KNOWN.includes(value);
}

interface LanguageContextValue {
  language: LanguageId;
  setLanguage: (next: LanguageId) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const fromParam = params.get('lang');
  const fromStorage =
    typeof localStorage !== 'undefined' ? localStorage.getItem(LANGUAGE_KEY) : null;
  const language: LanguageId = isLanguageId(fromParam)
    ? fromParam
    : isLanguageId(fromStorage)
      ? fromStorage
      : 'ts';

  // A shared ?lang= link must also keep its language after following an internal link.
  useEffect(() => {
    if (isLanguageId(fromParam)) localStorage.setItem(LANGUAGE_KEY, fromParam);
  }, [fromParam]);

  const setLanguage = useCallback(
    (next: LanguageId) => {
      localStorage.setItem(LANGUAGE_KEY, next);
      const nextParams = new URLSearchParams(params);
      nextParams.set('lang', next);
      navigate({ search: `?${nextParams}`, hash: location.hash }, { replace: true, preventScrollReset: true });
    },
    [params, navigate, location.hash],
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}