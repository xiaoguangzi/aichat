import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useChat } from '../../store/chat';
import { Button } from '../ui/Button';

export function ApprovalBanner() {
  const approval = useChat((s) => s.approval);
  const resolveApproval = useChat((s) => s.resolveApproval);
  // Opt-in per decision: a permission prompt that silently becomes permanent is how an unattended
  // script ends up running later under arguments nobody looked at.
  const [remember, setRemember] = useState(false);

  if (!approval) return null;

  const decide = (approve: boolean) => {
    void resolveApproval(approve, remember);
    setRemember(false);
  };

  return (
    <div className="fade-in mx-auto mb-3 w-full max-w-3xl rounded-2xl border border-accent-300 dark:border-accent-800/80 bg-accent-50/90 dark:bg-accent-950/40 p-4 text-sm shadow-sm backdrop-blur-xs">
      <div className="flex items-center gap-2 font-semibold text-accent-950 dark:text-accent-200">
        <ShieldAlert size={16} className="text-accent-600 dark:text-accent-400" />
        <span>Permission Request: The model wants to execute a script</span>
      </div>
      <div className="mt-2 text-xs text-accent-800/80 dark:text-accent-300/80">
        Review the tool input before granting permission:
      </div>
      <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-white/80 dark:bg-black/40 p-3 font-mono text-xs text-zinc-800 dark:text-zinc-200 ring-1 ring-accent-200 dark:ring-accent-900/50">
        {JSON.stringify(approval.input, null, 2)}
      </pre>
      <label className="mt-3 flex items-start gap-2 text-[11px] text-accent-900/80 dark:text-accent-300/80">
        <input type="checkbox" className="mt-0.5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>记住这个决定，之后不再询问同一个脚本。可在 <span className="font-medium">设置 → Skills</span> 中取消。</span>
      </label>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" onClick={() => decide(false)}>
          拒绝
        </Button>
        <Button size="sm" variant="primary" onClick={() => decide(true)}>
          允许执行
        </Button>
      </div>
    </div>
  );
}
