import type { UiNode } from '@aichat/shared';

export type VisualBlockKind =
  | 'metrics'
  | 'parameters'
  | 'checks'
  | 'actions'
  | 'standalone';

export interface VisualBlock {
  id: string;
  kind: VisualBlockKind;
  nodes: UiNode[];
}

export const isParameterNode = (node: UiNode): boolean =>
  node.type === 'slider' || node.type === 'number' || node.type === 'select';

/**
 * Composition Engine: converts a flat list of visible UiNodes into structured visual blocks.
 *
 * Principles:
 * 1. Strict sequence: never jump over other nodes to merge.
 * 2. Contiguous grouping: adjacent metrics form a metrics block; adjacent parameters form a grid;
 *    adjacent checks form a check list; adjacent actions form an actions row.
 * 3. Stable identity: block ID inherits the first node's ID to keep React reconciler keys stable
 *    across streaming additions.
 */
export function composeVisualBlocks(nodes: UiNode[]): VisualBlock[] {
  const blocks: VisualBlock[] = [];

  for (const node of nodes) {
    const last = blocks.at(-1);

    if (node.type === 'metric' && last?.kind === 'metrics') {
      last.nodes.push(node);
    } else if (isParameterNode(node) && last?.kind === 'parameters') {
      last.nodes.push(node);
    } else if (node.type === 'check' && last?.kind === 'checks') {
      last.nodes.push(node);
    } else if (node.type === 'action' && last?.kind === 'actions') {
      last.nodes.push(node);
    } else {
      let kind: VisualBlockKind = 'standalone';
      if (node.type === 'metric') kind = 'metrics';
      else if (isParameterNode(node)) kind = 'parameters';
      else if (node.type === 'check') kind = 'checks';
      else if (node.type === 'action') kind = 'actions';

      blocks.push({
        id: node.id,
        kind,
        nodes: [node],
      });
    }
  }

  return blocks;
}
