import type { Metadata } from 'next';
import { DiscoveryDeck } from '@/components/discovery/DiscoveryDeck';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Discovery | Aura App',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function DiscoveryPage() {
  return (
    <div className="section-container" style={{ margin: '0 auto', maxWidth: '600px', padding: '0 1rem' }}>
      <DiscoveryDeck />
    </div>
  );
}
