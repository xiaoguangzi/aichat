import { ShieldAlert } from 'lucide-react';
import { useChat } from '../../store/chat';
import { Button } from '../ui/Button';

export function ApprovalBanner() {
  const approval = useChat((s) => s.approval);
  const resolveApproval = useChat((s) => s.resolveApproval);

  if (!approval) return null;

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
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" onClick={() => void resolveApproval(false)}>
          Deny
        </Button>
        <Button size="sm" variant="primary" onClick={() => void resolveApproval(true)}>
          Allow Execution
        </Button>
      </div>
    </div>
  );
}
