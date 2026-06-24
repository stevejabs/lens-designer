import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '@/components/v2/ui/Markdown';

function render(md: string): string {
  return renderToStaticMarkup(<Markdown>{md}</Markdown>);
}

describe('Markdown', () => {
  it('renders headings, bold, lists, and inline code', () => {
    const html = render('## Heading\n\nSome **bold** and `inline` text.\n\n- one\n- two');
    expect(html).toContain('<h2');
    expect(html).toContain('Heading');
    expect(html).toContain('<strong');
    expect(html).toContain('<code');
    expect(html).toContain('inline');
    expect(html).toContain('<ul');
    expect(html).toMatch(/<li[^>]*>.*one/);
  });

  it('renders fenced code blocks inside a pre', () => {
    const html = render('```ts\nconst x = 1;\n```');
    expect(html).toContain('<pre');
    expect(html).toContain('const x = 1;');
  });

  it('renders GFM tables', () => {
    const html = render('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
  });

  it('renders links as anchors', () => {
    const html = render('[docs](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('docs');
  });
});
