import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "../services/auth";
import { isAdmin } from "../services/common";
import { db } from "./db";
import { SESSION_COOKIE, SESSION_HOURS, signSession, verifySession } from "./session";

export async function currentUser(): Promise<SessionUser | null> {
  const uid = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  return uid ? getSessionUser(db, uid) : null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isAdmin(user)) redirect("/");
  return user;
}

export async function startSession(userId: string) {
  (await cookies()).set(SESSION_COOKIE, signSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
