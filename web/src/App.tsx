import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { setUnauthorizedHandler } from '@/lib/api';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute, PublicOnlyRoute } from '@/routes/ProtectedRoute';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { StepUpDialog } from '@/components/auth/StepUpDialog';

const LandingPage = lazy(() => import('@/pages/LandingPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const CustomersPage = lazy(() => import('@/pages/CustomersPage'));
const CustomerDetailPage = lazy(() => import('@/pages/CustomerDetailPage'));
const LeadsPage = lazy(() => import('@/pages/LeadsPage'));
const DealsPage = lazy(() => import('@/pages/DealsPage'));
const TasksPage = lazy(() => import('@/pages/TasksPage'));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
    // When a refresh ultimately fails, bounce to login.
    setUnauthorizedHandler(() => {
      useAuthStore.setState({ user: null, status: 'unauthenticated' });
    });
  }, [bootstrap]);

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <StepUpDialog />
        <Suspense fallback={<FullPageSpinner label="Loading…" />}>
          <Routes>
            {/* Public */}
            <Route path="/" element={<LandingPage />} />
            <Route element={<PublicOnlyRoute />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>

            {/* Authenticated app */}
            <Route element={<ProtectedRoute />}>
              <Route path="/app" element={<AppShell />}>
                <Route index element={<Navigate to="/app/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="customers" element={<CustomersPage />} />
                <Route path="customers/:id" element={<CustomerDetailPage />} />
                <Route path="leads" element={<LeadsPage />} />
                <Route path="deals" element={<DealsPage />} />
                <Route path="tasks" element={<TasksPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="profile" element={<ProfilePage />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
