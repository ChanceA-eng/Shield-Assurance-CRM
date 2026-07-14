import type { ReactNode } from 'react';

type ModuleLayoutProps = {
  children: ReactNode;
};

export default function ModuleLayout({ children }: ModuleLayoutProps): JSX.Element {
  return <>{children}</>;
}
