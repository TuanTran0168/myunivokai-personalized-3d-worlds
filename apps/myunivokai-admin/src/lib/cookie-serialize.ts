// A minimal Set-Cookie serializer, hand-rolled rather than pulled from a
// dependency, because the attribute set every cookie in this app ever needs
// is small and fixed. Used everywhere a Set-Cookie header is written by hand
// (auth-relay.ts, middleware.ts) INSTEAD OF NextResponse's `.cookies` API:
// mixing `.cookies.set()`/`.cookies.delete()` with directly-appended raw
// Set-Cookie headers (from relaying the gateway's own cookies) on the same
// response silently drops one or the other — every cookie this app sets
// goes through this one function so there is only ever one code path.
export interface CookieAttributes {
  path: string;
  expires?: Date;
  maxAge?: number;
  sameSite?: "lax" | "strict" | "none";
  httpOnly?: boolean;
  secure?: boolean;
}

export function serializeCookie(name: string, value: string, attributes: CookieAttributes): string {
  const segments = [`${name}=${value}`, `Path=${attributes.path}`];
  if (attributes.expires) {
    segments.push(`Expires=${attributes.expires.toUTCString()}`);
  }
  if (attributes.maxAge !== undefined) {
    segments.push(`Max-Age=${attributes.maxAge}`);
  }
  if (attributes.sameSite) {
    segments.push(`SameSite=${attributes.sameSite}`);
  }
  if (attributes.httpOnly) {
    segments.push("HttpOnly");
  }
  if (attributes.secure) {
    segments.push("Secure");
  }
  return segments.join("; ");
}
