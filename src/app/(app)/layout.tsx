import { redirect } from 'next/navigation';
import { getDb } from '@/server/db';
import { getSessionUser } from '@/server/auth/session';
import { needsSetup } from '@/server/orchestrator/setup';
import { LiveProvider } from '@/lib/client/live';
import { AppShell } from '@/components/AppShell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const db = await getDb();
  if (envSmokeMode() ? false : await needsSetup(db)) redirect('/setup');
  const user = await getSessionUser(db);
  if (!user) redirect('/login');
  return (
    <LiveProvider>
      <AppShell>{children}</AppShell>
    </LiveProvider>
  );
}

function envSmokeMode() {
  return process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL;
}
