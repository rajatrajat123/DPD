import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.AURA_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';

/**
 * Proxy an incoming Next.js API request to the Aura Go API backend.
 * Falls back cleanly to fallbackHandler if backend network connection fails.
 */
export async function proxyToBackend(
  req: NextRequest,
  backendPath: string,
  fallbackHandler?: () => Promise<Response> | Response,
  customBody?: BodyInit
): Promise<Response> {
  const url = `${BACKEND_URL}${backendPath}`;
  const headers = new Headers();

  // Forward relevant authentication and tracing headers
  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    headers.set('authorization', authHeader);
  }

  const cookieHeader = req.headers.get('cookie');
  if (cookieHeader) {
    headers.set('cookie', cookieHeader);
    if (!authHeader) {
      const match = cookieHeader.match(/aura_session=([^;]+)/);
      if (match && match[1]) {
        headers.set('authorization', `Bearer ${match[1]}`);
      }
    }
  }

  const stepUpHeader = req.headers.get('x-aura-step-up');
  if (stepUpHeader) headers.set('x-aura-step-up', stepUpHeader);

  const reqId = req.headers.get('x-request-id') || crypto.randomUUID();
  headers.set('x-request-id', reqId);
  const clientAccept = req.headers.get('accept');
  if (clientAccept) {
    headers.set('accept', clientAccept);
  } else {
    headers.set('accept', 'application/json');
  }

  const method = req.method;
  let body: BodyInit | undefined = customBody;
  if (!body && method !== 'GET' && method !== 'HEAD') {
    const contentType = req.headers.get('content-type');
    if (contentType) {
      headers.set('content-type', contentType);
    } else {
      headers.set('content-type', 'application/json');
    }

    try {
      const rawBuffer = await req.arrayBuffer();
      if (rawBuffer.byteLength > 0) {
        body = Buffer.from(rawBuffer);
      }
    } catch {
      // body empty or unreadable
    }
  } else if (body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  try {
    const backendRes = await fetch(url, {
      method,
      headers,
      body,
      cache: 'no-store',
    });

    const responseHeaders = new Headers();
    const resContentType = backendRes.headers.get('content-type') || 'application/json';
    responseHeaders.set('content-type', resContentType);
    responseHeaders.set('x-request-id', reqId);

    const cacheControl = backendRes.headers.get('cache-control');
    if (cacheControl) responseHeaders.set('cache-control', cacheControl);

    if (backendRes.status === 204 || backendRes.status === 304) {
      return new NextResponse(null, {
        status: backendRes.status,
        headers: responseHeaders,
      });
    }

    const isBinary =
      resContentType.startsWith('image/') ||
      resContentType.startsWith('video/') ||
      resContentType.startsWith('application/octet-stream');

    const resData = isBinary ? await backendRes.arrayBuffer() : await backendRes.text();

    return new NextResponse(resData as any, {
      status: backendRes.status,
      headers: responseHeaders,
    });
  } catch (err) {
    if (fallbackHandler) {
      return fallbackHandler();
    }
    return NextResponse.json(
      {
        code: 'BACKEND_UNAVAILABLE',
        message: 'Aura backend API is currently unreachable',
        error: String(err),
      },
      { status: 503 }
    );
  }
}
