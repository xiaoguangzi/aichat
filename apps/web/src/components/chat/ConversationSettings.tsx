import { useEffect, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import type { ConversationSettings as CS } from '@aichat/shared';
import { useChat } from '../../store/chat';
import { useSettings } from '../../store/settings';
import { Field, Input, Textarea, Toggle } from '../ui/Field';
import { Button } from '../ui/Button';

export function ConversationSettingsPanel({ onClose }: { onClose: () => void }) {
  const current = useChat((s) => s.current);
  const draftSystemPrompt = useChat((s) => s.draftSystemPrompt);
  const draftSettings = useChat((s) => s.draftSettings);
  const setDraftSystemPrompt = useChat((s) => s.setDraftSystemPrompt);
  const setDraftSettings = useChat((s) => s.setDraftSettings);
  const updateConversation = useChat((s) => s.updateConversation);
  const { mcpServers, skills } = useSettings();

  const [system, setSystem] = useState(current ? (current.systemPrompt ?? '') : draftSystemPrompt);
  const [s, setS] = useState<CS>(current ? (current.settings ?? {}) : draftSettings);

  useEffect(() => {
    if (current) {
      setSystem(current.systemPrompt ?? '');
      setS(current.settings ?? {});
    } else {
      setSystem(draftSystemPrompt);
      setS(draftSettings);
    }
  }, [current?.id]);

  const listOf = (v: string[] | 'all' | undefined, all: string[]) => (v === undefined || v === 'all' ? all : v);
  const toggleIn = (key: 'enabledMcpServers' | 'enabledSkills', all: string[], name: string) => {
    const cur = listOf(s[key], all);
    const next = cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name];
    setS({ ...s, [key]: next.length === all.length ? 'all' : next });
  };

  const handleSave = async () => {
    if (current) {
      await updateConversation(current.id, { systemPrompt: system, settings: s });
    } else {
      setDraftSystemPrompt(system);
      setDraftSettings(s);
    }
    onClose();
  };

  return (
    <div className="flex h-full w-84 shrink-0 flex-col border-l border-zinc-200/80 dark:border-zinc-800/80 bg-white/95 dark:bg-[#0c0d14]/95 backdrop-blur-md p-5 text-sm z-10 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          <SlidersHorizontal size={15} className="text-accent-500" />
          <span>Conversation settings</span>
          {!current && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-accent-500/10 text-accent-600 dark:text-accent-400">
              New chat
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        <Field
          label="System prompt"
          hint={current ? 'Overrides default prompt for this conversation' : 'Applied when new conversation starts'}
        >
          <Textarea
            rows={5}
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            placeholder="Custom instructions for the assistant…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Temperature" hint="0.0 - 2.0 (empty = default)">
            <Input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={s.temperature ?? ''}
              onChange={(e) => setS({ ...s, temperature: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="Default"
            />
          </Field>
          <Field label="Max tokens" hint="empty = model limit">
            <Input
              type="number"
              min="1"
              value={s.maxTokens ?? ''}
              onChange={(e) => setS({ ...s, maxTokens: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="Default"
            />
          </Field>
        </div>

        <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 p-3.5 space-y-2">
          <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">MCP Servers</div>
          {mcpServers.length === 0 && <div className="text-xs text-zinc-400">No servers configured</div>}
          {mcpServers.map((m) => (
            <div key={m.id} className="py-0.5">
              <Toggle
                checked={listOf(s.enabledMcpServers, mcpServers.map((x) => x.name)).includes(m.name)}
                onChange={() => toggleIn('enabledMcpServers', mcpServers.map((x) => x.name), m.name)}
                label={`${m.name} (${m.status})`}
              />
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 p-3.5 space-y-2">
          <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Skills</div>
          {skills.length === 0 && <div className="text-xs text-zinc-400">No skills found</div>}
          {skills.map((sk) => (
            <div key={sk.name} className="py-0.5">
              <Toggle
                checked={listOf(s.enabledSkills, skills.map((x) => x.name)).includes(sk.name)}
                onChange={() => toggleIn('enabledSkills', skills.map((x) => x.name), sk.name)}
                label={sk.name}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2 border-t border-zinc-100 dark:border-zinc-800 pt-3">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={() => void handleSave()}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
