import { Fragment, createContext, useContext, type ReactNode } from 'react';

/** Shared state and helpers for the company panel's folded blocks (CompanyBlocks.tsx). */

export interface BlockNav {
  isOpen: (id: string) => boolean;
  setOpen: (id: string, open: boolean) => void;
  /** Open a block and bring it into view. */
  reveal: (id: string) => void;
}

export const BlockNavContext = createContext<BlockNav | null>(null);

/** The block controls; outside a provider every block works on its own state. */
export function useBlockNav(): BlockNav | null {
  return useContext(BlockNavContext);
}

export const blockDomId = (id: string) => `company-block-${id}`;

/** A translated template with each {key} replaced by a node, so a number can carry its own style. */
export function fill(template: string, values: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in values ? <Fragment key={i}>{values[m[1]]}</Fragment> : part;
  });
}

