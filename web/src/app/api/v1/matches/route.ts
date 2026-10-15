import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';
import { MatchResponse } from '@/lib/api/discovery';

const MOCK_MATCHES: MatchResponse[] = [
  {
    id: 'match_maya_01',
    matched_user_id: 'usr_maya_demo_01',
    status: 'ACTIVE',
    matched_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    matched_profile: {
      user_id: 'usr_maya_demo_01',
      display_name: 'Maya',
      age: 27,
      bio: 'Documentary photographer & ceramicist. Looking for slow Sunday mornings, great filter coffee, and queer community connections.',
      pronouns: ['she', 'her'],
      gender_identities: ['Cis Woman', 'Queer Woman'],
      sexual_orientations: ['Lesbian', 'Queer'],
      relationship_intents: ['Long-Term Relationship', 'Monogamous'],
      relationship_structure: 'Monogamous',
      approximate_distance_km: 3,
      is_photo_verified: true,
      compatibility_score: 96.5,
      photos: [
        {
          asset_id: 'ast_photo_01',
          thumb_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&h=160&fit=crop&crop=face',
          card_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=640&h=800&fit=crop&crop=face',
          full_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1200&h=1600&fit=crop&crop=face',
        },
      ],
    },
  },
  {
    id: 'match_jordan_02',
    matched_user_id: 'usr_jordan_demo_02',
    status: 'ACTIVE',
    matched_at: new Date(Date.now() - 3600000 * 28).toISOString(),
    matched_profile: {
      user_id: 'usr_jordan_demo_02',
      display_name: 'Jordan',
      age: 29,
      bio: 'Queer poet & plant dad. Avid climber and vinyl record collector.',
      pronouns: ['they', 'them'],
      gender_identities: ['Non-Binary'],
      sexual_orientations: ['Pansexual'],
      relationship_intents: ['Activity Partner'],
      approximate_distance_km: 5,
      is_photo_verified: true,
      compatibility_score: 92.0,
      photos: [
        {
          asset_id: 'ast_photo_03',
          thumb_url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=160&h=160&fit=crop&crop=face',
          card_url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=640&h=800&fit=crop&crop=face',
          full_url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=1200&h=1600&fit=crop&crop=face',
        },
      ],
    },
  },
];

export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/matches', () => {
    return NextResponse.json({
      count: MOCK_MATCHES.length,
      matches: MOCK_MATCHES,
    });
  });
}
