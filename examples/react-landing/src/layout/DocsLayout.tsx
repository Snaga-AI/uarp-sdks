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
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Search } from '../components/Search';
import { Sidebar } from '../components/Sidebar';

function MobileNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  //  Closing on navigation is the expectation a reader brings from every other
  //  docs site: tap a link, the drawer goes away so the page is readable.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="mb-4 inline-flex items-center gap-2 rounded-sm border border-rule-soft px-3 py-1.5 text-sm text-ink-soft transition hover:bg-ink/5 hover:text-ink"
      >
        <span aria-hidden>☰</span> Contents
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Close navigation"
            className="flex-1 bg-ink/30"
            onClick={() => setOpen(false)}
          />
          <div className="flex w-72 max-w-[80vw] flex-col gap-4 overflow-y-auto border-l border-rule-soft bg-paper p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[0.65rem] tracking-wider text-ink-soft uppercase">
                Contents
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded-sm px-2 py-0.5 text-sm text-ink-soft hover:bg-ink/5 hover:text-ink"
              >
                ✕
              </button>
            </div>
            <Search />
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export function DocsLayout() {
  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-5">
      <div className="rounded-lg border border-rule-soft bg-paper px-5 py-10 sm:px-10 lg:px-12">
        <MobileNav />
        <div className="flex gap-12 pb-8">
          <aside className="hidden w-56 shrink-0 lg:block">
            <div className="sticky top-20 flex flex-col gap-4">
              <Search />
              <Sidebar />
            </div>
          </aside>
          <main className="flex min-w-0 flex-1 flex-col gap-12">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}