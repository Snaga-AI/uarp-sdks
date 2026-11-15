import { useModalDialog } from '../hooks/useModalDialog';
import { useEffect, useRef, useState } from 'react';
import { tokenise, type TokenKind } from './highlight';
import { LanguagePicker } from '../components/LanguagePicker';
import { CopyButton } from '../components/CopyButton';
import { useMediaQuery } from '../hooks/useMediaQuery';

const COLOURS: Record<TokenKind, string> = {
  plain: '', comment: 'token-comment', string: 'token-string',
  number: 'token-number', keyword: 'token-keyword', type: 'token-type', property: 'token-property',
};
const LABELS: Record<string, string> = { ts: 'TypeScript', python: 'Python', rust: 'Rust', swift: 'Swift', kotlin: 'Kotlin', ada: 'Ada' };

export function Code({ children, language = 'ts', selectable = false }: { children: string; language?: string; selectable?: boolean }) {
  const narrow = useMediaQuery('(max-width: 639px)');
  const [wrapOverride, setWrapOverride] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog(dialogRef);
  const sampleRef = useRef<HTMLPreElement>(null);
  const expandedSampleRef = useRef<HTMLPreElement>(null);
  const wrap = wrapOverride ?? narrow;
  const source = children.trim();
  const label = LABELS[language] ?? language;
  useEffect(() => {
    if (expanded) {
      dialogRef.current?.showModal();
      dialogRef.current?.querySelector<HTMLButtonElement>('[aria-label="Close code example"]')?.focus({ preventScroll: true });
    }
  }, [expanded]);

  const sample = (focused = false) => <pre ref={focused ? expandedSampleRef : sampleRef} tabIndex={0} aria-label={`${label} code sample`} className={`notranslate code-source ${focused ? 'code-source-expanded' : ''} ${wrap ? 'code-wrapped' : 'whitespace-pre'}`} translate="no">
    <code className="notranslate" translate="no">{tokenise(source, language).map((token, index) => <span key={index} className={COLOURS[token.kind]}>{token.text}</span>)}</code>
  </pre>;
  const languageControl = selectable ? <LanguagePicker compact /> : <span className="font-mono text-[0.65rem] tracking-wider text-ink-soft uppercase">{label}</span>;
  const wrapButton = <button type="button" aria-label="Wrap lines" aria-pressed={wrap} className="code-action" onClick={() => setWrapOverride(!wrap)}>Wrap</button>;

  return <div className="code-frame min-w-0 overflow-hidden rounded-lg border border-rule-soft bg-code-bg">
    <div className="code-toolbar">
      {languageControl}
      <div className="code-tools">
        {wrapButton}
        <button type="button" className="code-action" aria-label="Expand code" aria-haspopup="dialog" onClick={() => setExpanded(true)}>Expand</button>
        <CopyButton value={source} fallbackTarget={() => sampleRef.current} />
      </div>
    </div>
    {sample()}
    <dialog ref={dialogRef} aria-label={`${label} code example`} className="code-dialog" onClose={() => setExpanded(false)}>
      {expanded && <div className="code-dialog-content">
        <div className="code-toolbar">
          <div className="flex items-center gap-3">{languageControl}<span className="text-[11px] text-ink-soft">{source.split('\n').length} lines</span></div>
          <div className="code-tools">{wrapButton}<CopyButton value={source} fallbackTarget={() => expandedSampleRef.current} /><button type="button" className="code-action" aria-label="Close code example" autoFocus onClick={() => dialogRef.current?.close()}>Close ✕</button></div>
        </div>
        {sample(true)}
      </div>}
    </dialog>
  </div>;
}

export function Shell({ children }: { children: string }) {
  const sourceRef = useRef<HTMLElement>(null);
  return <div className="shell-frame">
    <span aria-hidden className="text-ink-soft select-none">$</span>
    <code ref={sourceRef} tabIndex={0} aria-label="Shell command" className="notranslate shell-source" translate="no">{children}</code>
    <CopyButton value={children} fallbackTarget={() => sourceRef.current} />
  </div>;
}
