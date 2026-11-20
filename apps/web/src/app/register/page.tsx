import { redirect } from 'next/navigation';
import { RegisterForm } from '@/components/register-form';
import { getServerAccessContext } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const accessContext = await getServerAccessContext();
  if (accessContext) {
    redirect(accessContext.principalType === 'admin' ? '/admin' : '/dashboard');
  }

  return (
    <div className="page-shell">
      <main className="center-main">
        <RegisterForm />
      </main>
    </div>
  );
}
