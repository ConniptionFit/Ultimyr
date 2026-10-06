/** The message for an error a sign-in form has no specific wording for. A rate limit says to wait rather than "try again". */
export function fallbackError(err: unknown): string {
  if ((err as { status?: number } | null)?.status === 429) return "Too many attempts in a short time. Wait a minute, then try again.";
  return "Something went wrong. Please try again.";
}
