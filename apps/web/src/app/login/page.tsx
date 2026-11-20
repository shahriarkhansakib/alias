import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login-form';
import { getServerAccessContext } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const accessContext = await getServerAccessContext();
  if (accessContext) {
    redirect(accessContext.principalType === 'admin' ? '/admin' : '/dashboard');
  }

  return (
    <div className="page-shell">
      <main className="center-main">
        <LoginForm />
      </main>
    </div>
  );
}
