import type { Metadata } from 'next';
import { MessagesContainer } from '@/components/chat/MessagesContainer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Messages | Aura App',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function MessagesPage() {
  return (
    <div style={{ padding: '0 0.5rem' }}>
      <MessagesContainer />
    </div>
  );
}
