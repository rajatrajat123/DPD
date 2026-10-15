import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ authenticated: false, user: null }, { status: 200 });
  }

  return NextResponse.json(
    {
      authenticated: true,
      user: {
        id: session.userId,
        userId: session.userId,
        email: session.email,
        role: session.role || 'MEMBER',
      },
    },
    { status: 200 }
  );
}
