/** Passwords people actually choose at 12 characters or more. Compared lower case. Not a full breach list, just the worst offenders. */
const COMMON = new Set([
  "password1234",
  "password12345",
  "password123456",
  "passwordpassword",
  "passw0rd1234",
  "123456789012",
  "1234567890123",
  "12345678901234",
  "qwertyuiop12",
  "qwertyuiopas",
  "qwerty123456",
  "qwertyuiopasdf",
  "asdfghjkl123",
  "1q2w3e4r5t6y",
  "iloveyou1234",
  "letmein12345",
  "welcome12345",
  "administrator",
  "administrator1",
  "changeme1234",
  "changemechangeme",
  "trustno1trustno1",
  "ultimyr12345",
  "ultimyrultimyr",
]);

const ascending = (s: string) => [...s].every((c, i) => i === 0 || c.charCodeAt(0) === s.charCodeAt(i - 1) + 1);

/** A reason the password is too easy to guess, in words for the person typing it, or null if it is fine. */
export function passwordIssue(password: string, email?: string): string | null {
  const p = password.toLowerCase();
  if (COMMON.has(p)) return "That password is on lists attackers try first. Pick something less common.";
  if (new Set(p).size <= 2) return "Use a mix of characters, not the same few repeated.";
  for (const n of [1, 2, 3, 4]) if (p.length % n === 0 && p === p.slice(0, n).repeat(p.length / n)) return "Use a mix of characters, not a short pattern repeated.";
  if (ascending(p)) return "Avoid a run of consecutive characters such as 123456789012 or abcdefghijkl.";
  const local = email?.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && p.includes(local)) return "Do not put your email name in your password.";
  return null;
}
