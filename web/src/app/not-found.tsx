import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="hero-section" style={{ padding: '6rem 2rem' }}>
      <h1 className="hero-title" style={{ fontSize: '4rem' }}>404</h1>
      <h2 style={{ marginBottom: '1rem' }}>Page Not Found</h2>
      <p className="hero-subtitle">
        The page you are looking for has been moved, unpublished, or does not exist.
      </p>
      <div className="cta-group" style={{ marginTop: '2rem' }}>
        <Link href="/" className="btn-primary">
          Back to Homepage
        </Link>
        <Link href="/dating" className="btn-secondary">
          Browse Dating Categories
        </Link>
        <Link href="/safety" className="btn-secondary">
          Safety Guides
        </Link>
      </div>
    </div>
  );
}
