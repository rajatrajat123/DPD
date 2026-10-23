import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';
import { getAuthSession, ADMIN_ROLES } from '@/lib/auth/session';

type Context = {
  params: Promise<{
    slug: string[];
  }>;
};

async function handleProxy(req: NextRequest, context: Context) {
  // Defense-in-depth: Verify admin authentication and role before proxying to backend
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized: Admin authentication required' },
      { status: 401 }
    );
  }

  const userRole = session.role || 'MEMBER';
  if (!ADMIN_ROLES.includes(userRole)) {
    return NextResponse.json(
      { error: 'Forbidden: Insufficient administrative privileges' },
      { status: 403 }
    );
  }

  const { slug } = await context.params;
  const subpath = slug.join('/');
  const query = req.nextUrl.search || '';

  // Fine-grained admin role authorization per subpath
  if (subpath.startsWith('users/') && subpath.includes('/role') && userRole !== 'SUPER_ADMIN') {
    return NextResponse.json(
      { error: 'Forbidden: SuperAdmin role required to modify user roles' },
      { status: 403 }
    );
  }
  if (subpath.startsWith('users/') && subpath.includes('/role') && subpath.includes(session.userId)) {
    return NextResponse.json(
      { error: 'Forbidden: Self-action prohibited: administrators cannot modify their own administrative roles' },
      { status: 403 }
    );
  }
  if (subpath.startsWith('config') && userRole !== 'SUPER_ADMIN') {
    return NextResponse.json(
      { error: 'Forbidden: SuperAdmin role required' },
      { status: 403 }
    );
  }
  if (subpath.startsWith('billing/products') && userRole !== 'SUPER_ADMIN') {
    return NextResponse.json(
      { error: 'Forbidden: SuperAdmin role required to modify catalog pricing' },
      { status: 403 }
    );
  }
  if (subpath.startsWith('billing') && userRole !== 'SUPER_ADMIN' && userRole !== 'FINANCE_ADMIN') {
    return NextResponse.json(
      { error: 'Forbidden: FinanceAdmin role required' },
      { status: 403 }
    );
  }
  if (subpath.startsWith('moderation') && userRole !== 'SUPER_ADMIN' && userRole !== 'TRUST_AND_SAFETY') {
    return NextResponse.json(
      { error: 'Forbidden: Trust and Safety role required' },
      { status: 403 }
    );
  }
  if (subpath.startsWith('cms') && userRole !== 'SUPER_ADMIN' && userRole !== 'EDITORIAL_CMS') {
    return NextResponse.json(
      { error: 'Forbidden: Editorial CMS role required' },
      { status: 403 }
    );
  }
  if (
    (subpath.startsWith('affiliates') || subpath.startsWith('payouts') || subpath.startsWith('commission-rules')) &&
    userRole !== 'SUPER_ADMIN' &&
    userRole !== 'AFFILIATE_MANAGER' &&
    userRole !== 'FINANCE_ADMIN'
  ) {
    return NextResponse.json(
      { error: 'Forbidden: Affiliate Manager or Finance role required' },
      { status: 403 }
    );
  }
  if (subpath.startsWith('support') && userRole !== 'SUPER_ADMIN' && userRole !== 'CUSTOMER_SUPPORT') {
    return NextResponse.json(
      { error: 'Forbidden: Customer Support role required' },
      { status: 403 }
    );
  }

  // Special cases: step-up authentication challenge & product plans catalog
  let backendPath: string;
  if (subpath === 'auth/step-up') {
    backendPath = `/api/v1/auth/step-up${query}`;
  } else if (subpath === 'billing/plans') {
    backendPath = `/api/v1/billing/plans${query}`;
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
