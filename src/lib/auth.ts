/**
 * Tefnut Auth — JWT + bcrypt credentials provider
 *
 * - Passwords hashed with bcrypt (cost 12) before storage
 * - Sessions are stateless JWT (HS256, signed with JWT_SECRET)
 * - Token payload carries: sub (userId), orgId, role, email
 * - Access token: 8h  |  Refresh token: 7d
 * - Multi-tenancy: orgId is embedded in every token and enforced
 *   by withTenant() in pg-client.ts via RLS
 */
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = "8h";
const REFRESH_TOKEN_TTL = "7d";
const COOKIE_NAME = "tefnut_token";

// ---------------------------------------------------------------------------
// JWT payload shape
// ---------------------------------------------------------------------------
export interface TefnutTokenPayload extends JWTPayload {
  sub: string;        // userId (UUID)
  orgId: string;      // organization UUID — drives RLS
  role: string;       // admin | sustainability_lead | analyst | auditor | viewer
  email: string;
  facilityId?: string; // optional: scoped to a single facility
}

// ---------------------------------------------------------------------------
// Secret key (lazy — avoids import-time crash if env not set)
// ---------------------------------------------------------------------------
function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 characters long");
  }
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------
export async function signAccessToken(payload: Omit<TefnutTokenPayload, "iat" | "exp">): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .setIssuer("tefnut")
    .setAudience("tefnut-app")
    .sign(getSecret());
}

export async function signRefreshToken(userId: string, orgId: string): Promise<string> {
  return new SignJWT({ sub: userId, orgId, type: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_TTL)
    .setIssuer("tefnut")
    .setAudience("tefnut-refresh")
    .sign(getSecret());
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------
export async function verifyAccessToken(token: string): Promise<TefnutTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: "tefnut",
      audience: "tefnut-app",
    });
    return payload as TefnutTokenPayload;
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<{ sub: string; orgId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: "tefnut",
      audience: "tefnut-refresh",
    });
    return payload as { sub: string; orgId: string };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}

// ---------------------------------------------------------------------------
// Cookie helpers (server-side)
// ---------------------------------------------------------------------------
export const COOKIE_NAME_ACCESS = COOKIE_NAME;
export const COOKIE_NAME_REFRESH = "tefnut_refresh";

export function makeAccessCookie(token: string): string {
  const maxAge = 8 * 60 * 60; // 8h in seconds
  return `${COOKIE_NAME_ACCESS}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function makeRefreshCookie(token: string): string {
  const maxAge = 7 * 24 * 60 * 60; // 7d in seconds
  return `${COOKIE_NAME_REFRESH}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth/refresh; Max-Age=${maxAge}`;
}

export function clearAuthCookies(): string[] {
  return [
    `${COOKIE_NAME_ACCESS}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
    `${COOKIE_NAME_REFRESH}=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth/refresh; Max-Age=0`,
  ];
}

// ---------------------------------------------------------------------------
// Extract token from request (cookie or Authorization header)
// ---------------------------------------------------------------------------
export function extractToken(request: Request): string | null {
  // 1. HttpOnly cookie (preferred)
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME_ACCESS}=([^;]+)`));
  if (match?.[1]) return match[1];

  // 2. Authorization: Bearer <token>
  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);

  return null;
}

// ---------------------------------------------------------------------------
// Permission guards
// ---------------------------------------------------------------------------
export type UserRole = "admin" | "sustainability_lead" | "analyst" | "auditor" | "viewer";

const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 5,
  sustainability_lead: 4,
  auditor: 3,
  analyst: 2,
  viewer: 1,
};

/** Returns true if the user's role meets or exceeds the required role. */
export function hasRole(userRole: string, required: UserRole): boolean {
  const userLevel = ROLE_HIERARCHY[userRole as UserRole] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[required];
  return userLevel >= requiredLevel;
}

/** Roles that can generate SHA-256 CBAM declarations. */
export function canGenerateDeclaration(role: string): boolean {
  return hasRole(role, "auditor");
}

/** Roles that can trigger calculations. */
export function canRunCalculation(role: string): boolean {
  return hasRole(role, "analyst");
}

/** Roles that can export data. */
export function canExport(role: string): boolean {
  return hasRole(role, "analyst");
}

/** Roles that can manage users and settings. */
export function canManageOrg(role: string): boolean {
  return hasRole(role, "sustainability_lead");
}
