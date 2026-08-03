import { useEffect, useState } from 'react';
import { Moon, Sun, Monitor, ShieldCheck, Users as UsersIcon, KeyRound, Laptop, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { useThemeStore } from '@/store/themeStore';
import { useAuthStore } from '@/store/authStore';
import { useUsers, useUpdateUserRole } from '@/hooks/useUsers';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api, getApiErrorMessage } from '@/lib/api';

const roleOptions = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'SALES_MANAGER', label: 'Sales Manager' },
  { value: 'EMPLOYEE', label: 'Employee' },
];

export default function SettingsPage() {
  const { theme, setTheme } = useThemeStore();
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'ADMIN';

  return (
    <div>
      <PageHeader title="Settings" description="Manage your workspace preferences." />

      <div className="space-y-6">
        {/* Appearance */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Choose how AI-CRM looks to you.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {([
                { key: 'light', label: 'Light', icon: Sun },
                { key: 'dark', label: 'Dark', icon: Moon },
              ] as const).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setTheme(opt.key)}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all ${
                    theme === opt.key
                      ? 'border-primary bg-primary/10 text-foreground shadow-glass-sm'
                      : 'border-border text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  <opt.icon className="h-4 w-4" /> {opt.label}
                </button>
              ))}
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                <Monitor className="h-4 w-4" /> Respects your saved choice
              </div>
            </div>
          </CardContent>
        </Card>

        <MfaSecurity />

        {/* Team management — admin only */}
        {isAdmin && <TeamManagement />}

        {/* About */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>About</CardTitle>
              <CardDescription>AI-CRM · v1.0.0</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              A production-ready CRM built with React, TypeScript, Node/Express and PostgreSQL.
              Role-based access is enforced end-to-end across {roleOptions.length} roles.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface MfaStatus {
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  recoveryCodesRemaining: number;
  trustedDevices: number;
}

interface TrustedDevice {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

function MfaSecurity() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<{ secret: string; provisioningUri: string } | null>(null);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSecurity = async () => {
    const [statusResponse, devicesResponse] = await Promise.all([
      api.get<{ data: MfaStatus }>('/auth/mfa/status'),
      api.get<{ data: TrustedDevice[] }>('/auth/trusted-devices'),
    ]);
    setStatus(statusResponse.data.data);
    setTrustedDevices(devicesResponse.data.data);
  };

  useEffect(() => {
    void loadSecurity().catch((cause) => setError(getApiErrorMessage(cause, 'Unable to load security settings')));
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Security change failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Multi-factor authentication</CardTitle>
          <CardDescription>Protect sign-in with a TOTP authenticator, recovery codes, and trusted devices.</CardDescription>
        </div>
        <Badge tone={status?.mfaEnabled ? 'success' : 'default'}>
          {status?.mfaEnabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        {!status ? (
          <CardSkeleton />
        ) : status.mfaEnabled ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {status.recoveryCodesRemaining} recovery codes remaining · {status.trustedDevices} trusted devices
            </p>
            {recoveryCodes.length > 0 && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 p-3">
                <p className="mb-2 text-sm font-medium text-foreground">Save these one-time recovery codes now.</p>
                <div className="grid grid-cols-2 gap-1 font-mono text-sm text-foreground">
                  {recoveryCodes.map((recoveryCode) => (
                    <span data-testid="mfa-recovery-code" key={recoveryCode}>{recoveryCode}</span>
                  ))}
                </div>
              </div>
            )}
            <Input
              id="mfa-current-code"
              label="Current authentication code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              placeholder="123456 or recovery code"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                loading={busy}
                disabled={!code}
                onClick={() => void run(async () => {
                  const response = await api.post<{ data: { recoveryCodes: string[] } }>('/auth/mfa/recovery-codes', { code });
                  setRecoveryCodes(response.data.data.recoveryCodes);
                  setCode('');
                  await loadSecurity();
                })}
              >
                Generate new recovery codes
              </Button>
              <Button
                variant="danger"
                loading={busy}
                disabled={!code}
                onClick={() => void run(async () => {
                  await api.post('/auth/mfa/disable', { code });
                  setCode('');
                  setRecoveryCodes([]);
                  setTrustedDevices([]);
                  useAuthStore.setState((state) => ({
                    user: state.user ? { ...state.user, mfaEnabled: false, mfaEnabledAt: null } : null,
                  }));
                  await loadSecurity();
                })}
              >
                Disable MFA
              </Button>
            </div>
            <div className="border-t border-border pt-4">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Laptop className="h-4 w-4" /> Trusted devices
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Trusted devices can skip MFA unless a login is assessed as high risk.
              </p>
              {trustedDevices.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  No trusted devices.
                </p>
              ) : (
                <div className="space-y-2">
                  {trustedDevices.map((device) => (
                    <div
                      data-testid="trusted-device"
                      key={device.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{device.label}</p>
                        <p className="text-xs text-muted-foreground">
                          Last used {formatDistanceToNow(new Date(device.lastUsedAt), { addSuffix: true })}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        loading={busy}
                        aria-label={`Revoke ${device.label}`}
                        onClick={() => void run(async () => {
                          await api.delete(`/auth/trusted-devices/${device.id}`);
                          await loadSecurity();
                        })}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Revoke
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : setup ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Scan the URI with your authenticator or enter this secret manually.</p>
            <p data-testid="mfa-secret" className="break-all rounded-lg bg-muted px-3 py-2 font-mono text-sm text-foreground">{setup.secret}</p>
            <p className="break-all text-xs text-muted-foreground">{setup.provisioningUri}</p>
            <Input
              id="mfa-setup-code"
              label="Authentication code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              placeholder="123456"
            />
            <Button
              loading={busy}
              disabled={!/^\d{6}$/.test(code)}
              onClick={() => void run(async () => {
                const response = await api.post<{ data: { recoveryCodes: string[] } }>('/auth/mfa/enable', { code });
                setRecoveryCodes(response.data.data.recoveryCodes);
                setSetup(null);
                setCode('');
                useAuthStore.setState((state) => ({
                  user: state.user ? { ...state.user, mfaEnabled: true, mfaEnabledAt: new Date().toISOString() } : null,
                }));
                await loadSecurity();
              })}
            >
              Verify and enable MFA
            </Button>
          </div>
        ) : (
          <Button
            loading={busy}
            onClick={() => void run(async () => {
              const response = await api.post<{ data: { secret: string; provisioningUri: string } }>('/auth/mfa/setup');
              setSetup(response.data.data);
            })}
          >
            Set up authenticator
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function TeamManagement() {
  const { data: users, isLoading } = useUsers();
  const updateRole = useUpdateUserRole();
  const me = useAuthStore((s) => s.user);
  const [savingId, setSavingId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Team & roles</CardTitle>
          <CardDescription>Manage roles for members of your workspace.</CardDescription>
        </div>
        <Badge tone="primary"><UsersIcon className="h-3 w-3" /> {users?.length ?? 0} members</Badge>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <CardSkeleton />
        ) : (
          <div className="divide-y divide-border">
            {users?.map((u) => (
              <div key={u.id} className="flex items-center gap-3 py-3">
                <Avatar firstName={u.firstName} lastName={u.lastName} src={u.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {u.firstName} {u.lastName} {u.id === me?.id && <span className="text-xs text-muted-foreground">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
                <Select
                  options={roleOptions}
                  value={u.role}
                  disabled={u.id === me?.id || (savingId === u.id && updateRole.isPending)}
                  onChange={async (e) => {
                    setSavingId(u.id);
                    await updateRole.mutateAsync({ id: u.id, role: e.target.value });
                    setSavingId(null);
                  }}
                  className="w-44"
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
