import type { Metadata } from 'next';
import { requireAuthSession } from '@/lib/auth/session';
import { ProfileEditor } from '@/components/profile/ProfileEditor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Member Profile & Preferences | Aura App',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function PrivateProfilePage() {
  // Enforces server-side authentication check. If unauthenticated, triggers immediate redirect.
  await requireAuthSession('/app/profile');

  return (
    <div style={{ maxWidth: '840px', margin: '0 auto', padding: '1rem 0' }}>
      <ProfileEditor />
    </div>
  );
}
