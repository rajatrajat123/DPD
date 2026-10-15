/**
 * Password Policy Enforcement for Aura Platform
 *
 * Rules:
 * - Minimum 8 characters; 8 is NOT the maximum.
 * - Sensible maximum of 128 characters (no premature truncation).
 * - At least one numeric digit (0–9).
 * - At least one special character (such as !, @, #, $, or _).
 * - No mandatory uppercase/lowercase rule unless specified.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordRequirementsStatus {
  hasMinLength: boolean;
  hasValidMax: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
}

export interface PasswordValidationResult {
  valid: boolean;
  error: string | null;
  requirements: PasswordRequirementsStatus;
  missingRequirements: string[];
}

export function checkPasswordRequirements(password: string): PasswordRequirementsStatus {
  return {
    hasMinLength: password.length >= PASSWORD_MIN_LENGTH,
    hasValidMax: password.length <= PASSWORD_MAX_LENGTH,
    hasDigit: /\d/.test(password),
    hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password),
  };
}

export function validatePasswordPolicy(password: string): PasswordValidationResult {
  const reqs = checkPasswordRequirements(password);
  const missing: string[] = [];

  if (!reqs.hasMinLength) {
    missing.push('At least 8 characters');
  }
  if (!reqs.hasValidMax) {
    missing.push('Maximum 128 characters');
  }
  if (!reqs.hasDigit) {
    missing.push('At least one numeric digit (0–9)');
  }
  if (!reqs.hasSpecial) {
    missing.push('At least one special character (such as !, @, #, $, or _)');
  }

  if (missing.length === 0) {
    return {
      valid: true,
      error: null,
      requirements: reqs,
      missingRequirements: [],
    };
  }

  // Provide a targeted, clear message for the primary failing requirement
  let error = '';
  if (!reqs.hasMinLength) {
    error = 'Password must be at least 8 characters long.';
  } else if (!reqs.hasValidMax) {
    error = 'Password cannot exceed 128 characters.';
  } else if (!reqs.hasDigit) {
    error = 'Password must include at least one numeric digit (0–9).';
  } else if (!reqs.hasSpecial) {
    error = 'Password must include at least one special character (such as !, @, #, $, or _).';
  }

  return {
    valid: false,
    error,
    requirements: reqs,
    missingRequirements: missing,
  };
}
