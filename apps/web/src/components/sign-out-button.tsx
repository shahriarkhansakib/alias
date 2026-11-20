'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleSignOut() {
    setIsPending(true);
    try {
      await authClient.signOut();
      router.push('/');
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={handleSignOut}
      disabled={isPending}
    >
      {isPending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
