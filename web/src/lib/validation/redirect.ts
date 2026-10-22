/**
 * Validates and sanitizes redirect destination paths to prevent Open Redirect vulnerabilities.
 * Ensures the path is strictly an internal application route and disallows external origins,
 * protocol-relative URLs (//example.com), backslash tricks (/\\example.com), and script schemes.
 */
export function sanitizeRedirectPath(
  target: string | null | undefined,
  fallback: string = '/app/discovery'
): string {
  if (!target || typeof target !== 'string') {
    return fallback;
  }

  const trimmed = target.trim();

  // Must begin with a single '/' and cannot begin with '//', '/\', or contain backslashes
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\') ||
    trimmed.includes('\\')
  ) {
    return fallback;
  }

  // Disallow explicit protocol schemes (e.g. https:, javascript:, data:, vbscript:)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return fallback;
  }

  // Disallow carriage returns, newlines, or ASCII control characters
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}
