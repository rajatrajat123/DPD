import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';
import { DiscoveryCandidate } from '@/lib/api/discovery';

const MOCK_FALLBACK_CANDIDATES: DiscoveryCandidate[] = [
  {
    user_id: 'usr_maya_demo_01',
    display_name: 'Maya',
    age: 27,
    bio: 'Documentary photographer & ceramicist. Looking for slow Sunday mornings, great filter coffee, and queer community connections.',
    pronouns: ['she', 'her'],
    approximate_distance_km: 3,
    is_photo_verified: true,
    compatibility_score: 96.5,
    gender_identities: ['Cis Woman', 'Queer Woman'],
    sexual_orientations: ['Lesbian', 'Queer'],
    relationship_intents: ['Long-Term Relationship', 'Monogamous'],
    relationship_structure: 'Monogamous',
    photos: [
      {
        asset_id: 'ast_photo_01',
        thumb_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&h=160&fit=crop&crop=face',
        card_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=640&h=800&fit=crop&crop=face',
        full_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1200&h=1600&fit=crop&crop=face',
      },
      {
        asset_id: 'ast_photo_02',
        thumb_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=160&h=160&fit=crop&crop=face',
        card_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=640&h=800&fit=crop&crop=face',
        full_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=1200&h=1600&fit=crop&crop=face',
      },
    ],
  },
  {
    user_id: 'usr_jordan_demo_02',
    display_name: 'Jordan',
    age: 29,
    bio: 'Queer poet & plant dad. Avid climber and vinyl record collector. Ethical non-monogamy advocate living authentically.',
    pronouns: ['they', 'them'],
    approximate_distance_km: 5,
    is_photo_verified: true,
    compatibility_score: 92.0,
    gender_identities: ['Non-Binary', 'Genderfluid'],
    sexual_orientations: ['Pansexual', 'Queer'],
    relationship_intents: ['Short-Term / Exploring', 'Activity Partner'],
    relationship_structure: 'Ethical Non-Monogamy',
    photos: [
      {
        asset_id: 'ast_photo_03',
        thumb_url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=160&h=160&fit=crop&crop=face',
        card_url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=640&h=800&fit=crop&crop=face',
        full_url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=1200&h=1600&fit=crop&crop=face',
      },
    ],
  },
  {
    user_id: 'usr_alex_demo_03',
    display_name: 'Alex',
    age: 31,
    bio: 'Software architect and community organizer. Big fan of indie bookstores, sci-fi, and warm hearty soups.',
    pronouns: ['he', 'him'],
    approximate_distance_km: 8,
    is_photo_verified: true,
    compatibility_score: 88.4,
    gender_identities: ['Trans Man'],
    sexual_orientations: ['Gay', 'Queer'],
    relationship_intents: ['Long-Term Relationship', 'Life Partner'],
    relationship_structure: 'Monogamous',
    photos: [
      {
        asset_id: 'ast_photo_04',
        thumb_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=160&h=160&fit=crop&crop=face',
        card_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=640&h=800&fit=crop&crop=face',
        full_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=1200&h=1600&fit=crop&crop=face',
      },
    ],
  },
];

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams.toString();
  const backendPath = `/api/v1/discovery/feed${searchParams ? `?${searchParams}` : ''}`;

  return proxyToBackend(req, backendPath, () => {
    return NextResponse.json({
      candidates: MOCK_FALLBACK_CANDIDATES,
      count: MOCK_FALLBACK_CANDIDATES.length,
    });
  });
}
