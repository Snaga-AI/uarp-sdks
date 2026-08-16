/**
 * The portal root.
 *
 * What used to be one 500-line single-page App is now a router: the ten
 * conceptual sections are routes under /docs/concepts, the reference, guides and
 * wire pages hang off /docs too, and the landing keeps the hero and the live
 * widget. `main.tsx` still imports `{ App }`, so the router lives here.
 *
 * The language provider sits inside the router so `?lang=` is read and written
 * through react-router's search params — a shared link carries the language into
 * any deep route, not only the page it was set on.
 */
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from './hooks/useLanguage';
import { RootLayout } from './layout/RootLayout';
import { DocsLayout } from './layout/DocsLayout';
import { Landing } from './pages/Landing';
import { ConceptPage } from './pages/ConceptPage';
import { GuideIndex } from './pages/GuideIndex';
import { GuidePage } from './pages/GuidePage';
import { ReferenceIndex } from './pages/ReferenceIndex';
import { GroupPage } from './pages/GroupPage';
import { MethodPage } from './pages/MethodPage';
import { ModelPage } from './pages/ModelPage';
import { WirePage } from './pages/WirePage';
import { NotFound } from './pages/NotFound';

export function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
        <Routes>
          <Route element={<RootLayout />}>
            <Route index element={<Landing />} />
            <Route path="docs" element={<DocsLayout />}>
              <Route path="concepts/:slug" element={<ConceptPage />} />
              <Route path="guides" element={<GuideIndex />} />
              <Route path="guides/:slug" element={<GuidePage />} />
              <Route path="reference" element={<ReferenceIndex />} />
              <Route path="reference/model/:model" element={<ModelPage />} />
              <Route path="reference/:group" element={<GroupPage />} />
              <Route path="reference/:group/:method" element={<MethodPage />} />
              <Route path="wire" element={<WirePage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </LanguageProvider>
    </BrowserRouter>
  );
}