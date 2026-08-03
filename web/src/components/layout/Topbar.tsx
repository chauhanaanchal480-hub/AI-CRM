import { useNavigate } from 'react-router-dom';
import { Menu, Moon, Sun, Bell, LogOut, User as UserIcon, Check } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import { Avatar } from '@/components/ui/Avatar';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { Badge } from '@/components/ui/Badge';
import { useNotifications, useMarkAllRead } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { theme, toggleTheme } = useThemeStore();
  const { data } = useNotifications();
  const markAll = useMarkAllRead();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="glass sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border px-4 lg:px-6">
      <button onClick={onMenuClick} className="rounded-lg p-2 text-muted-foreground hover:bg-muted lg:hidden">
        <Menu className="h-5 w-5" />
      </button>

      <div className="hidden lg:block">
        <p className="text-sm text-muted-foreground">
          Welcome back, <span className="font-semibold text-foreground">{user?.firstName}</span> 👋
        </p>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={toggleTheme}
          className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        {/* Notifications */}
        <Dropdown
          align="right"
          className="w-80"
          trigger={
            <button className="relative rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Bell className="h-5 w-5" />
              {data && data.unread > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                  {data.unread}
                </span>
              )}
            </button>
          }
        >
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            {data && data.unread > 0 && (
              <button
                onClick={() => markAll.mutate()}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Check className="h-3 w-3" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!data?.items.length ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications</p>
            ) : (
              data.items.slice(0, 8).map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    'flex flex-col gap-0.5 rounded-lg px-3 py-2 text-left',
                    !n.read && 'bg-primary/5',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                  </div>
                  {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                  <p className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </p>
                </div>
              ))
            )}
          </div>
        </Dropdown>

        {/* User menu */}
        <Dropdown
          align="right"
          trigger={
            <button
              aria-label="Open user menu"
              className="ml-1 flex items-center gap-2 rounded-xl p-1 transition-colors hover:bg-muted"
            >
              <Avatar firstName={user?.firstName} lastName={user?.lastName} src={user?.avatarUrl} size="sm" />
            </button>
          }
        >
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-semibold text-foreground">{user?.firstName} {user?.lastName}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            <Badge tone="primary" className="mt-1.5 capitalize">
              {user?.role.replace('_', ' ').toLowerCase()}
            </Badge>
          </div>
          <DropdownItem icon={<UserIcon className="h-4 w-4" />} onClick={() => navigate('/app/profile')}>
            My Profile
          </DropdownItem>
          <DropdownItem icon={<LogOut className="h-4 w-4" />} danger onClick={handleLogout}>
            Sign out
          </DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}
