import { AccountWorkspaceProvider } from './account-workspace-context';

export default function AccountWorkspaceLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return <AccountWorkspaceProvider>{children}</AccountWorkspaceProvider>;
}
