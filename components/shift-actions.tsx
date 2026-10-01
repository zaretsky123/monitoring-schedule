"use client";

import { ContextMenu } from "radix-ui";
import type { ReactNode } from "react";

export function ShiftActions({ children, actions, disabled = false }: {
  children: ReactNode;
  actions: { label: string; onSelect: () => void; destructive?: boolean }[];
  disabled?: boolean;
}) {
  if (disabled || !actions.length) return children;
  return <ContextMenu.Root><ContextMenu.Trigger asChild><span className="shift-action-wrap">{children}</span></ContextMenu.Trigger><ContextMenu.Portal><ContextMenu.Content className="shift-context-menu">{actions.map((action) => <ContextMenu.Item className={action.destructive ? "shift-context-danger" : undefined} key={action.label} onSelect={action.onSelect}>{action.label}</ContextMenu.Item>)}</ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>;
}
