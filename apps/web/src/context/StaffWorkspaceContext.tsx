'use client';

import { createContext, useContext } from 'react';
import type { StaffWorkspace } from '../lib/staff-workspace';
import type { StaffRecordKind } from '../lib/staff-records';
import type { RequestAccess } from '../lib/team-request-access';

const StaffWorkspaceContext = createContext<StaffWorkspace>('account');
const StaffRecordsContext = createContext<StaffRecordKind[]>([]);
const PolicyAdminContext = createContext(false);
const TeamManagerContext = createContext(false);
const StaffTrainingContext = createContext(false);
const StaffAccessContext = createContext<RequestAccess>({ mode: 'restricted', grants: {} });
export const useStaffWorkspace = () => useContext(StaffWorkspaceContext);
export const useStaffRecords = () => useContext(StaffRecordsContext);
export const usePolicyAdmin = () => useContext(PolicyAdminContext);
export const useTeamManager = () => useContext(TeamManagerContext);
export const useStaffTraining = () => useContext(StaffTrainingContext);
export const useStaffAccess = () => useContext(StaffAccessContext);

export function StaffWorkspaceProvider({ workspace, records = [], policyAdmin = false, teamManager = false, training = false,
  access = { mode: 'restricted', grants: {} }, children }: {
  workspace: StaffWorkspace; records?: StaffRecordKind[]; policyAdmin?: boolean; teamManager?: boolean; training?: boolean;
  access?: RequestAccess; children: React.ReactNode;
}): JSX.Element {
  return <StaffWorkspaceContext.Provider value={workspace}>
    <StaffRecordsContext.Provider value={records}>
      <StaffAccessContext.Provider value={access}><TeamManagerContext.Provider value={teamManager}><StaffTrainingContext.Provider value={training}><PolicyAdminContext.Provider value={policyAdmin}>{children}</PolicyAdminContext.Provider></StaffTrainingContext.Provider></TeamManagerContext.Provider></StaffAccessContext.Provider>
    </StaffRecordsContext.Provider>
  </StaffWorkspaceContext.Provider>;
}
