import { useEffect, type RefObject } from 'react';

const locks = new Set<symbol>();
let previousOverflow = '';

/** Native dialogs trap focus but do not prevent scrolling the page behind them. */
export function useModalDialog(ref: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const token = Symbol();
    const release = () => {
      if (locks.delete(token) && !locks.size) document.documentElement.style.overflow = previousOverflow;
    };
    const sync = () => {
      if (!dialog.open) { release(); return; }
      if (locks.has(token)) return;
      if (!locks.size) previousOverflow = document.documentElement.style.overflow;
      locks.add(token);
      document.documentElement.style.overflow = 'hidden';
    };
    const observer = new MutationObserver(sync);
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    sync();
    return () => { observer.disconnect(); release(); };
  }, [ref]);
}
