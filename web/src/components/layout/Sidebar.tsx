import { NavLink, type NavLinkRenderProps } from 'react-router-dom';
import {
  LayoutDashboard, Users, Target, KanbanSquare, BarChart3,
  CheckSquare, Settings, Sparkles, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

const nav = [
  { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/app/customers', label: 'Customers', icon: Users },
  { to: '/app/leads', label: 'Leads', icon: Target },
  { to: '/app/deals', label: 'Deals', icon: KanbanSquare },
  { to: '/app/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
];

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const user = useAuthStore((s) => s.user);

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          'glass-strong fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border transition-transform duration-300 lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between p-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-glow">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight text-foreground">AI-CRM</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Sales OS</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }: NavLinkRenderProps) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                  isActive
                    ? 'bg-gradient-to-r from-primary/20 to-accent/10 text-foreground shadow-glass-sm ring-1 ring-primary/20'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )
              }
            >
              <item.icon className="h-[18px] w-[18px]" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3">
          <NavLink
            to="/app/settings"
            onClick={onClose}
            className={({ isActive }: NavLinkRenderProps) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                isActive ? 'bg-muted/70 text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )
            }
          >
            <Settings className="h-[18px] w-[18px]" />
            Settings
          </NavLink>

          <div className="mt-3 rounded-xl bg-gradient-to-br from-primary/10 to-accent/10 p-3 ring-1 ring-primary/15">
            <p className="text-xs font-semibold text-foreground">{user?.firstName} {user?.lastName}</p>
            <p className="text-[11px] capitalize text-muted-foreground">
              {user?.role.replace('_', ' ').toLowerCase()}
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
