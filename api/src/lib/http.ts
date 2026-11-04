import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { allowedOrigins } from "./env";
import { logError } from "./log";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && allowedOrigins().includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export function json(req: Request, data: unknown, status = 200, extra?: Record<string, string>) {
  return NextResponse.json(data, {
    status,
    headers: { ...corsHeaders(req), "Cache-Control": "no-store", ...extra },
  });
}

export function preflight(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Wraps a route handler: maps known errors to safe JSON, never leaks internals. */
export function handle<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        return json(req, { error: err.code, message: err.message, ...err.extra }, err.status);
      }
      if (err instanceof ZodError) {
        return json(
          req,
          {
            error: "invalid",
            message: "Please check the highlighted fields.",
            issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          },
          400,
        );
      }
      logError("unhandled", err, { path: new URL(req.url).pathname });
      return json(req, { error: "server_error", message: "Something went wrong. Please try again." }, 500);
    }
  };
}

export async function readJson(req: Request, maxBytes = 32_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "too_large", "Request is too large.");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "bad_json", "Malformed JSON.");
  }
}

export function clientIp(req: Request): string {
  const h = req.headers;
  const fwd = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0]?.trim() || "unknown";
}
