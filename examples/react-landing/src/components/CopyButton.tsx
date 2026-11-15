import { useEffect, useRef, useState } from 'react';

export function CopyButton({ value, label = 'Copy', fallbackTarget }: {
  value: string;
  label?: string;
  fallbackTarget?: () => HTMLElement | null;
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'selected' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setStatus('idle');
    return () => clearTimeout(timer.current);
  }, [value]);
  return <button type="button" aria-live="polite" className="code-action" onClick={async () => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setStatus('copied');
      timer.current = setTimeout(() => setStatus('idle'), 1600);
    } catch {
      const target = fallbackTarget?.();
      const selection = window.getSelection();
      if (target && selection) {
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
        setStatus('selected');
      } else setStatus('error');
    }
  }}>{status === 'copied' ? 'Copied ✓' : status === 'selected' ? 'Code selected' : status === 'error' ? 'Copy failed' : label}</button>;
}
