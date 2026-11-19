'use client';

import { createContext, useContext } from 'react';
import type { StaffWorkspace } from '../lib/staff-workspace';
import type { StaffRecordKind } from '../lib/staff-records';

const StaffWorkspaceContext = createContext<StaffWorkspace>('account');
const StaffRecordsContext = createContext<StaffRecordKind[]>([]);
const PolicyAdminContext = createContext(false);
export const useStaffWorkspace = () => useContext(StaffWorkspaceContext);
export const useStaffRecords = () => useContext(StaffRecordsContext);
export const usePolicyAdmin = () => useContext(PolicyAdminContext);

export function StaffWorkspaceProvider({ workspace, records = [], policyAdmin = false, children }: {
  workspace: StaffWorkspace; records?: StaffRecordKind[]; policyAdmin?: boolean; children: React.ReactNode;
}): JSX.Element {
  return <StaffWorkspaceContext.Provider value={workspace}>
    <StaffRecordsContext.Provider value={records}>
      <PolicyAdminContext.Provider value={policyAdmin}>{children}</PolicyAdminContext.Provider>
    </StaffRecordsContext.Provider>
  </StaffWorkspaceContext.Provider>;
}
