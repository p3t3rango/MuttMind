'use client';

import { createContext, useContext } from 'react';

export type MindSummary = { id: string; name: string };

export type MindContextValue = {
  id: string;
  name: string;
  minds: MindSummary[];
};

const MindContext = createContext<MindContextValue | null>(null);

export function MindProvider({ value, children }: { value: MindContextValue; children: React.ReactNode }) {
  return <MindContext.Provider value={value}>{children}</MindContext.Provider>;
}

/** Read the current Mind inside any view rendered by MindShell. */
export function useMind(): MindContextValue {
  const ctx = useContext(MindContext);
  if (!ctx) throw new Error('useMind must be used within MindShell');
  return ctx;
}
