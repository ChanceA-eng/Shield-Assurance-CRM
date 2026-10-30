'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

interface NavContextValue {
  isNavOpen: boolean;
  openNav: () => void;
  closeNav: () => void;
  toggleNav: () => void;
}

const NavContext = createContext<NavContextValue | null>(null);

export function NavProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [isNavOpen, setIsNavOpen] = useState(true);

  // Start collapsed on small screens so the mobile overlay is not open by default.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setIsNavOpen(false);
    }
  }, []);

  const openNav = (): void => setIsNavOpen(true);
  const closeNav = (): void => setIsNavOpen(false);
  const toggleNav = (): void => setIsNavOpen((current) => !current);

  return <NavContext.Provider value={{ isNavOpen, openNav, closeNav, toggleNav }}>{children}</NavContext.Provider>;
}

export function useNav(): NavContextValue {
  const context = useContext(NavContext);

  if (!context) {
    throw new Error('useNav must be used within a NavProvider.');
  }

  return context;
}