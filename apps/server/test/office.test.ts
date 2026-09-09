import { describe, it, expect } from 'vitest';
import { officeKind, officeText } from '../src/util/office.js';
import { makeDocx, makeXlsx, makePptx } from './fixtures/office.js';

describe('officeKind', () => {
  it('detects by extension, which wins over a generic mime', () => {
    expect(officeKind('report.docx', 'application/octet-stream')).toBe('docx');
    expect(officeKind('Sales.XLSX', 'application/octet-stream')).toBe('xlsx');
    expect(officeKind('deck.pptx', '')).toBe('pptx');
  });

  it('falls back to the mime when the name has no useful extension', () => {
    expect(officeKind('upload', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
    expect(officeKind('upload', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx');
  });

  it('ignores unrelated files', () => {
    expect(officeKind('notes.md', 'text/markdown')).toBeNull();
    expect(officeKind('paper.pdf', 'application/pdf')).toBeNull();
    expect(officeKind('legacy.doc', 'application/msword')).toBeNull();
  });
});

describe('officeText', () => {
  it('extracts docx headings, prose and tables as markdown', async () => {
    const text = await officeText(await makeDocx(), 'docx');
    expect(text).toBe('# 季度报告\n\n营收增长 12%。\n\n| 区域 | 金额 |\n| --- | --- |\n| 华东 | 500 |');
  });

  it('extracts xlsx sheets as named TSV blocks', async () => {
    const text = await officeText(await makeXlsx(), 'xlsx');
    expect(text).toBe('## 销售\n区域\t金额\n华东\t500');
  });

  it('extracts pptx slides in numeric order, not lexicographic', async () => {
    const text = await officeText(await makePptx(), 'pptx');
    expect(text).toBe('## Slide 1\n第一页标题\n要点一\n\n## Slide 2\n第二页标题\n要点二\n\n## Slide 10\n第十页标题\n要点十');
  });

  it('rejects on a corrupt file rather than returning junk', async () => {
    await expect(officeText(Buffer.from('not a zip'), 'docx')).rejects.toThrow();
    await expect(officeText(Buffer.from('not a zip'), 'pptx')).rejects.toThrow();
  });
});
