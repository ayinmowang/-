import { Suspense } from 'react';
import LoginView from '../../components/LoginView';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100dvh',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--bg-paper)',
            color: 'var(--text-secondary)',
            fontSize: 14,
          }}
        >
          正在载入登录页面...
        </div>
      }
    >
      <LoginView />
    </Suspense>
  );
}
