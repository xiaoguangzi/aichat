import { describe, it, expect } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Markdown } from '../components/ui/Markdown';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(text: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(<Markdown text={text} live />);
  });
  return el;
}

describe('Markdown math', () => {
  it('renders inline and display math with KaTeX', async () => {
    const el = await render('inline $E = mc^2$\n\n$$\\frac{a}{b}$$');
    expect(el.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    expect(el.querySelector('.katex-display')).not.toBeNull();
    expect(el.textContent).not.toContain('$$');
  });

  it('renders LaTeX-style delimiters too', async () => {
    const el = await render('\\(x^2\\) and \\[y^2\\]');
    expect(el.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    expect(el.textContent).not.toContain('\\(');
  });

  it('does not touch math-looking text inside code', async () => {
    const el = await render('```sh\necho $PATH\n```');
    expect(el.querySelector('.katex')).toBeNull();
    expect(el.textContent).toContain('$PATH');
  });

  it('shows the source instead of throwing on a broken formula', async () => {
    const el = await render('$\\frac{1}{$');
    expect(el.textContent).toContain('\\frac');
  });
});
