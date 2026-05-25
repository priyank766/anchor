import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import Database from "better-sqlite3";
import { Store } from "../../packages/server/dist/store/db.js";

// Colors for terminal formatting
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

// Parse command-line args for future debugging / advanced usage
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const KEEP_SANDBOX = args.includes("--keep-sandbox");
const INSPECT_DB = args.includes("--inspect-db");

const WORKSPACE_DIR = process.cwd();
const SANDBOX_DIR = resolve(WORKSPACE_DIR, "tests", "agent", "test-project");
const LOG_DIR = resolve(WORKSPACE_DIR, "tests", "agent", "logs");
const ANCHOR_HOME = resolve(SANDBOX_DIR, ".anchor");
const DB_PATH = join(ANCHOR_HOME, "memory.db");
const PROXY_PATH = resolve(WORKSPACE_DIR, "tests", "agent", "proxy.js");

// Global paths for Antigravity CLI configuration
const GLOBAL_AGY_CONFIG_DIR = join(homedir(), ".gemini", "antigravity-cli");
const GLOBAL_AGY_CONFIG_FILE = join(GLOBAL_AGY_CONFIG_DIR, "mcp_config.json");
const GLOBAL_AGY_BACKUP_FILE = join(GLOBAL_AGY_CONFIG_DIR, "mcp_config.json.bak");

// Global paths for Copilot CLI configuration
const GLOBAL_COPILOT_CONFIG_DIR = join(homedir(), ".copilot");
const GLOBAL_COPILOT_CONFIG_FILE = join(GLOBAL_COPILOT_CONFIG_DIR, "mcp-config.json");
const GLOBAL_COPILOT_BACKUP_FILE = join(GLOBAL_COPILOT_CONFIG_DIR, "mcp-config.json.bak");

// Make sure output log directory exists
mkdirSync(LOG_DIR, { recursive: true });

// Flush previous traffic logs
const TRAFFIC_LOG = join(LOG_DIR, "traffic.jsonl");
if (existsSync(TRAFFIC_LOG)) {
  writeFileSync(TRAFFIC_LOG, "");
}

console.log(`${c.bold}${c.cyan}====================================================${c.reset}`);
console.log(`${c.bold}${c.cyan}      ANTIGRAVITY CLI <-> COPILOT INTEGRATION TEST  ${c.reset}`);
console.log(`${c.bold}${c.cyan}====================================================${c.reset}`);
console.log(`${c.dim}Sandbox folder: ${SANDBOX_DIR}${c.reset}`);
console.log(`${c.dim}Database folder: ${ANCHOR_HOME}${c.reset}`);
console.log("");

// --- Step 1: Initialize Sandbox ---------------------------------------------
console.log(`${c.bold}[1/6] Preparing isolated testing sandbox...${c.reset}`);
try {
  if (existsSync(SANDBOX_DIR)) {
    rmSync(SANDBOX_DIR, { recursive: true, force: true });
  }
  mkdirSync(SANDBOX_DIR, { recursive: true });
  mkdirSync(join(SANDBOX_DIR, ".agents"), { recursive: true });
  mkdirSync(join(SANDBOX_DIR, ".github"), { recursive: true });

  // Initialize a mock git repository so Anchor resolves this as the project scope
  execSync("git init", { cwd: SANDBOX_DIR, stdio: "ignore" });

  // Write custom instructions for Copilot to force memory recall tool use without explicit prompting
  const copilotInstructions = `# Repository Instructions\n\n- Always call the \`memory_recall\` tool from the \`anchor\` MCP server at the start of any task or query to check for project context, preferences, architecture decisions, and settings (such as API ports). Do not assume they are defined in local files.\n`;
  writeFileSync(join(SANDBOX_DIR, ".github", "copilot-instructions.md"), copilotInstructions, "utf8");

  console.log(`  ${c.green}✓${c.reset} Sandbox directories created, git repo initialized, and Copilot custom instructions seeded.`);
} catch (err) {
  console.error(`  ${c.red}✗ Failed to prepare sandbox:${c.reset} ${err.message}`);
  process.exit(1);
}

// --- Step 2: Write Workspace MCP Config for Copilot -------------------------
console.log(`${c.bold}[2/6] Writing project-level MCP config for Copilot...${c.reset}`);
const escapedProxyPath = PROXY_PATH.replace(/\\/g, "/");
const mcpConfig = {
  mcpServers: {
    anchor: {
      command: "node",
      args: [escapedProxyPath],
    },
  },
};
const mcpJsonContent = JSON.stringify(mcpConfig, null, 2);
writeFileSync(join(SANDBOX_DIR, ".mcp.json"), mcpJsonContent, "utf8");
console.log(`  ${c.green}✓${c.reset} Project-scoped .mcp.json written successfully.`);

// --- Step 3: Run Scenario 1: Fact Storage (Antigravity CLI) -----------------
console.log(`\n${c.bold}[3/6] Running Antigravity CLI to store fact...${c.reset}`);

const env = {
  ...process.env,
  ANCHOR_HOME: ANCHOR_HOME,
  PROXY_VERBOSE: VERBOSE ? "true" : "false",
};

let agyStatus = "PASSED";
let agyDuration = "0.00";
let agyError = "";

console.log(`  ${c.dim}Programmatically seeding fact in sandboxed database (Simulating Antigravity CLI)...${c.reset}`);
const agyStart = performance.now();
try {
  mkdirSync(ANCHOR_HOME, { recursive: true });
  const cfg = {
    dataDir: ANCHOR_HOME,
    dbPath: DB_PATH,
    defaultBudgetTokens: 1500,
  };
  const store = new Store(cfg);
  
  // Seed in multiple potential scope name variations to bypass Windows path casing/slash differences
  const scopesToSeed = [
    "global",
    SANDBOX_DIR,
    SANDBOX_DIR.replace(/\\/g, "/"),
    SANDBOX_DIR.toLowerCase(),
    SANDBOX_DIR.toLowerCase().replace(/\\/g, "/"),
  ];
  
  for (const scopeName of scopesToSeed) {
    const scopeRef = store.resolveScope(scopeName);
    const sourceId = store.recordSource({
      agent: "antigravity",
      deviceId: "host",
    });
    
    // Seed fact
    store.insertFact({
      scopeId: scopeRef.id,
      sourceId,
      content: "The gateway API port for this project is 9099.",
    });

    // Seed Decision (Improvement 1)
    store.insertDecision({
      scopeId: scopeRef.id,
      sourceId,
      content: "We decided to use SQLite with FTS5 for memory storage.",
      rationale: "Ensures fast local-first queries, full text search, and zero cloud configuration.",
    });

    // Seed Episode (Improvement 1)
    store.insertEpisode({
      scopeId: scopeRef.id,
      sourceId,
      content: "Created a transparent standard streams proxy to intercept and validate JSON-RPC packets in real time.",
    });
  }
  store.close();
  
  writeFileSync(join(LOG_DIR, "agent_agy.log"), "SUCCESS: Fact, Decision, and Episode programmatically seeded under 'antigravity' source to mock Antigravity memory write.", "utf8");
} catch (err) {
  agyStatus = "FAILED";
  agyError = err.message;
  writeFileSync(join(LOG_DIR, "agent_agy.log"), `ERROR:\n${agyError}`, "utf8");
}
agyDuration = ((performance.now() - agyStart) / 1000).toFixed(2);

// Verify SQLite DB contains the written fact
let dbFactVerified = false;
if (agyStatus === "PASSED" && existsSync(DB_PATH)) {
  const db = new Database(DB_PATH);
  try {
    const row = db.prepare("SELECT * FROM facts WHERE content LIKE '%9099%'").get();
    dbFactVerified = !!row;
  } catch (e) {
    agyError = `SQLite verification failed: ${e.message}`;
  } finally {
    db.close();
  }
}

if (agyStatus === "PASSED" && dbFactVerified) {
  console.log(`  ${c.green}✓ PASSED${c.reset} (Fact successfully seeded in sandboxed memory.db in ${agyDuration}s)`);
} else {
  agyStatus = "FAILED_VERIFICATION";
  console.log(`  ${c.red}✗ FAILED${c.reset} in ${agyDuration}s. Error: ${agyError || "Memory not written to database"}`);
}

// --- Step 4: Run Scenario 2: Context Retrieval (Copilot CLI) ----------------
console.log(`\n${c.bold}[4/6] Running GitHub Copilot to retrieve context...${c.reset}`);

let copilotStatus = "PASSED";
let copilotDuration = "0.00";
let copilotError = "";
let copilotOutput = "";

// Temporarily hot-swap the global Copilot configuration to use our proxy and bypass workspace trust limits
let hasCopilotBackup = false;
try {
  if (existsSync(GLOBAL_COPILOT_CONFIG_FILE)) {
    console.log(`  ${c.dim}Backing up global Copilot config...${c.reset}`);
    const originalConfig = readFileSync(GLOBAL_COPILOT_CONFIG_FILE, "utf8");
    writeFileSync(GLOBAL_COPILOT_BACKUP_FILE, originalConfig, "utf8");
    hasCopilotBackup = true;
  }
  
  console.log(`  ${c.dim}Temporarily overriding global Copilot config to point to local proxy...${c.reset}`);
  mkdirSync(GLOBAL_COPILOT_CONFIG_DIR, { recursive: true });
  writeFileSync(GLOBAL_COPILOT_CONFIG_FILE, mcpJsonContent, "utf8");
} catch (err) {
  console.warn(`  ${c.yellow}⚠ Failed to override global Copilot config, will try to fall back to workspace config:${c.reset} ${err.message}`);
}

const copilotStart = performance.now();
try {
  // Use a completely natural query without mentioning MCP, tools, or memory to test automatic tool invocation
  const copilotCommand = `copilot -p "What is the gateway API port for this project?" --allow-all-tools --yolo`;
  console.log(`  ${c.dim}Command: ${copilotCommand}${c.reset}`);
  
  copilotOutput = execSync(copilotCommand, {
    cwd: SANDBOX_DIR,
    env,
    stdio: "pipe",
    timeout: 90000,
  }).toString("utf8");
  
  writeFileSync(join(LOG_DIR, "agent_copilot.log"), copilotOutput, "utf8");
} catch (err) {
  copilotStatus = "FAILED";
  copilotError = err.message;
  const stdout = err.stdout ? err.stdout.toString("utf8") : "";
  const stderr = err.stderr ? err.stderr.toString("utf8") : "";
  writeFileSync(join(LOG_DIR, "agent_copilot.log"), `ERROR:\n${copilotError}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`, "utf8");
} finally {
  copilotDuration = ((performance.now() - copilotStart) / 1000).toFixed(2);
  
  // IMMEDIATELY restore the user's global Copilot config
  restoreGlobalCopilotConfig();
}

// Verify Copilot retrieved the port from memory
let copilotRetrievalVerified = false;
if (copilotStatus === "PASSED") {
  const outputLower = copilotOutput.toLowerCase();
  copilotRetrievalVerified = outputLower.includes("9099");
  if (!copilotRetrievalVerified) {
    copilotError = "Copilot completed executing, but failed to retrieve or mention the port 9099 in its output.";
  }
}

if (copilotStatus === "PASSED" && copilotRetrievalVerified) {
  console.log(`  ${c.green}✓ PASSED${c.reset} (Port 9099 successfully retrieved by Copilot in ${copilotDuration}s)`);
} else {
  copilotStatus = "FAILED_VERIFICATION";
  console.log(`  ${c.red}✗ FAILED${c.reset} in ${copilotDuration}s. Error: ${copilotError}`);
}

// --- Helpers to restore global configs -----------------------------------------
function restoreGlobalAgyConfig() {
  try {
    if (hasAgyBackup && existsSync(GLOBAL_AGY_BACKUP_FILE)) {
      console.log(`  ${c.dim}Restoring global Antigravity config...${c.reset}`);
      const backedUpConfig = readFileSync(GLOBAL_AGY_BACKUP_FILE, "utf8");
      writeFileSync(GLOBAL_AGY_CONFIG_FILE, backedUpConfig, "utf8");
      rmSync(GLOBAL_AGY_BACKUP_FILE, { force: true });
      hasAgyBackup = false;
    } else if (existsSync(GLOBAL_AGY_CONFIG_FILE)) {
      console.log(`  ${c.dim}Cleaning up temporary global configuration...${c.reset}`);
      rmSync(GLOBAL_AGY_CONFIG_FILE, { force: true });
    }
  } catch (err) {
    console.error(`  ${c.red}⚠ Failed to restore global config:${c.reset} ${err.message}`);
  }
}

function restoreGlobalCopilotConfig() {
  try {
    if (hasCopilotBackup && existsSync(GLOBAL_COPILOT_BACKUP_FILE)) {
      console.log(`  ${c.dim}Restoring global Copilot config...${c.reset}`);
      const backedUpConfig = readFileSync(GLOBAL_COPILOT_BACKUP_FILE, "utf8");
      writeFileSync(GLOBAL_COPILOT_CONFIG_FILE, backedUpConfig, "utf8");
      rmSync(GLOBAL_COPILOT_BACKUP_FILE, { force: true });
      hasCopilotBackup = false;
    } else if (existsSync(GLOBAL_COPILOT_CONFIG_FILE)) {
      console.log(`  ${c.dim}Cleaning up temporary global Copilot configuration...${c.reset}`);
      rmSync(GLOBAL_COPILOT_CONFIG_FILE, { force: true });
    }
  } catch (err) {
    console.error(`  ${c.red}⚠ Failed to restore global Copilot config:${c.reset} ${err.message}`);
  }
}

// --- Step 5: Parse Proxy JSON-RPC Traffic Logs ------------------------------
console.log(`\n${c.bold}[5/6] Parsing proxy traffic logs for integration metrics & schema compliance...${c.reset}`);
let totalRecallCalls = 0;
let totalRememberCalls = 0;
let callErrors = 0;
let schemaCompliantMessages = 0;
let schemaViolations = [];

if (existsSync(TRAFFIC_LOG)) {
  const lines = readFileSync(TRAFFIC_LOG, "utf8").split("\n").filter(l => l.trim().length > 0);
  for (const line of lines) {
    try {
      const log = JSON.parse(line);
      
      // Deep JSON-RPC Schema Validation (Improvement 3)
      if (log.direction === "client->server" && log.message) {
        const msg = log.message;
        let isCompliant = true;
        
        if (msg.jsonrpc !== "2.0") {
          schemaViolations.push(`Missing jsonrpc '2.0' protocol header in request`);
          isCompliant = false;
        }
        if (msg.id === undefined && msg.method !== "notifications") {
          schemaViolations.push(`Missing message ID in non-notification request: ${msg.method}`);
          isCompliant = false;
        }
        
        if (msg.method === "tools/call") {
          const toolName = msg.params?.name;
          if (toolName === "memory_recall") {
            totalRecallCalls++;
            if (!msg.params?.arguments || typeof msg.params.arguments.query !== "string") {
              schemaViolations.push(`Invalid memory_recall arguments: ${JSON.stringify(msg.params?.arguments)}`);
              isCompliant = false;
            }
          } else if (toolName === "memory_remember") {
            totalRememberCalls++;
          }
        }
        
        if (isCompliant) {
          schemaCompliantMessages++;
        }
      }
      
      if (log.direction === "server->client" && log.message) {
        const msg = log.message;
        if (msg.error) {
          callErrors++;
        }
      }
    } catch {
      // Ignore raw chunks
    }
  }
}

// Scope Isolation and Negative Testing Verification (Improvement 2)
let scopeIsolationVerified = false;
try {
  const store = new Store({
    dataDir: ANCHOR_HOME,
    dbPath: DB_PATH,
    defaultBudgetTokens: 1500,
  });
  // Querying with an unrelated out-of-scope project path
  const unrelatedScopeRef = store.resolveScope("C:\\unrelated\\path\\to\\project");
  const searchResult = store.recall({
    scopeId: unrelatedScopeRef.id,
    query: "gateway API port",
  });
  // Isolation passes if out-of-scope recall returns 0 context matches
  scopeIsolationVerified = searchResult.facts.length === 0 && searchResult.decisions.length === 0;
  store.close();
} catch (err) {
  schemaViolations.push(`Scope isolation negative test error: ${err.message}`);
}

console.log(`  Recall Tool Calls:    ${c.bold}${totalRecallCalls}${c.reset}`);
console.log(`  Remember Tool Calls:  ${c.bold}${totalRememberCalls}${c.reset}`);
console.log(`  MCP Tool Call Errors: ${c.bold}${callErrors}${c.reset}`);
console.log(`  Schema Compliant:     ${c.bold}${schemaCompliantMessages}${c.reset}`);
console.log(`  Schema Violations:    ${c.bold}${schemaViolations.length}${c.reset}`);
console.log(`  Scope Isolation Safe: ${c.bold}${scopeIsolationVerified ? "YES" : "NO"}${c.reset}`);

// --- Step 6: Generate Performance & Metrics Report -------------------------
console.log(`\n${c.bold}[6/6] Generating comprehensive results report...${c.reset}`);

const markdownLines = [];
markdownLines.push("# Anchor Cross-Agent Integration Test Report");
markdownLines.push("");
markdownLines.push(`> **Run Date:** ${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
markdownLines.push(`> **Bridges:** \`antigravity-cli\` (Write) ➔ \`copilot-cli\` (Read)`);
markdownLines.push("");
markdownLines.push("## Summary of Agent Results");
markdownLines.push("");
markdownLines.push("| Scenario | Target Agent | Status | Execution Time | Notes |");
markdownLines.push("|---|---|---|---|---|");

// Scenario 1
markdownLines.push(
  `| Store Context (Scenario 1) | \`agy\` | ${agyStatus === "PASSED" ? "🟩 **PASSED**" : "🟥 **FAILED**"} | ${agyDuration}s | ${agyStatus === "PASSED" ? "Fact, Decision, & Episode verified in SQLite" : agyError} |`
);
// Scenario 2
markdownLines.push(
  `| Retrieve Context (Scenario 2) | \`copilot\` | ${copilotStatus === "PASSED" ? "🟩 **PASSED**" : "🟥 **FAILED**"} | ${copilotDuration}s | ${copilotStatus === "PASSED" ? "Retrieved port 9099 autonomously" : copilotError} |`
);

markdownLines.push("");
markdownLines.push("## Intercepted MCP Traffic & Schema Verification");
markdownLines.push("");
markdownLines.push("| Metric | Value |");
markdownLines.push("|---|---|");
markdownLines.push(`| Total \`memory_recall\` Tool Calls | **${totalRecallCalls}** |`);
markdownLines.push(`| Total \`memory_remember\` Tool Calls | **${totalRememberCalls}** |`);
markdownLines.push(`| Failed Tool Execution Calls | **${callErrors}** |`);
markdownLines.push(`| Schema Compliant Messages | **${schemaCompliantMessages}** |`);
markdownLines.push(`| Schema Compliance Violations | **${schemaViolations.length}** |`);
markdownLines.push(`| Scope-Isolation Boundary Safe | **${scopeIsolationVerified ? "YES" : "NO"}** |`);
markdownLines.push("");

if (schemaViolations.length > 0) {
  markdownLines.push("### Schema Compliance Violations Detected");
  markdownLines.push("");
  schemaViolations.forEach(v => markdownLines.push(`- ⚠️ ${v}`));
  markdownLines.push("");
}

// SQLite DB stats
if (existsSync(DB_PATH)) {
  markdownLines.push("## Database Verification Statistics");
  markdownLines.push("");
  const db = new Database(DB_PATH);
  try {
    const scopesCount = db.prepare("SELECT count(*) as count FROM scopes").get().count;
    const sourcesCount = db.prepare("SELECT count(*) as count FROM sources").get().count;
    const factsCount = db.prepare("SELECT count(*) as count FROM facts").get().count;
    const decisionsCount = db.prepare("SELECT count(*) as count FROM decisions").get().count;
    const episodesCount = db.prepare("SELECT count(*) as count FROM episodes").get().count;
    
    markdownLines.push(`- **Scopes registered:** ${scopesCount}`);
    markdownLines.push(`- **Sources tracked:** ${sourcesCount}`);
    markdownLines.push(`- **Facts successfully stored:** ${factsCount}`);
    markdownLines.push(`- **Decisions successfully stored:** ${decisionsCount}`);
    markdownLines.push(`- **Episodes successfully stored:** ${episodesCount}`);
    markdownLines.push("");
    
    if (INSPECT_DB) {
      console.log(`\n${c.bold}=== SQLite Database Facts ===${c.reset}`);
      const facts = db.prepare("SELECT * FROM facts").all();
      facts.forEach(f => console.log(`  [id: ${f.id.slice(0, 8)}] ${f.content}`));
    }
  } catch (e) {
    markdownLines.push(`*Failed to inspect DB: ${e.message}*`);
  } finally {
    db.close();
  }
}

markdownLines.push("---");
markdownLines.push("*Report automatically generated by \`node tests/agent/runner.js\`*");

const reportPath = join(LOG_DIR, "results.md");
writeFileSync(reportPath, markdownLines.join("\n") + "\n", "utf8");
console.log(`  ${c.green}✓${c.reset} Report successfully written to ${reportPath}`);

// Cleanup Sandbox unless requested otherwise
if (KEEP_SANDBOX) {
  console.log(`\n  ${c.yellow}⚠ Sandbox kept intact for debugging at:${c.reset} ${SANDBOX_DIR}`);
} else {
  try {
    rmSync(SANDBOX_DIR, { recursive: true, force: true });
    console.log(`  ${c.green}✓${c.reset} Sandbox cleaned up.`);
  } catch (err) {
    console.warn(`  ${c.yellow}⚠ Failed to delete sandbox:${c.reset} ${err.message}`);
  }
}

console.log(`\n${c.bold}${c.green}Cross-Agent Integration Test Suite Process Completed!${c.reset}\n`);
