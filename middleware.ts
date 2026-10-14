import { NextResponse, type NextRequest } from "next/server";

// Redirección rápida al login si no hay cookie de sesión. La firma y el usuario se validan en cada página/acción (requireUser).
export function middleware(req: NextRequest) {
  if (!req.cookies.get("c95_session")?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next|sw\\.js|offline\\.html|manifest\\.webmanifest|icon-.*\\.png|favicon\\.ico).*)"],
};
