const KEY = "ultimyr_after_login";

/** Remember where to go after signing in. Only the app's own consent page is allowed, so this cannot become an open redirect. */
export function rememberReturn(path: string) {
  try {
    if (path.startsWith("/connect?")) sessionStorage.setItem(KEY, path);
  } catch {
    /* storage can be blocked; the person just lands on the home page */
  }
}

export function takeReturn(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return v && v.startsWith("/connect?") ? v : null;
  } catch {
    return null;
  }
}
