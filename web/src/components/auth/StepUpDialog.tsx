import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { api, getApiErrorMessage, setStepUpHandler } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

interface PendingVerification {
  resolve: () => void;
  reject: (reason: Error) => void;
}

export function StepUpDialog() {
  const userMfaEnabled = useAuthStore((state) => Boolean(state.user?.mfaEnabled));
  const [open, setOpen] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(userMfaEnabled);
  const [credential, setCredential] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<PendingVerification | null>(null);

  const requestVerification = useCallback(async () => {
    let requiresMfa = userMfaEnabled;
    try {
      const response = await api.get<{ data: { mfaEnabled: boolean } }>('/auth/mfa/status');
      requiresMfa = response.data.data.mfaEnabled;
    } catch {
      // The authenticated user snapshot is a safe fallback if status refresh fails.
    }
    setMfaEnabled(requiresMfa);
    setCredential('');
    setError('');
    setOpen(true);
    return new Promise<void>((resolve, reject) => {
      pending.current = { resolve, reject };
    });
  }, [userMfaEnabled]);

  useEffect(() => {
    setStepUpHandler(requestVerification);
    return () => setStepUpHandler(null);
  }, [requestVerification]);

  const close = useCallback(() => {
    if (busy) return;
    pending.current?.reject(new Error('Step-up authentication cancelled'));
    pending.current = null;
    setOpen(false);
    setCredential('');
    setError('');
  }, [busy]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!credential.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/step-up', mfaEnabled
        ? { code: credential.trim() }
        : { password: credential });
      pending.current?.resolve();
      pending.current = null;
      setOpen(false);
      setCredential('');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Verification failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Verify sensitive action"
      description="Confirm your identity before this security-sensitive request continues."
      size="sm"
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4 pb-3">
        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Input
          id="step-up-credential"
          label={mfaEnabled ? 'Authentication code' : 'Current password'}
          type={mfaEnabled ? 'text' : 'password'}
          value={credential}
          onChange={(event) => setCredential(event.target.value)}
          autoComplete={mfaEnabled ? 'one-time-code' : 'current-password'}
          icon={<ShieldCheck className="h-4 w-4" />}
          placeholder={mfaEnabled ? '123456 or recovery code' : 'Enter your current password'}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!credential.trim()}>Verify and continue</Button>
        </div>
      </form>
    </Modal>
  );
}
