import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "logs");
mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = join(LOG_DIR, "traffic.jsonl");

const VERBOSE = process.env.PROXY_VERBOSE === "true";

// Log raw JSON-RPC traffic
function logMessage(direction, data) {
  try {
    const rawString = data.toString("utf8");
    // Parse messages separated by newlines (standard in JSON-RPC over stdio)
    const lines = rawString.split(/\r?\n/).filter(line => line.trim().length > 0);
    
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const logEntry = {
          timestamp: new Date().toISOString(),
          direction,
          message: parsed,
        };
        
        appendFileSync(LOG_FILE, JSON.stringify(logEntry) + "\n");
        
        if (VERBOSE) {
          const type = parsed.method 
            ? `Request: ${parsed.method}` 
            : parsed.result 
              ? `Response (ID ${parsed.id})` 
              : `Notification: ${parsed.method || "unknown"}`;
          process.stderr.write(`\x1b[33m[proxy ${direction}]\x1b[0m ${type}\n`);
          if (parsed.params && VERBOSE) {
            process.stderr.write(`${JSON.stringify(parsed.params, null, 2)}\n`);
          }
        }
      } catch {
        // If not a single complete JSON line, log raw data chunk
        appendFileSync(
          LOG_FILE,
          JSON.stringify({
            timestamp: new Date().toISOString(),
            direction,
            raw: line,
          }) + "\n"
        );
        if (VERBOSE) {
          process.stderr.write(`\x1b[31m[proxy ${direction} RAW]\x1b[0m ${line.slice(0, 150)}...\n`);
        }
      }
    }
  } catch (err) {
    appendFileSync(
      LOG_FILE,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        error: err.message,
      }) + "\n"
    );
  }
}

// Spawn the real local Anchor server in stdio mode
const serverPath = join(__dirname, "..", "..", "packages", "server", "dist", "index.js");

if (VERBOSE) {
  process.stderr.write(`\x1b[36m[proxy] Spawning Anchor server at: ${serverPath}\x1b[0m\n`);
  process.stderr.write(`\x1b[36m[proxy] Database path: ${process.env.ANCHOR_HOME || "default"}\x1b[0m\n`);
}

const child = spawn("node", [serverPath], {
  env: {
    ...process.env,
  },
  stdio: ["pipe", "pipe", "inherit"], // forward stderr of Anchor to client's stderr directly
});

process.stdin.on("data", (chunk) => {
  logMessage("client->server", chunk);
  child.stdin.write(chunk);
});

child.stdout.on("data", (chunk) => {
  logMessage("server->client", chunk);
  process.stdout.write(chunk);
});

child.on("close", (code) => {
  if (VERBOSE) {
    process.stderr.write(`\x1b[36m[proxy] Anchor server exited with code ${code}\x1b[0m\n`);
  }
  process.exit(code);
});

process.stdin.on("end", () => {
  child.stdin.end();
});
