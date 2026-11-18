import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { MaterialIcon } from './MaterialIcon';
import { TopBar } from './TopBar';
import { t, type TranslationKey } from '../i18n/translations';

export interface WorkspaceLink {
  to: string;
  label: TranslationKey;
  icon: string;
}

interface WorkspaceLayoutProps {
  title: string;
  storeName?: string;
  links: WorkspaceLink[];
  children: ReactNode;
}

export function WorkspaceLayout({ title, storeName, links, children }: WorkspaceLayoutProps) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-surface pb-6">
      <TopBar title={title} storeName={storeName} onProfileClick={() => navigate('/settings')} />
      <nav aria-label="Workspace navigation" className="scrollbar-hidden sticky top-16 z-20 flex gap-2 overflow-x-auto border-b border-outline-variant bg-surface/95 px-3 py-2 backdrop-blur-xl">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => `inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 font-body text-label-md transition ${
              isActive ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant'
            }`}
          >
            <MaterialIcon name={link.icon} className="text-lg" />
            {t(link.label)}
          </NavLink>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-5xl px-4 py-5">{children}</main>
    </div>
  );
}
