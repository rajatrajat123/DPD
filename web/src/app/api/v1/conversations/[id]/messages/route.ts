import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';
import { Message, SendMessageRequest } from '@/lib/api/chat';

const MOCK_MESSAGES: Record<string, Message[]> = {
  conv_maya_01: [
    {
      id: 'msg_m_00',
      conversation_id: 'conv_maya_01',
      sender_user_id: 'usr_current',
      client_message_id: 'client_00',
      body: 'Hi Maya! Great to connect with another queer artist in the city.',
      message_type: 'TEXT',
      delivered_at: new Date(Date.now() - 3600000 * 3).toISOString(),
      read_at: new Date(Date.now() - 3600000 * 2.5).toISOString(),
      created_at: new Date(Date.now() - 3600000 * 3).toISOString(),
    },
    {
      id: 'msg_m_01',
      conversation_id: 'conv_maya_01',
      sender_user_id: 'usr_maya_demo_01',
      client_message_id: 'client_01',
      body: 'Hey! Loved your ceramic art bio. Are you free for an oat flat white this weekend?',
      message_type: 'TEXT',
      delivered_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    },
  ],
  conv_jordan_02: [
    {
      id: 'msg_j_00',
      conversation_id: 'conv_jordan_02',
      sender_user_id: 'usr_jordan_demo_02',
      client_message_id: 'client_j_00',
      body: 'Hey! Are you hitting up the climbing gym anytime this week?',
      message_type: 'TEXT',
      delivered_at: new Date(Date.now() - 3600000 * 20).toISOString(),
      read_at: new Date(Date.now() - 3600000 * 19).toISOString(),
      created_at: new Date(Date.now() - 3600000 * 20).toISOString(),
    },
    {
      id: 'msg_j_01',
      conversation_id: 'conv_jordan_02',
      sender_user_id: 'usr_current',
      client_message_id: 'client_j_01',
      body: 'Sounds awesome, see you at the climbing gym on Thursday!',
      message_type: 'TEXT',
      delivered_at: new Date(Date.now() - 3600000 * 18).toISOString(),
      read_at: new Date(Date.now() - 3600000 * 18).toISOString(),
      created_at: new Date(Date.now() - 3600000 * 18).toISOString(),
    },
  ],
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const searchParams = req.nextUrl.searchParams.toString();
  const backendPath = `/api/v1/conversations/${encodeURIComponent(id)}/messages${searchParams ? `?${searchParams}` : ''}`;

  return proxyToBackend(req, backendPath, () => {
    const list = MOCK_MESSAGES[id] || [];
    return NextResponse.json({
      messages: list,
      has_more: false,
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const backendPath = `/api/v1/conversations/${encodeURIComponent(id)}/messages`;

  let body: SendMessageRequest | null = null;
  try {
    body = await req.clone().json();
  } catch {
    // ignore
  }

  return proxyToBackend(req, backendPath, () => {
    const newMsg: Message = {
      id: `msg_${Date.now()}`,
      conversation_id: id,
      sender_user_id: 'usr_current',
      client_message_id: body?.client_message_id || `cli_${Date.now()}`,
      body: body?.body || '',
      message_type: body?.message_type || 'TEXT',
      media_asset_id: body?.media_asset_id,
      delivered_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    if (!MOCK_MESSAGES[id]) {
      MOCK_MESSAGES[id] = [];
    }
    MOCK_MESSAGES[id].push(newMsg);

    return NextResponse.json(newMsg, { status: 201 });
  });
}
