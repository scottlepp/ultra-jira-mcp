
/**
 * Clean test file with no issues
 */

export function formatString(input: string): string {
  return input.trim().toLowerCase();
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
