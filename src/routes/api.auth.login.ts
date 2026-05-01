/**
 * POST /api/auth/login
 * Credentials provider — email + password → JWT access + refresh tokens
 */
import { createAPIFileRoute } from "@tanstack/react-start/api";
import {
  hashPassword,
  makeAccessCookie,
  makeRefreshCookie,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
} from "@/lib/auth";
import { withTenant } from "../../db/pg-client";

interface LoginBody {
  email: string;
  password: string;
}

interface UserRow {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  role: string;
  password_hash: string;
  facility_id: string | null;
}

export const APIRoute = createAPIFileRoute("/api/auth/login")({
  POST: async ({ request }) => {
    let body: LoginBody;
    try {
      body = await request.json() as LoginBody;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { email, password } = body;

    if (!email || !password) {
      return Response.json(
        { error: "email and password are required" },
        { status: 400 },
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Invalid email format" }, { status: 400 });
    }

    // Look up user — use a system-level query (no tenant context yet)
    // We query by email across all orgs, then verify the password
    const pool = await import("../../db/pg-client").then((m) => m);

    // We need a direct pool query here (pre-auth, no org context yet)
    // Use a raw pg query via the pool helper
    let user: UserRow | null = null;
    try {
      // Temporarily use a system query — bypasses RLS for auth lookup only
      const { Pool } = await import("pg");
      const sysPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 2,
        ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : false,
      });
      const result = await sysPool.query<UserRow>(
        "SELECT id, org_id, email, full_name, role, password_hash, facility_id FROM users WHERE email = $1 LIMIT 1",
        [email.toLowerCase().trim()],
      );
      await sysPool.end();
      user = result.rows[0] ?? null;
    } catch (err) {
      console.error("[auth/login] DB error:", err);
      return Response.json({ error: "Authentication service unavailable" }, { status: 503 });
    }

    // Constant-time comparison — always run bcrypt even if user not found
    const dummyHash = "$2b$12$invalidhashfortimingnormalization000000000000000000000";
    const passwordValid = await verifyPassword(
      password,
      user?.password_hash ?? dummyHash,
    );

    if (!user || !passwordValid) {
      return Response.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    // Issue tokens
    const accessToken = await signAccessToken({
      sub: user.id,
      orgId: user.org_id,
      role: user.role,
      email: user.email,
      ...(user.facility_id ? { facilityId: user.facility_id } : {}),
    });
    const refreshToken = await signRefreshToken(user.id, user.org_id);

    return new Response(
      JSON.stringify({
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          org_id: user.org_id,
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": makeAccessCookie(accessToken),
          // Refresh token on a separate Set-Cookie header
          "X-Set-Refresh-Cookie": makeRefreshCookie(refreshToken),
        },
      },
    );
  },
});
