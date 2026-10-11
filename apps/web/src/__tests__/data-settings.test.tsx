import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { StorageStats } from '@aichat/shared';
import { DataSettingsPage } from '../pages/DataSettingsPage';
import { api } from '../api/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

const stats = (over: Partial<StorageStats> = {}): StorageStats => ({
  retention: { autoPrune: true, maxCount: 500, maxTotalBytes: 134_217_728, maxAgeDays: 30, vacuumOnPrune: false },
  // Nothing customised yet: the boxes are empty and the defaults show as placeholders.
  retentionInput: {},
  traces: { count: 160, bytes: 38_000_000, conversations: 4 },
  db: { pageCount: 13_340, pageSize: 4096, freePages: 426, bytes: 54_640_640, reclaimableBytes: 1_744_896 },
  uploads: { count: 8, bytes: 3_000_000, orphaned: 2, orphanedBytes: 500_000 },
  toolResults: { count: 230, bytes: 4_467_671 },
  messages: { count: 664, bytes: 6_000_000 },
  ...over,
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(api.settings, 'storage').mockResolvedValue(stats());
  vi.spyOn(api.settings, 'get').mockResolvedValue({ titleModelId: 'title-model' });
  vi.spyOn(api.settings, 'backups').mockResolvedValue({ dir: '/data/backups', max: 10, dbBytes: 54_640_640, backups: [] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function mount() {
  await act(async () => root.render(<DataSettingsPage />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;
const inputByLabel = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const type = async (label: string, value: string) => {
  await act(async () => {
    const el = inputByLabel(label);
    // React tracks the last value it rendered, so writing `.value` directly is ignored as a
    // no-op change. Go through the native setter to make it see a real edit.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

it('reports what the log, the database and uploads cost', async () => {
  await mount();
  expect(host.textContent).toContain('160 条 · 36.2 MB');
  expect(host.textContent).toContain('52.1 MB');
  expect(host.textContent).toContain('含空闲页 1.7 MB');
  expect(host.textContent).toContain('其中 2 个已无消息引用');
});

it('saves retention as the whole settings object and preserves the title model', async () => {
  const update = vi.spyOn(api.settings, 'update').mockResolvedValue({ titleModelId: 'title-model' });
  const prune = vi.spyOn(api.settings, 'prune').mockResolvedValue({ deleted: 0, remaining: 160, bytesFreed: 0, vacuumed: false, reclaimedBytes: 0, protectedConversations: 0 });
  await mount();
  // An unset box is empty and announces the effective default, not a frozen copy of it.
  expect(inputByLabel('最多保留条数').value).toBe('');
  expect(inputByLabel('最多保留条数').placeholder).toBe('500');
  await type('最多保留条数', '100');
  await type('正文总量上限', '64');
  await act(async () => button('保存策略').click());

  // Empty boxes mean "use the server default", so the untouched day limit must stay null.
  expect(update).toHaveBeenCalledWith({
    titleModelId: 'title-model',
    traceRetention: { autoPrune: true, vacuumOnPrune: false, maxCount: 100, maxTotalBytes: 64 * 1024 * 1024, maxAgeDays: null },
  });
  expect(host.textContent).toContain('已保存');
  // Saving must not prune on its own; the explicit button does that.
  expect(prune).not.toHaveBeenCalled();
});

it('passes the vacuum choice to the cleanup action and reports the result', async () => {
  const prune = vi.spyOn(api.settings, 'prune').mockResolvedValue({ deleted: 60, remaining: 100, bytesFreed: 9_000_000, vacuumed: true, reclaimedBytes: 1_744_896, protectedConversations: 1 });
  await mount();
  await act(async () => button('手动清理后回收数据库空间').click());
  await act(async () => button('按策略清理').click());

  expect(prune).toHaveBeenCalledWith({ mode: 'keep', vacuum: true });
  const status = host.querySelector('[role="status"]')!.textContent!;
  expect(status).toContain('已删除 60 条请求日志');
  expect(status).toContain('回收 1.7 MB 空间');
  expect(status).toContain('1 个正在生成的会话已跳过');
});

it('clears the whole log only after confirmation', async () => {
  const prune = vi.spyOn(api.settings, 'prune').mockResolvedValue({ deleted: 160, remaining: 0, bytesFreed: 0, vacuumed: false, reclaimedBytes: 0, protectedConversations: 0 });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await mount();
  await act(async () => button('清空请求日志').click());
  expect(confirm).toHaveBeenCalled();
  expect(prune).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  await act(async () => button('清空请求日志').click());
  expect(prune).toHaveBeenCalledWith({ mode: 'hard', vacuum: false });
});

it('creates an online snapshot and reports where it went', async () => {
  const backup = vi.spyOn(api.settings, 'backup').mockResolvedValue({ name: 'aichat-2026-10-11T00-00-00-000Z.db', bytes: 54_000_000, createdAt: '2026-10-11T00:00:00.000Z' });
  await mount();
  await act(async () => button('立即创建快照').click());
  expect(backup).toHaveBeenCalled();
  expect(host.querySelector('[role="status"]')?.textContent).toContain('aichat-2026-10-11T00-00-00-000Z.db');
  // The page must say the uploads are not inside the snapshot.
  expect(host.textContent).toContain('上传的附件不在快照内');
});

it('surfaces a load failure with a retry instead of an empty page', async () => {
  vi.mocked(api.settings.storage).mockRejectedValueOnce(new Error('storage unavailable'));
  await mount();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('storage unavailable');
  expect(button('重试加载')).toBeTruthy();
});
