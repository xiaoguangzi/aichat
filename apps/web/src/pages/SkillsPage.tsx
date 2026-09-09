import { useEffect, useState } from 'react';
import type { SkillInfo } from '@aichat/shared';
import { RefreshCw, FolderOpen, ScrollText } from 'lucide-react';
import { api } from '../api/client';
import { useSettings } from '../store/settings';
import { Button } from '../components/ui/Button';
import { Toggle } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { Markdown } from '../components/ui/Markdown';

export function SkillsPage() {
  const { skills, skillsDir, skillWarnings, loadSkills } = useSettings();
  const [view, setView] = useState<(SkillInfo & { body: string }) | null>(null);
  useEffect(() => { void loadSkills(); }, [loadSkills]);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight">Skills</h1>
          <p className="text-sm text-zinc-400">Invoke with <code className="font-mono text-xs">/name</code> in chat, or let the model pick one.</p>
        </div>
        <Button onClick={async () => { await api.skills.rescan(); void loadSkills(); }}><RefreshCw size={14} /> Rescan</Button>
      </div>
      <div className="flex items-center gap-2 rounded-xl bg-zinc-200/50 dark:bg-zinc-800/50 px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400"><FolderOpen size={14} className="shrink-0" /> <span className="truncate font-mono">{skillsDir}</span> — each subfolder with a SKILL.md is a skill.</div>
      {skillWarnings.map((w, i) => <div key={i} className="rounded-xl bg-accent-100 dark:bg-accent-950/40 px-3.5 py-2 text-xs text-accent-800 dark:text-accent-300">{w}</div>)}
      {skills.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center">
          <p className="text-sm font-medium text-zinc-500">No skills found</p>
          <p className="mt-1 text-xs text-zinc-400">Drop a folder with a SKILL.md into the skills directory.</p>
        </div>
      )}
      {skills.map((s) => (
        <div key={s.name} className="card p-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-mono font-semibold">/{s.name}</div>
              <div className="truncate text-sm text-zinc-600 dark:text-zinc-400">{s.description || <em>no description</em>}</div>
              <div className="mt-0.5 text-xs text-zinc-400">{s.files.length} files{s.hasScripts ? ' · has scripts' : ''}</div>
            </div>
            {s.hasScripts && <Toggle checked={s.autoApprove} onChange={async (v) => { await api.skills.setAutoApprove(s.name, v); void loadSkills(); }} label="Run scripts without approval" />}
            <Button size="sm" onClick={async () => setView(await api.skills.get(s.name))}><ScrollText size={14} /> View</Button>
          </div>
        </div>
      ))}
      {view && (
        <Modal title={`SKILL.md — ${view.name}`} onClose={() => setView(null)} wide>
          <Markdown text={view.body} />
          {view.files.length > 0 && <div className="mt-4 text-xs text-zinc-500">Files: {view.files.join(', ')}</div>}
        </Modal>
      )}
    </div>
  );
}
