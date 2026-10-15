import type { Metadata } from 'next';
import { MatchesList } from '@/components/discovery/MatchesList';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Matches | Aura App',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function MatchesPage() {
  return (
    <div className="section-container" style={{ margin: '0 auto', maxWidth: '800px', padding: '0 1rem' }}>
      <MatchesList />
    </div>
  );
}
