import type { Block, ChatSSEEvent } from '@aichat/shared';
import { mcpManager } from '../mcp/manager.js';
import { executeSkillTool, isSkillTool } from '../skills/tools.js';
import { skillRegistry } from '../skills/registry.js';
import { createApproval } from './approvals.js';
import { READ_RESULT_TOOL, readToolResult } from './toolResults.js';

export interface ToolContext {
  conversationId: string;
  signal: AbortSignal;
  emit: (ev: ChatSSEEvent) => void | Promise<void>;
}

export interface ToolOutcome {
  content: Block[];
  isError: boolean;
}

export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    if (name === READ_RESULT_TOOL) return readToolResult(ctx.conversationId, input);
    if (name.startsWith('mcp__')) {
      const r = await mcpManager.callTool(name, input, ctx.signal);
      return r;
    }
    if (isSkillTool(name)) {
      if (name === 'skill__run_script') {
        const skillName = String((input as { name?: string })?.name ?? '');
        const skill = skillRegistry.get(skillName);
        if (!skill) return { content: [{ type: 'text', text: `skill not found: ${skillName}` }], isError: true };
        if (!skill.autoApprove) {
          const { id, promise } = createApproval(ctx.conversationId, name, ctx.signal);
          await ctx.emit({ event: 'approval_required', data: { requestId: id, tool: name, input } });
          const ok = await promise;
          if (!ok) return { content: [{ type: 'text', text: 'User declined to run this script.' }], isError: true };
        }
      }
      const r = await executeSkillTool(name, input, ctx.signal);
      return r;
    }
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  } catch (e) {
    if (ctx.signal.aborted) return { content: [{ type: 'text', text: 'Cancelled.' }], isError: true };
    return { content: [{ type: 'text', text: `Tool error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
}
