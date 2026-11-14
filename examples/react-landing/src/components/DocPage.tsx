import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

export function DocHeader({ eyebrow, title, children, mono = false }: {
  eyebrow: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  mono?: boolean;
}) {
  return (
    <header className="doc-header">
      <div className="eyebrow flex flex-wrap items-center gap-2">{eyebrow}</div>
      <h1 className={`mt-4 break-words text-3xl leading-tight font-semibold tracking-[-0.045em] sm:text-4xl ${mono ? 'font-mono' : ''}`}>
        {title}
      </h1>
      {children && <div className="mt-4 space-y-3 text-sm leading-7 text-ink-soft">{children}</div>}
    </header>
  );
}

export function PageContents({ entries, rail = false }: { entries: { id: string; label: string }[]; rail?: boolean }) {
  const { pathname } = useLocation();
  const key = entries.map(entry => entry.id).join('|');
  const [active, setActive] = useState(entries[0]?.id ?? '');
  useEffect(() => {
    const ids = key.split('|');
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = ids[0];
      for (const id of ids) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top <= 175) current = id;
      }
      setActive(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const target = document.getElementById(window.location.hash.slice(1));
    if (target && ids.includes(target.id)) target.scrollIntoView({ block: 'start', behavior: 'instant' });
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [pathname, key]);
  if (entries.length < 2) return null;
  return <nav aria-label="On this page" className={`page-contents ${rail ? 'page-contents-rail' : ''}`}>
    <p className="eyebrow mb-3">On this page</p>
    <ol className="flex flex-wrap gap-2">{entries.map(entry => <li key={entry.id}>
      <a href={`#${entry.id}`} aria-current={active === entry.id ? 'location' : undefined} className="contents-link">{entry.label}</a>
    </li>)}</ol>
    {rail && <a href="#main-content" className="mt-5 inline-block text-xs text-ink-soft hover:text-ink">Back to top ↑</a>}
  </nav>;
}

/** Render documented identifiers as code without interpreting arbitrary HTML. */
export function DocText({ children }: { children: string }) {
  return <>{children.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith('`')
      ? <code key={index} translate="no" className="notranslate rounded bg-white/5 px-1 py-0.5 font-mono text-[0.85em] text-accent-soft">{part.slice(1, -1)}</code>
      : part
  )}</>;
}
