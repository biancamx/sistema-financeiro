import { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext.jsx';
import { PeriodProvider } from '../context/PeriodContext.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { BusyProvider } from '../context/BusyContext.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { Spinner } from '../components/ui/ui.jsx';
import { router } from './router.jsx';

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <BusyProvider>
          <AuthProvider>
            <PeriodProvider>
              <Suspense fallback={<Spinner />}>
                <RouterProvider router={router} />
              </Suspense>
            </PeriodProvider>
          </AuthProvider>
        </BusyProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
