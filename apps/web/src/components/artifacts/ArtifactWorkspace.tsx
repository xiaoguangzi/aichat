import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { collectArtifacts, type ArtifactEdit, type ArtifactVersion } from '@aichat/shared';
import { useChat } from '../../store/chat.js';
import { api } from '../../api/client.js';
import { ArtifactPanel } from './ArtifactPanel.js';

const Context = createContext<{ open: (key: string) => void; versions: ArtifactVersion[] }>({ open: () => {}, versions: [] });
export const useArtifacts = () => useContext(Context);

/** Keyed by conversation so drafts, pending saves and selection never leak across chats. */
export function ArtifactWorkspace({ children, conversationId }: { children: ReactNode; conversationId?: string }) {
  const messages = useChat(s => s.messages);
  const streaming = useChat(s => s.streaming);
  const [edits, setEdits] = useState<ArtifactEdit[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const dirty = useRef(false);
  const [switchError, setSwitchError] = useState('');
  const choose = (key: string | null) => {
    if (dirty.current) { setSwitchError('请先保存修改或取消编辑，再切换作品。'); return; }
    setSwitchError('');
    setSelectedKey(key);
  };
  const onDirty = useCallback((value: boolean) => { dirty.current = value; if (!value) setSwitchError(''); }, []);
  const seen = useRef(new Set<string>());
  const persisted = useMemo(() => collectArtifacts(messages.filter(m => m.conversationId === conversationId)), [messages, conversationId]);
  const live = useMemo(() => collectArtifacts(streaming && streaming.conversationId === conversationId && !messages.some(m => m.id === streaming.id) ? [streaming] : []), [streaming, messages, conversationId]);
  const generated = useMemo(() => [...persisted, ...live], [persisted, live]);
  const versions = useMemo(() => {
    const manual = edits.flatMap(edit => {
      const source = generated.find(a => a.id === edit.artifactId && a.messageId === edit.messageId);
      return source ? [{ ...source, code: edit.code, key: edit.id, createdAt: edit.createdAt, edited: true }] : [];
    });
    return [...generated, ...manual].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [generated, edits]);
  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    void api.artifacts.list(conversationId).then(value => { if (active) setEdits(prev => [...new Map([...value, ...prev].map(edit => [edit.id, edit])).values()]); })
      .catch(e => { if (active) setLoadError(`历史编辑加载失败：${String(e)}`); });
    return () => { active = false; };
  }, [conversationId]);
  useEffect(() => {
    for (const artifact of generated) {
      if (seen.current.has(artifact.key)) continue;
      seen.current.add(artifact.key);
      if (artifact.messageId === streaming?.id && !dirty.current) setSelectedKey(artifact.key);
    }
  }, [generated, streaming?.id]);
  const selected = versions.find(a => a.key === selectedKey);
  return <Context.Provider value={{ open: choose, versions }}>
    <div className="flex min-w-0 flex-1">
    {children}
    {selected && <ArtifactPanel key={selected.key} artifact={selected} versions={versions.filter(a => a.id === selected.id)}
      loadError={switchError || loadError} onDirty={onDirty} onSelect={choose} onClose={() => setSelectedKey(null)}
      onSave={async code => {
        if (!conversationId) throw new Error('请先保存会话');
        const edit = await api.artifacts.save(conversationId, { messageId: selected.messageId, artifactId: selected.id, code });
        dirty.current = false;
        setEdits(prev => [...prev, edit]);
        setSelectedKey(edit.id);
      }} />}
    </div>
  </Context.Provider>;
}
