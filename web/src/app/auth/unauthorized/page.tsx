import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-[#0b0d11] text-[#E8E9EC] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-[#161922] border border-red-500/30 rounded-2xl p-8 backdrop-blur text-center shadow-2xl">
        <div className="w-16 h-16 bg-red-500/10 border border-red-500/30 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-2xl font-serif text-white mb-2">Administrative Access Restricted</h1>
        <p className="text-[#a0a5b5] text-sm leading-relaxed mb-8">
          Your account does not possess administrative or operational privileges for the requested console. All unauthorized attempts are logged for security and audit integrity.
        </p>
        <div className="space-y-3">
          <Link
            href="/"
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-gradient-to-r from-[#C3A15B] to-[#E3C77D] text-[#0d0f12] font-semibold text-sm hover:brightness-105 transition"
          >
            Return to Sanctuary Home
          </Link>
          <Link
            href="/auth/login"
            className="block w-full py-2.5 text-xs text-[#a0a5b5] hover:text-[#C3A15B] transition text-center"
          >
            Sign in with an administrative account
          </Link>
        </div>
      </div>
    </div>
  );
}
