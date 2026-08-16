/**
 * The two-column docs shell: sidebar tree + content, on the same paper-on-desk
 * container the landing uses. Only `/docs/*` routes are wrapped here, so the
 * landing keeps its full-width hero.
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';

export function DocsLayout() {
  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-5">
      <div className="rounded-lg border border-rule-soft bg-paper px-5 py-10 sm:px-10 lg:px-12">
        <div className="flex gap-12 pb-8">
          <aside className="hidden w-56 shrink-0 lg:block">
            <Sidebar />
          </aside>
          <main className="flex min-w-0 flex-1 flex-col gap-12">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}