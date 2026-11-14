/**
 * Where the browser sends chat and position requests. Unset means the same origin (the Next
 * route handlers, used in local development); `NEXT_PUBLIC_API_URL` points at a separately
 * deployed API server. The value is public by design and must be an origin only: HTTPS, or HTTP
 * for localhost. Anything else is ignored rather than guessed, so a bad value can only fall back
 * to the same origin, never redirect requests to an unintended host.
 */
export function apiUrl(path: string, base: string | undefined = process.env.NEXT_PUBLIC_API_URL) {
  if (!base) return path;
  try {
    const url = new URL(base);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const valid =
      (url.protocol === "https:" || (url.protocol === "http:" && local)) &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password;
    return valid ? `${url.origin}${path}` : path;
  } catch {
    return path;
  }
}
