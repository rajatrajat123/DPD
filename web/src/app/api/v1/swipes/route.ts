import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';
import { SwipeRequest, SwipeResponse } from '@/lib/api/discovery';

export async function POST(req: NextRequest) {
  let body: SwipeRequest | null = null;
  try {
    body = await req.clone().json();
  } catch {
    // ignore
  }

  return proxyToBackend(req, '/api/v1/swipes', async () => {
    const isLike = body?.direction === 'LIKE' || body?.direction === 'SUPER_SPARK';
    const isMatch = isLike && (body?.target_user_id === 'usr_maya_demo_01' || body?.direction === 'SUPER_SPARK');

    const response: SwipeResponse = {
      matched: isMatch,
      daily_swipes_remaining: 45,
      unlimited_swipes_granted: isMatch,
      reward_details: isMatch
        ? 'Mutual match celebration: 24 hours unlimited swipes granted!'
        : undefined,
      match: isMatch
        ? {
            id: `match_${Date.now()}`,
            matched_user_id: body?.target_user_id || 'usr_matched',
            status: 'ACTIVE',
            matched_at: new Date().toISOString(),
          }
        : undefined,
    };

    return NextResponse.json(response);
  });
}
