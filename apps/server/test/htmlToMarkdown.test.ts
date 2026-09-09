import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from '../src/util/htmlToMarkdown.js';

describe('htmlToMarkdown', () => {
  it('converts headings and paragraphs', () => {
    expect(htmlToMarkdown('<h1>Title</h1><p>Body text.</p><h3>Sub</h3><p>More.</p>')).toBe('# Title\n\nBody text.\n\n### Sub\n\nMore.');
  });

  it('converts unordered and ordered lists', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two');
    expect(htmlToMarkdown('<ol><li>first</li><li>second</li></ol>')).toBe('1. first\n2. second');
  });

  it('indents nested lists and restarts ordered numbering per level', () => {
    const md = htmlToMarkdown('<ol><li>a<ol><li>a1</li><li>a2</li></ol></li><li>b</li></ol>');
    expect(md).toBe('1. a\n  1. a1\n  2. a2\n2. b');
  });

  it('converts tables to markdown, padding ragged rows', () => {
    const html = '<table><tr><td><p>Region</p></td><td><p>Amount</p></td></tr><tr><td><p>East</p></td></tr></table>';
    expect(htmlToMarkdown(html)).toBe('| Region | Amount |\n| --- | --- |\n| East |  |');
  });

  it('collapses block markup inside table cells onto one line', () => {
    const html = '<table><tr><td><p>a</p><p>b</p></td><td><p>c<br />d</p></td></tr></table>';
    expect(htmlToMarkdown(html)).toBe('| a b | c d |\n| --- | --- |');
  });

  it('converts emphasis, links and images', () => {
    expect(htmlToMarkdown('<p><strong>bold</strong> and <em>italic</em></p>')).toBe('**bold** and *italic*');
    expect(htmlToMarkdown('<p><a href="https://example.com">site</a></p>')).toBe('[site](https://example.com)');
    expect(htmlToMarkdown('<p><img src="x.png" alt="a chart" /></p>')).toBe('[image: a chart]');
  });

  it('drops link markup when there is no href', () => {
    expect(htmlToMarkdown('<p><a name="anchor">text</a></p>')).toBe('text');
  });

  it('decodes entities, including in attributes', () => {
    expect(htmlToMarkdown('<p>a &amp; b &lt;c&gt; &#8212; d&nbsp;e</p>')).toBe('a & b <c> — d e');
    expect(htmlToMarkdown('<p><a href="/s?x=1&amp;y=2">q</a></p>')).toBe('[q](/s?x=1&y=2)');
  });

  it('keeps text from unknown tags instead of dropping it', () => {
    expect(htmlToMarkdown('<p>see <span class="x">this</span> and <sup>1</sup></p>')).toBe('see this and 1');
  });

  it('renders blockquotes and collapses excess blank lines', () => {
    expect(htmlToMarkdown('<p>a</p><blockquote><p>quoted</p></blockquote><p>b</p>')).toBe('a\n\n> quoted\n\nb');
  });

  it('returns an empty string for empty input', () => {
    expect(htmlToMarkdown('')).toBe('');
  });
});
