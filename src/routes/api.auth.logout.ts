/**
 * POST /api/auth/logout
 * Clears the HttpOnly auth cookies.
 */
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { clearAuthCookies } from "@/lib/auth";

export const APIRoute = createAPIFileRoute("/api/auth/logout")({
  POST: async () => {
    const [accessClear, refreshClear] = clearAuthCookies();
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": accessClear,
        "X-Set-Refresh-Cookie": refreshClear,
      },
    });
  },
});
