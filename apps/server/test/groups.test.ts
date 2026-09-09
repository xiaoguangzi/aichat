import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, initDb } from '../src/db/database.js';
import { groupsRepo } from '../src/db/repos/groups.js';
import { conversationsRepo } from '../src/db/repos/conversations.js';
import { messagesRepo } from '../src/db/repos/messages.js';

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-'));
  initDb(path.join(dir, 'test.db'));
});
afterAll(() => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('conversation groups', () => {
  it('creates groups in insertion order and renames them', () => {
    const a = groupsRepo.create({ name: 'Work' });
    const b = groupsRepo.create({ name: 'Personal' });
    expect(groupsRepo.list().map((g) => g.name)).toEqual(['Work', 'Personal']);
    expect(groupsRepo.update(a.id, { name: '工作' })?.name).toBe('工作');
    expect(groupsRepo.update(b.id, { collapsed: true })?.collapsed).toBe(true);
    // a rename leaves collapsed alone and vice versa
    expect(groupsRepo.get(b.id)?.name).toBe('Personal');
    groupsRepo.reorder([b.id, a.id]);
    expect(groupsRepo.list().map((g) => g.id)).toEqual([b.id, a.id]);
  });

  it('moves conversations in and out of a group', () => {
    const g = groupsRepo.create({ name: 'Research' });
    const c = conversationsRepo.create({ title: 'in group', groupId: g.id });
    expect(conversationsRepo.get(c.id)?.groupId).toBe(g.id);
    // an unrelated update must not clear the group
    conversationsRepo.update(c.id, { title: 'renamed' });
    expect(conversationsRepo.get(c.id)?.groupId).toBe(g.id);
    // null moves it out, undefined leaves it
    const before = conversationsRepo.get(c.id)!;
    const moved = conversationsRepo.update(c.id, { groupId: null })!;
    expect(moved.groupId).toBeNull();
    // filing does not bump updated_at (the sidebar sorts by it)
    expect(moved.updatedAt).toBe(before.updatedAt);
  });

  it('scopes list() by group and by query', () => {
    const g = groupsRepo.create({ name: 'Scoped' });
    const inside = conversationsRepo.create({ title: 'alpha inside', groupId: g.id });
    conversationsRepo.create({ title: 'alpha outside' });
    messagesRepo.create({ conversationId: inside.id, role: 'user', content: [{ type: 'text', text: 'needle in the haystack' }] });

    const scoped = conversationsRepo.list(undefined, g.id).map((c) => c.title);
    expect(scoped).toEqual(['alpha inside']);
    // in-group search matches message text, not just titles
    expect(conversationsRepo.list('needle', g.id).map((c) => c.id)).toEqual([inside.id]);
    expect(conversationsRepo.list('needle', 'none')).toEqual([]);
    expect(conversationsRepo.list('alpha').length).toBe(2);
    expect(conversationsRepo.list('alpha', 'none').map((c) => c.title)).toEqual(['alpha outside']);
  });

  it('deleting a group keeps its conversations, ungrouped', () => {
    const g = groupsRepo.create({ name: 'Temp' });
    const c = conversationsRepo.create({ title: 'survivor', groupId: g.id });
    expect(groupsRepo.delete(g.id)).toBe(true);
    expect(groupsRepo.get(g.id)).toBeNull();
    expect(conversationsRepo.get(c.id)?.groupId).toBeNull();
    expect(groupsRepo.delete(g.id)).toBe(false);
  });
});
