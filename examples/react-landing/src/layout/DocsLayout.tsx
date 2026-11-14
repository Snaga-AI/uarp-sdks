/**
 * The two-column docs shell: sidebar tree + content, on the same paper-on-desk
 * container the landing uses. Only `/docs/*` routes are wrapped here, so the
 * landing keeps its full-width hero.
 *
 * The sidebar is `hidden lg:block`, so below the `lg` breakpoint there is no
 * nav at all unless we provide one. A disclosure button slides the same tree
 * in from the left as an overlay — the tree is one component, rendered once for
 * the desktop column and once for the mobile drawer, so the two cannot drift.
 */
import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SearchButton } from '../components/Search';
import { Sidebar } from '../components/Sidebar';

function MobileNav() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const location = useLocation();
  const close = () => dialogRef.current?.close();
  useEffect(() => { dialogRef.current?.close(); }, [location.pathname]);
  return <div className="lg:hidden">
    <button type="button" aria-label="Open navigation" aria-expanded={open} aria-haspopup="dialog" className="mb-5 inline-flex items-center gap-3 rounded-sm border border-rule-soft px-4 py-2 text-xs text-ink-soft" onClick={() => { dialogRef.current?.showModal(); setOpen(true); }}><span aria-hidden>☰</span> Contents</button>
    <dialog ref={dialogRef} aria-label="Contents" className="mobile-nav-dialog" onClose={() => setOpen(false)} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right) close();
    }}>
      <div className="flex flex-col gap-5 p-5">
        <div className="flex items-center justify-between"><span className="eyebrow">Contents</span><button type="button" aria-label="Close navigation" onClick={close} className="code-action">✕</button></div>
        <SearchButton onOpen={close} />
        <Sidebar onNavigate={close} />
      </div>
    </dialog>
  </div>;
}

export function DocsLayout() {
  return (
    <div className="doc-shell">
      <div className="doc-surface px-5 py-7 sm:px-8 lg:px-8">
        <MobileNav />
        <div className="flex gap-12 pb-8">
          <aside className="hidden w-60 shrink-0 lg:block">
            <div className="sidebar-scroll sticky top-36 flex max-h-[calc(100dvh-160px)] flex-col gap-5 overflow-y-auto rounded-lg bg-paper-tint p-4">
              <SearchButton />
              <Sidebar />
            </div>
          </aside>
          <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col gap-12">
            <Outlet context={{ docsLayout: true }} />
          </main>
        </div>
      </div>
    </div>
  );
}