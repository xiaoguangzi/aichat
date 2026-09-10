import { useEffect, useId, useState } from 'react';
import type { Message, ToolResultBlock } from '@aichat/shared';
import { ChevronDown, ListTree, Loader2 } from 'lucide-react';
import { sumUsage } from '../../lib/usage.js';
import { cn } from '../../lib/utils.js';
import { MessageItem } from './MessageItem.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { ToolCallCard } from './ToolCallCard.js';
import { ArtifactMessage } from '../artifacts/ArtifactMessage.js';

interface Props {
  messages: Message[];
  streamingId?: string;
  running: boolean;
  results: Record<string, ToolResultBlock>;
  isLastAssistant: boolean;
  onRegenerate: () => void;
  onProcessToggle: () => void;
}

/** A tool loop spans several messages, but shares one process disclosure and footer. */
export function AssistantTurn({ messages, streamingId, running, results, isLastAssistant, onRegenerate, onProcessToggle }: Props) {
  const blocks = messages.flatMap((message, messageIndex) => message.content.map((block, index) => ({
    block,
    index,
    messageIndex,
    messageId: message.id,
    key: `${message.id}:${index}`,
    streaming: message.id === streamingId && index === message.content.length - 1,
  })));
  // Text followed by more reasoning or tools is a progress update, even across
  // model calls. Keep original block indices for artifact references and storage.
  const lastProcessIndex = blocks.reduce((last, { block }, index) =>
    block.type === 'thinking' || block.type === 'tool_use' ? index : last, -1);
  const lastProcessBlock = blocks[lastProcessIndex];
  const process = blocks.filter(({ block, streaming }, index) =>
    block.type === 'tool_use' || (block.type === 'thinking' && (block.thinking.trim() || streaming)) ||
    (block.type === 'text' && index < lastProcessIndex && block.text.trim()),
  );
  const answering = blocks.slice(lastProcessIndex + 1).some(({ block }) => block.type === 'text' && block.text.trim());
  const [open, setOpen] = useState(!answering);
  const detailsId = useId();
  useEffect(() => {
    setOpen(!answering);
  }, [answering]);

  const thinkingCount = process.filter(({ block }) => block.type === 'thinking').length;
  const toolCount = process.filter(({ block }) => block.type === 'tool_use').length;
  const progressCount = process.filter(({ block }) => block.type === 'text').length;
  const failedCount = process.filter(({ block }) => block.type === 'tool_use' && results[block.id]?.is_error).length;
  const counts = [thinkingCount && `${thinkingCount} 次思考`, toolCount && `${toolCount} 次工具调用`, progressCount && `${progressCount} 段过程说明`].filter(Boolean).join(' · ');
  const last = messages.at(-1)!;
  const footerUsage = messages.length > 1 ? sumUsage(messages.map(message => message.usage)) : last.usage;
  const footerText = blocks.flatMap(({ block }) => block.type === 'text' ? [block.text] : []).join('\n');

  return (
    <div>
      {process.length > 0 && (
        <div className="mb-3">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => { onProcessToggle(); setOpen(value => !value); }}
            className="flex max-w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-zinc-500 transition-colors hover:bg-zinc-100/80 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-accent-500"
          >
            {running && !answering ? <Loader2 size={14} className="shrink-0 animate-spin text-accent-500" /> : <ListTree size={14} className="shrink-0" />}
            <span className="shrink-0 font-medium">执行过程</span>
            <span className="min-w-0 text-left text-[11px]">{counts}</span>
            {failedCount > 0 && <span className="shrink-0 text-[11px] text-red-500">{failedCount} 项失败</span>}
            <ChevronDown size={13} className={cn('shrink-0 transition-transform duration-150', open && 'rotate-180')} />
          </button>
          <div id={detailsId} hidden={!open}>
            {open && process.map(({ block, key, streaming, messageId, index }) => block.type === 'thinking'
              ? <ThinkingBlock key={key} text={block.thinking} streaming={streaming} />
              : block.type === 'tool_use' ? <ToolCallCard key={key} call={block} result={results[block.id]} />
                : block.type === 'text' ? <div key={key} className="my-2.5 border-l-2 border-zinc-200 pl-3 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 [&_.prose-chat]:text-[13px] [&_.prose-chat]:leading-6">
                  <ArtifactMessage text={block.text} live={streaming} messageId={messageId} block={index} />
                </div> : null)}
          </div>
        </div>
      )}
      <div className="space-y-2.5">
        {messages.map((message, messageIndex) => {
          const textStartIndex = !lastProcessBlock || messageIndex > lastProcessBlock.messageIndex ? 0
            : messageIndex === lastProcessBlock.messageIndex ? lastProcessBlock.index + 1 : message.content.length;
          const streaming = message.id === streamingId;
          const showFooter = message.id === last.id && !running;
          const hasNotice = ['interrupted', 'max_tokens', 'error'].includes(message.stopReason ?? '');
          if (!showFooter && !hasNotice && !(streaming && message.content.length === 0) &&
            !message.content.some((block, index) => index >= textStartIndex && block.type === 'text' && block.text.trim())) return null;
          return <MessageItem
            key={message.id}
            message={message}
            streaming={streaming}
            results={results}
            hideProcess
            textStartIndex={textStartIndex}
            showFooter={showFooter}
            footerUsage={footerUsage}
            footerText={footerText}
            isLastAssistant={isLastAssistant && message.id === last.id}
            onRegenerate={onRegenerate}
          />;
        })}
      </div>
    </div>
  );
}
