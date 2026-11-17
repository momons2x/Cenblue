import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authPassword, safeNext, verifyAuthValue } from "./app/lib/auth";

const PUBLIC_PATHS = new Set(["/login", "/api/health"]);

export async function middleware(request: NextRequest) {
  const password = authPassword();
  if (!password) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/_next/")) return NextResponse.next();
  const issuedAt = await verifyAuthValue(request.cookies.get(AUTH_COOKIE)?.value, password);
  if (issuedAt !== null) return NextResponse.next();
  const login = new URL("/login", request.url);
  const next = safeNext(pathname + (request.nextUrl.search || ""));
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
