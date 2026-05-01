/**
 * GET /api/auth/me
 * Returns the current user from the JWT — no DB hit needed.
 */
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { extractToken, verifyAccessToken } from "@/lib/auth";

export const APIRoute = createAPIFileRoute("/api/auth/me")({
  GET: async ({ request }) => {
    const token = extractToken(request);
    if (!token) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const payload = await verifyAccessToken(token);
    if (!payload) {
      return Response.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    return Response.json({
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      orgId: payload.orgId,
      facilityId: payload.facilityId ?? null,
    });
  },
});
