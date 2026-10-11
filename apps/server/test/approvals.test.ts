import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSSEEvent } from '@aichat/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-approval-'));
process.env.DATA_DIR = tmp;
process.env.SKILLS_DIR = path.join(tmp, 'skills');

const { initDb, closeDb } = await import('../src/db/database.js');
const { forgetApproval, isRemembered, readApprovalRules, rememberApproval, requestApproval, resolveApproval } = await import('../src/agent/approvals.js');

beforeEach(() => initDb(path.join(tmp, `t-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)));
afterEach(() => closeDb());

const ask = (tool: string, opts: { remember?: boolean } = {}) => {
  const events: ChatSSEEvent[] = [];
  const promise = requestApproval({
    conversationId: 'c1', tool, input: { x: 1 }, signal: new AbortController().signal,
    emit: (ev) => void events.push(ev),
  });
  return { promise, events, remember: opts.remember };
};

it('asks the first time and returns the user decision', async () => {
  const { promise, events } = ask('skill__run_script:demo');
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ event: 'approval_required', data: { tool: 'skill__run_script:demo' } });
  const id = (events[0]!.data as { requestId: string }).requestId;
  expect(resolveApproval(id, true)).toBe(true);
  await expect(promise).resolves.toEqual({ allowed: true, remembered: false });
});

it('does not ask again once a decision is remembered, for either answer', async () => {
  rememberApproval('skill__run_script:demo', true);
  const allowed = ask('skill__run_script:demo');
  // No approval_required event: the whole point is not being asked twice.
  expect(allowed.events).toEqual([]);
  await expect(allowed.promise).resolves.toEqual({ allowed: true, remembered: true });

  rememberApproval('skill__run_script:other', false);
  const denied = ask('skill__run_script:other');
  expect(denied.events).toEqual([]);
  await expect(denied.promise).resolves.toEqual({ allowed: false, remembered: true });
});

it('keys rules per script, so approving one does not approve the others', async () => {
  rememberApproval('skill__run_script:alpha', true);
  const other = ask('skill__run_script:beta');
  expect(other.events).toHaveLength(1);
  const id = (other.events[0]!.data as { requestId: string }).requestId;
  resolveApproval(id, false);
  await expect(other.promise).resolves.toEqual({ allowed: false, remembered: false });
});

it('replaces an earlier rule for the same tool instead of stacking duplicates', async () => {
  rememberApproval('t', true);
  rememberApproval('t', false);
  const rules = readApprovalRules();
  expect(rules).toHaveLength(1);
  expect(rules[0]!.allow).toBe(false);
});

it('forgets a rule, which brings the prompt back', async () => {
  rememberApproval('t', true);
  expect(isRemembered('t')).toBe(true);
  forgetApproval('t');
  expect(isRemembered('t')).toBe(false);
  const again = ask('t');
  expect(again.events).toHaveLength(1);
});

it('ignores malformed stored rules rather than crashing the tool path', async () => {
  const { settingsRepo } = await import('../src/db/repos/settings.js');
  settingsRepo.set('tool.approvalRules', [{ tool: 'ok' }, { nope: 1 }, null, 'string']);
  expect(readApprovalRules().map((r) => r.tool)).toEqual(['ok']);
  // A rule written before the allow field existed counts as an allow.
  const { promise, events } = ask('ok');
  expect(events).toEqual([]);
  await expect(promise).resolves.toEqual({ allowed: true, remembered: true });
});
