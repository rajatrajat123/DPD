import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';
import { Conversation } from '@/lib/api/chat';

const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 'conv_maya_01',
    match_id: 'match_maya_01',
    participant_low_id: 'usr_current',
    participant_high_id: 'usr_maya_demo_01',
    last_message_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    unread_count: 1,
    partner: {
      user_id: 'usr_maya_demo_01',
      display_name: 'Maya',
      age: 27,
      avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&h=160&fit=crop',
      is_photo_verified: true,
      is_online: true,
    },
    last_message: {
      id: 'msg_m_01',
      sender_user_id: 'usr_maya_demo_01',
      body: 'Hey! Loved your ceramic art bio. Are you free for an oat flat white this weekend?',
      message_type: 'TEXT',
      created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      is_read: false,
    },
  },
  {
    id: 'conv_jordan_02',
    match_id: 'match_jordan_02',
    participant_low_id: 'usr_current',
    participant_high_id: 'usr_jordan_demo_02',
    last_message_at: new Date(Date.now() - 3600000 * 18).toISOString(),
    created_at: new Date(Date.now() - 3600000 * 48).toISOString(),
    unread_count: 0,
    partner: {
      user_id: 'usr_jordan_demo_02',
      display_name: 'Jordan',
      age: 29,
      avatar_url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=160&h=160&fit=crop',
      is_photo_verified: true,
      is_online: false,
    },
    last_message: {
      id: 'msg_j_01',
      sender_user_id: 'usr_current',
      body: 'Sounds awesome, see you at the climbing gym on Thursday!',
      message_type: 'TEXT',
      created_at: new Date(Date.now() - 3600000 * 18).toISOString(),
      is_read: true,
    },
  },
];

export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/conversations', () => {
    return NextResponse.json({
      count: MOCK_CONVERSATIONS.length,
      conversations: MOCK_CONVERSATIONS,
    });
  });
}
