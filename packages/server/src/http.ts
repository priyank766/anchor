// HTTP transport mode for the Anchor MCP server.
//
// Security posture (local-first product):
//   - Binds to 127.0.0.1 ONLY by default. Never 0.0.0.0 unless explicitly set.
//   - DNS rebinding protection via Host header validation.
//   - CORS restricted to localhost origins (not wildcard).
//   - Request body size limit (1 MB) to prevent memory abuse.
//   - Rate limiting (100 req/min per IP) to prevent local DoS.
//   - Security headers on all responses.
//   - Content-Type validation on POST.
//
// Endpoints:
//   POST /mcp  — MCP Streamable HTTP (JSON-RPC over HTTP + SSE)
//   GET  /mcp  — SSE stream for server-initiated notifications
//   DELETE /mcp — Session termination
//   GET  /health — simple liveness check (no sensitive data)

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";

export interface HttpServerOptions {
  port: number;
  host: string;
  mcpServer: Server;
}

// --- Rate limiter (in-memory, per-IP, sliding window) ----------------------

const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT = 100;        // requests per window

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count++;
  return bucket.count > RATE_LIMIT;
}

// Periodic cleanup so the map doesn't grow unbounded (local-first, but still).
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(ip);
  }
}, RATE_WINDOW_MS).unref();

// --- Security helpers -------------------------------------------------------

// Allowed Host headers. Only localhost variants are permitted — Anchor is a
// local-first product and should NEVER be exposed to the network by default.
const ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

function isAllowedHost(hostHeader: string | undefined, serverPort: number): boolean {
  if (!hostHeader) return false;
  // Strip port suffix for comparison (e.g. "localhost:3838" → "localhost").
  const host = hostHeader.replace(/:\d+$/, "");
  if (ALLOWED_HOSTS.has(host)) return true;
  // Also allow the full host:port form explicitly.
  if (ALLOWED_HOSTS.has(hostHeader)) return true;
  // Allow exact match with configured port.
  for (const allowed of ALLOWED_HOSTS) {
    if (hostHeader === `${allowed}:${serverPort}`) return true;
  }
  return false;
}

// CORS: restrict to localhost origins only.
const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,
];

function getAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  for (const pattern of ALLOWED_ORIGIN_PATTERNS) {
    if (pattern.test(origin)) return origin;
  }
  return null;
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  // Strict-Transport-Security not set — we're HTTP-only on localhost.
}

// Limit request body to 1 MB.
const MAX_BODY_BYTES = 1_048_576;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// --- Server -----------------------------------------------------------------

export async function startHttpServer(opts: HttpServerOptions): Promise<void> {
  const { port, host, mcpServer } = opts;

  // Enforce localhost binding. Warn loudly if overridden.
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    process.stderr.write(
      `[anchor] ⚠ WARNING: HTTP transport binding to ${host} — ` +
      `this exposes Anchor to the network. Anchor is designed for local use.\n`
    );
  }

  // One transport per session — stateful mode, so agents can maintain sessions.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  // Wire the MCP server to the HTTP transport.
  await mcpServer.connect(transport);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const clientIp = req.socket.remoteAddress ?? "unknown";

    // --- Security gate: rate limit ---
    if (isRateLimited(clientIp)) {
      setSecurityHeaders(res);
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
      res.end(JSON.stringify({ error: "rate limit exceeded", retryAfterSeconds: 60 }));
      return;
    }

    // --- Security gate: DNS rebinding protection ---
    if (!isAllowedHost(req.headers.host, port)) {
      setSecurityHeaders(res);
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "forbidden: invalid Host header" }));
      return;
    }

    setSecurityHeaders(res);

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    // CORS — restricted to localhost origins.
    const origin = req.headers.origin as string | undefined;
    const allowedOrigin = getAllowedOrigin(origin);
    if (allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, mcp-session-id"
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check — simple JSON liveness. No sensitive data.
    if (path === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", transport: "http", version: "0.1.0" }));
      return;
    }

    // MCP endpoint — delegate to the StreamableHTTP transport.
    if (path === "/mcp") {
      try {
        // For POST requests, validate Content-Type and read body with size limit.
        if (req.method === "POST") {
          const ct = req.headers["content-type"] ?? "";
          if (!ct.includes("application/json")) {
            res.writeHead(415, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "unsupported Content-Type; expected application/json" }));
            return;
          }
          const body = await readBody(req);
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid JSON" }));
            return;
          }
          await transport.handleRequest(req, res, parsed);
        } else {
          // GET (SSE stream) and DELETE (session close) — pass through.
          await transport.handleRequest(req, res);
        }
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "internal server error",
              // Don't leak stack traces — just the message.
            })
          );
        }
      }
      return;
    }

    // 404 for anything else — don't enumerate endpoints in production.
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(port, host, () => {
      process.stderr.write(
        `[anchor] HTTP transport ready. http://${host}:${port}/mcp\n` +
        `[anchor] Health check: http://${host}:${port}/health\n`
      );
      resolve();
    });
  });
}
