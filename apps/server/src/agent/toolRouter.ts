import type { Block, ChatSSEEvent } from '@aichat/shared';
import { mcpManager } from '../mcp/manager.js';
import { executeSkillTool, isSkillTool } from '../skills/tools.js';
import { skillRegistry } from '../skills/registry.js';
import { rememberApproval, requestApproval } from './approvals.js';
import { READ_RESULT_TOOL, readToolResult } from './toolResults.js';
import { DELEGATE_TOOL, runDelegate, type DelegateRun } from './delegate.js';

export interface ToolContext {
  conversationId: string;
  signal: AbortSignal;
  emit: (ev: ChatSSEEvent) => void | Promise<void>;
  /** Present only when the active model can run a sub-agent; keeps the tool out of other setups. */
  delegate?: DelegateRun;
  /** True when this approval should be written down as a standing rule. */
  rememberApproval?: boolean;
}

export interface ToolOutcome {
  content: Block[];
  isError: boolean;
}

export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    if (name === READ_RESULT_TOOL) return readToolResult(ctx.conversationId, input);
    if (name === DELEGATE_TOOL) {
      if (!ctx.delegate) return { content: [{ type: 'text', text: 'Sub-agents are not available for this model.' }], isError: true };
      return runDelegate(input, ctx.delegate, ctx.signal);
    }
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
          // The remembered rule is keyed by the script actually being run, not by the shared
          // skill__run_script tool: otherwise approving one script would approve every script.
          const ruleKey = `${name}:${skillName}`;
          const decision = await requestApproval({ conversationId: ctx.conversationId, tool: name, ruleKey, input, signal: ctx.signal, emit: ctx.emit });
          if (!decision.allowed) {
            return { content: [{ type: 'text', text: decision.remembered ? 'This script stays denied by a remembered decision (change it in Settings → Skills).' : 'User declined to run this script.' }], isError: true };
          }
          if (ctx.rememberApproval) rememberApproval(ruleKey, true);
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
