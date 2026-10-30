'use client';

import { createContext, useContext, useMemo, useState } from 'react';

export type AccountTab =
  | 'overview'
  | 'policies'
  | 'details'
  | 'submissions'
  | 'quotes'
  | 'leadInfo'
  | 'documents'
  | 'certificates'
  | 'claims'
  | 'endorsements'
  | 'notesTasks'
  | 'accounting'
  | 'activity'
  | 'insights'
  | 'tags';

export const AccountWorkspaceContext = createContext<{
  activeTab: AccountTab;
  setActiveTab: (tab: AccountTab) => void;
} | null>(null);

export function useAccountWorkspaceTab(): { activeTab: AccountTab; setActiveTab: (tab: AccountTab) => void } {
  const context = useContext(AccountWorkspaceContext);

  if (!context) {
    throw new Error('useAccountWorkspaceTab must be used inside an AccountWorkspaceLayout');
  }

  return context;
}

export function AccountWorkspaceProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [activeTab, setActiveTab] = useState<AccountTab>('overview');
  const contextValue = useMemo(() => ({ activeTab, setActiveTab }), [activeTab]);

  return <AccountWorkspaceContext.Provider value={contextValue}>{children}</AccountWorkspaceContext.Provider>;
}
