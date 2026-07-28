import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Sparkles, Mail, Lock, ArrowRight, User } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/store/authStore';
import { getApiErrorMessage } from '@/lib/api';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
const registerSchema = z.object({
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  email: z.string().email('Enter a valid email'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[a-z]/, 'Must contain a lowercase letter')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a digit'),
});
type LoginForm = z.infer<typeof loginSchema>;
type RegisterForm = z.infer<typeof registerSchema>;

const demoAccounts = [
  { label: 'Admin', email: 'admin@crm.dev' },
  { label: 'Manager', email: 'manager@crm.dev' },
  { label: 'Employee', email: 'sam@crm.dev' },
];

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [serverError, setServerError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/app/dashboard';

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: 'admin@crm.dev', password: 'Password123!' },
  });
  const registerForm = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const submitLogin = loginForm.handleSubmit(async (values) => {
    setServerError('');
    try {
      await login(values.email, values.password);
      navigate(from, { replace: true });
    } catch (e) {
      setServerError(getApiErrorMessage(e, 'Login failed'));
    }
  });

  const submitRegister = registerForm.handleSubmit(async (values) => {
    setServerError('');
    try {
      await register(values);
      navigate('/app/dashboard', { replace: true });
    } catch (e) {
      setServerError(getApiErrorMessage(e, 'Registration failed'));
    }
  });

  const fillDemo = (email: string) => {
    loginForm.setValue('email', email);
    loginForm.setValue('password', 'Password123!');
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Link to="/" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent shadow-glow">
            <Sparkles className="h-6 w-6 text-white" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {mode === 'login' ? 'Welcome back' : 'Create your account'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === 'login' ? 'Sign in to your AI-CRM workspace' : 'Start managing customers in minutes'}
            </p>
          </div>
        </div>

        <div className="glass-strong rounded-2xl p-6 shadow-glass">
          {serverError && (
            <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {serverError}
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={submitLogin} noValidate className="space-y-4">
              <Input
                label="Email"
                type="email"
                icon={<Mail className="h-4 w-4" />}
                placeholder="you@company.com"
                error={loginForm.formState.errors.email?.message}
                {...loginForm.register('email')}
              />
              <Input
                label="Password"
                type="password"
                icon={<Lock className="h-4 w-4" />}
                placeholder="••••••••"
                error={loginForm.formState.errors.password?.message}
                {...loginForm.register('password')}
              />
              <Button type="submit" className="w-full" loading={loginForm.formState.isSubmitting}>
                Sign in <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          ) : (
            <form onSubmit={submitRegister} noValidate className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input label="First name" icon={<User className="h-4 w-4" />} error={registerForm.formState.errors.firstName?.message} {...registerForm.register('firstName')} />
                <Input label="Last name" error={registerForm.formState.errors.lastName?.message} {...registerForm.register('lastName')} />
              </div>
              <Input label="Email" type="email" icon={<Mail className="h-4 w-4" />} error={registerForm.formState.errors.email?.message} {...registerForm.register('email')} />
              <Input label="Password" type="password" icon={<Lock className="h-4 w-4" />} hint="Minimum 8 characters" error={registerForm.formState.errors.password?.message} {...registerForm.register('password')} />
              <Button type="submit" className="w-full" loading={registerForm.formState.isSubmitting}>
                Create account <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          )}

          {mode === 'login' && (
            <div className="mt-5 border-t border-border pt-4">
              <p className="mb-2 text-center text-xs text-muted-foreground">Quick demo login</p>
              <div className="flex justify-center gap-2">
                {demoAccounts.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    onClick={() => fillDemo(a.email)}
                    className="rounded-lg border border-border bg-card/50 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="mt-5 text-center text-sm text-muted-foreground">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setServerError(''); }}
              className="font-medium text-primary hover:underline"
            >
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
