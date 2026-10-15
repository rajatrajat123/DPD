import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

type Context = {
  params: Promise<{
    slug: string[];
  }>;
};

async function handleProxy(req: NextRequest, context: Context) {
  const { slug } = await context.params;
  const subpath = slug.join('/');
  const query = req.nextUrl.search || '';

  // Special case: step-up authentication challenge
  let backendPath: string;
  if (subpath === 'auth/step-up') {
    backendPath = `/api/v1/auth/step-up${query}`;
  } else {
    backendPath = `/api/v1/admin/${subpath}${query}`;
  }

  return proxyToBackend(req, backendPath);
}

export async function GET(req: NextRequest, context: Context) {
  return handleProxy(req, context);
}

export async function POST(req: NextRequest, context: Context) {
  return handleProxy(req, context);
}

export async function PUT(req: NextRequest, context: Context) {
  return handleProxy(req, context);
}

export async function PATCH(req: NextRequest, context: Context) {
  return handleProxy(req, context);
}

export async function DELETE(req: NextRequest, context: Context) {
  return handleProxy(req, context);
}
