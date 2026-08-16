/** `/docs/guides/:slug` — a single task guide. */
import { Link, useParams } from 'react-router-dom';
import { GUIDES, type GuideBlock } from '../content/guides';
import { useLanguage } from '../hooks/useLanguage';
import { Code, Shell } from '../docs/Code';
import { INSTALL, LANGUAGES } from '../docs/content';
import { NotFound } from './NotFound';

function Caption({ children }: { children: string }) {
  return (
    <span className="font-mono text-[0.65rem] tracking-wider text-ink-soft uppercase">{children}</span>
  );
}

function Block({ block }: { block: GuideBlock }) {
  const { language } = useLanguage();
  switch (block.kind) {
    case 'prose':
      return <p className="text-sm leading-relaxed text-ink-soft">{block.text}</p>;
    case 'install': {
      //  INSTALL is not a Samples record — it carries a command, a shell flag
      //  and a "needs" line, so it renders through Shell/Code like the install
      //  concept page does. The per-language notes live on the concept page;
      //  the guide keeps just the command and the platform line.
      const install = INSTALL[language];
      const current = LANGUAGES.find((entry) => entry.id === language)!;
      return (
        <div className="flex flex-col gap-1.5">
          <Caption>Install</Caption>
          {install.shell ? <Shell>{install.command}</Shell> : <Code language={language}>{install.command}</Code>}
          <p className="text-xs text-ink-soft">
            {current.name} · {current.registry} · needs {install.needs}.
          </p>
        </div>
      );
    }
    case 'code':
      return (
        <div className="flex flex-col gap-1.5">
          {block.caption && <Caption>{block.caption}</Caption>}
          <Code language={block.language}>{block.code}</Code>
        </div>
      );
    case 'samples':
      return (
        <div className="flex flex-col gap-1.5">
          {block.caption && <Caption>{block.caption}</Caption>}
          <Code language={language}>{block.record[language]}</Code>
        </div>
      );
  }
}

export function GuidePage() {
  const { slug } = useParams();
  const guide = GUIDES.find((g) => g.slug === slug);
  if (!guide) return <NotFound />;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b border-rule-soft pb-4">
        <p className="text-sm text-ink-soft">
          <Link className="text-accent underline underline-offset-2" to="/docs/guides">
            Guides
          </Link>
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">{guide.title}</h2>
        <p className="text-ink-soft">{guide.summary}</p>
      </header>

      <div className="flex flex-col gap-4">
        {guide.blocks.map((block, index) => (
          <Block key={index} block={block} />
        ))}
      </div>
    </section>
  );
}