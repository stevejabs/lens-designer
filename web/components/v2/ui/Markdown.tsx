'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/v2/cn';

/** Open links in the user's real browser instead of navigating the app. */
function openExternal(href?: string): void {
  if (!href) return;
  const shell = (window as unknown as { lensDesignerNative?: { shell?: { openExternal?: (u: string) => void } } })
    .lensDesignerNative?.shell;
  if (shell?.openExternal) shell.openExternal(href);
  else window.open(href, '_blank', 'noopener');
}

const components: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h1 className="mt-3 mb-1.5 text-sm font-semibold text-text-primary">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1.5 text-sm font-semibold text-text-primary">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2.5 mb-1 text-xs font-semibold text-text-primary">{children}</h3>,
  ul: ({ children }) => <ul className="my-1.5 ml-4 list-disc space-y-0.5 marker:text-text-tertiary">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 ml-4 list-decimal space-y-0.5 marker:text-text-tertiary">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        openExternal(href);
      }}
      className="text-accent-300 underline decoration-accent-300/40 hover:text-accent-200 cursor-pointer"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-subtle pl-3 text-text-tertiary italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-subtle" />,
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-subtle bg-bg-0 p-2.5 text-2xs leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const fenced = /language-/.test(className ?? '');
    if (fenced) return <code className="font-mono text-text-secondary">{children}</code>;
    return (
      <code className="rounded bg-bg-3 px-1 py-0.5 font-mono text-2xs text-accent-300">{children}</code>
    );
  },
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-2xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-subtle px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-subtle px-2 py-1">{children}</td>,
};

/** Render agent/markdown text with panel-tuned styling. Safe by default —
 *  react-markdown does not render raw HTML unless rehype-raw is added. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('text-sm text-text-secondary', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
