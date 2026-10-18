import type { Metadata } from 'next';
import { LikesYouList } from '@/components/discovery/LikesYouList';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Likes You | Aura Dating',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function LikesYouPage() {
  return (
    <div className="section-container" style={{ margin: '0 auto', maxWidth: '800px', padding: '1rem' }}>
      <LikesYouList />
    </div>
  );
}
