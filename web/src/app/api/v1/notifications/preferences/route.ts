import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/notifications/preferences', () => {
    return new Response(
      JSON.stringify({
        match_notifications: true,
        message_notifications: true,
        discovery_notifications: true,
        billing_notifications: true,
        security_alerts: true, // Non-negotiable mandatory security alerts
        quiet_hours_enabled: false,
        quiet_hours_start_utc: 22,
        quiet_hours_end_utc: 8,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
}

export async function PUT(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/notifications/preferences', () => {
    return new Response(
      JSON.stringify({ success: true, message: 'Notification preferences updated' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
}
