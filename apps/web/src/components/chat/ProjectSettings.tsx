import { useEffect, useState } from 'react';
import type { ConversationGroup, GroupPatch } from '@aichat/shared';
import { api } from '../../api/client';
import { useChat } from '../../store/chat';
import { useAllModels } from '../../store/settings';
import { Button } from '../ui/Button';
import { Field, Input, Select, Textarea } from '../ui/Field';
import { REASONING_LEVELS } from '@aichat/shared';

/**
 * Project defaults for a group. Editing here changes what the *next* conversation in this project
 * starts with; conversations already in it keep their own settings, so a change cannot silently
 * rewrite the setup someone is in the middle of using.
 */
export function ProjectSettings({ group, onClose }: { group: ConversationGroup; onClose: () => void }) {
  const models = useAllModels();
  const loadGroups = useChat((s) => s.loadGroups);
  const [form, setForm] = useState<GroupPatch>({
    instructions: group.instructions,
    modelId: group.modelId,
    settings: { ...group.settings },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = (next: GroupPatch) => { setForm((cur) => ({ ...cur, ...next })); setStatus(''); };

  const save = async () => {
    setBusy(true); setError(''); setStatus('');
    try {
      await api.groups.update(group.id, form);
      await loadGroups();
      setStatus('已保存，新建到该项目的会话将使用这些设置。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const settings = form.settings ?? {};

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh] backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`项目设置：${group.name}`}
        className="card max-h-[80vh] w-full max-w-xl overflow-y-auto p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">项目设置 · {group.name}</h2>
        <p className="mt-1 text-[11px] leading-4 text-zinc-500">
          只影响之后在该项目中新建的会话；已有会话保持各自当前的模型与设置。项目指令每次请求都会参与 system prompt，
          因此修改后对已有会话立即生效。
        </p>

        <div className="mt-4 space-y-4">
          <Field label="项目指令" hint="追加到该组会话的 system prompt 之前。留空表示不加任何内容。">
            <Textarea
              aria-label="项目指令"
              rows={4}
              value={form.instructions ?? ''}
              onChange={(e) => patch({ instructions: e.target.value })}
              placeholder="例如：本项目的回答一律使用中文，并给出可执行的命令。"
            />
          </Field>

          <Field label="默认模型" hint="新建会话时预选；留空跟随应用默认模型。">
            <Select aria-label="默认模型" value={form.modelId ?? ''} onChange={(e) => patch({ modelId: e.target.value || null })}>
              <option value="">跟随应用默认模型</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.providerName} / {m.displayName}</option>)}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="温度" hint="留空跟随模型/接口默认。">
              <Input
                aria-label="温度"
                inputMode="decimal"
                value={settings.temperature ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  patch({ settings: { ...settings, temperature: raw === '' ? null : Number(raw) } });
                }}
                placeholder="0 – 2"
              />
            </Field>
            <Field label="思考 effort" hint="留空跟随输入框当前选择。">
              <Select
                aria-label="思考 effort"
                value={settings.reasoning ?? ''}
                onChange={(e) => patch({ settings: { ...settings, reasoning: (e.target.value || null) as never } })}
              >
                <option value="">跟随当前选择</option>
                {REASONING_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="MCP 服务器" hint="留空表示全部可用；填了则只启用列出的服务器。">
              <Input
                aria-label="MCP 服务器"
                value={Array.isArray(settings.enabledMcpServers) ? settings.enabledMcpServers.join(', ') : ''}
                onChange={(e) => {
                  const names = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
                  patch({ settings: { ...settings, enabledMcpServers: names.length ? names : undefined } });
                }}
                placeholder="全部"
              />
            </Field>
            <Field label="Skills" hint="留空表示全部可用；填了则只启用列出的技能。">
              <Input
                aria-label="Skills"
                value={Array.isArray(settings.enabledSkills) ? settings.enabledSkills.join(', ') : ''}
                onChange={(e) => {
                  const names = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
                  patch({ settings: { ...settings, enabledSkills: names.length ? names : undefined } });
                }}
                placeholder="全部"
              />
            </Field>
          </div>
        </div>

        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
        {status && <p role="status" className="mt-4 text-sm text-accent-600">{status}</p>}

        <div className="mt-5 flex items-center justify-end gap-3">
          <Button onClick={onClose}>关闭</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存项目设置'}</Button>
        </div>
      </div>
    </div>
  );
}
