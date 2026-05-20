import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput, Static } from "ink";
import TextInput from "ink-text-input";
import type { Store, MemoryRow, MemoryType } from "@anchormem/server/store/db";
import { handleSupersede } from "@anchormem/server/tools/supersede";
import { handleRemember as handleRememberShared } from "@anchormem/server/tools/remember";
import { BIG_BANNER_LINES } from "../ui.js";

interface Props {
  store: Store;
  initialScope?: string;
}

interface HistoryEntry {
  id: number;
  kind: "input" | "result" | "info" | "error";
  text: string;
}

const TYPE_COLOR: Record<MemoryType, string> = {
  fact: "green",
  decision: "magenta",
  episode: "blue",
  artifact: "yellow",
};

let entryId = 0;

export function App({ store, initialScope }: Props) {
  const { exit } = useApp();
  const [scope, setScope] = useState(initialScope ?? "global");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    push("info", `Anchor — cross-agent memory.  type /help for commands, /quit to exit.`);
    push("info", `scope: ${scope}`);
    refreshStats();
  }, []);

  const stats = useMemo(() => {
    const ref = store.resolveScope(scope);
    const rows = store.listByScope(ref.id, undefined, 1000);
    let fact = 0, decision = 0, episode = 0, artifact = 0;
    for (const r of rows) {
      if (r.type === "fact") fact++;
      else if (r.type === "decision") decision++;
      else if (r.type === "episode") episode++;
      else if (r.type === "artifact") artifact++;
    }
    return { total: rows.length, fact, decision, episode, artifact };
  }, [scope, history.length]);

  function push(kind: HistoryEntry["kind"], text: string) {
    setHistory((h) => [...h, { id: entryId++, kind, text }]);
  }

  function refreshStats() {
    // No-op trigger; useMemo recomputes on history change.
  }

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") exit();
  });

  function run(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    push("input", `> ${trimmed}`);
    setInput("");

    if (trimmed.startsWith("/")) {
      handleCommand(trimmed);
    } else {
      // Default action: recall.
      handleRecall(trimmed);
    }
  }

  function handleCommand(line: string) {
    const [cmd, ...rest] = line.slice(1).split(" ");
    const arg = rest.join(" ").trim();
    switch (cmd) {
      case "help":
        push("info",
          [
            "commands:",
            "  <text>                       recall (default)",
            "  /recall <query>              same",
            "  /remember <type> <text>      type ∈ fact|decision|episode|artifact",
            "  /supersede <id> <text>       replace a stale fact/decision",
            "  /forget <id>                 delete by id",
            "  /list [type]                 list memories in this scope",
            "  /scope <name>                switch scope",
            "  /clear                       clear screen history",
            "  /help                        this",
            "  /quit                        exit",
          ].join("\n")
        );
        return;
      case "quit":
      case "exit":
        exit();
        return;
      case "clear":
        setHistory([]);
        return;
      case "scope":
        if (!arg) {
          push("info", `current scope: ${scope}`);
          return;
        }
        setScope(arg);
        push("info", `scope → ${arg}`);
        return;
      case "recall":
        handleRecall(arg);
        return;
      case "remember": {
        const m = arg.match(/^(fact|decision|episode|artifact)\s+(.+)$/s);
        if (!m) {
          push("error", "usage: /remember <fact|decision|episode|artifact> <text>");
          return;
        }
        handleRemember(m[1] as MemoryType, m[2]!);
        return;
      }
      case "forget":
        if (!arg) {
          push("error", "usage: /forget <id>");
          return;
        }
        handleForget(arg);
        return;
      case "supersede": {
        const m = arg.match(/^(\S+)\s+(.+)$/s);
        if (!m) {
          push("error", "usage: /supersede <id> <new content>");
          return;
        }
        try {
          const out = handleSupersede(store, {
            oldId: m[1]!,
            content: m[2]!,
            scope,
            agent: "anchor-tui",
          });
          push(
            "info",
            `superseded ${out.oldId.slice(0, 8)} → ${out.newId.slice(0, 8)} (${out.type})`
          );
        } catch (e) {
          push("error", (e as Error).message);
        }
        return;
      }
      case "list":
        handleList(arg as MemoryType | "");
        return;
      default:
        push("error", `unknown command: /${cmd}  (try /help)`);
    }
  }

  function handleRecall(query: string) {
    if (!query) {
      push("error", "usage: <query>  or  /recall <query>");
      return;
    }
    const ref = store.resolveScope(scope);
    const rows = store.searchFTS(ref.id, query, 20);
    if (rows.length === 0) {
      push("info", `no matches in scope "${scope}"`);
      return;
    }
    push("result", formatRows(rows));
  }

  // Routes through the shared async handler so writes get redaction,
  // injection scrubbing, and embedding (when configured). The TUI itself
  // doesn't await Promises in its event loop — fire-and-feedback by
  // dispatching the result via push() when the handler resolves.
  function handleRemember(type: MemoryType, text: string) {
    const args =
      type === "artifact"
        ? { type, ref: text, scope, agent: "anchor-tui" }
        : { type, content: text, scope, agent: "anchor-tui" };
    handleRememberShared(store, args).then(
      (out: { id: string; redacted?: string[]; scrubbed?: string[] }) => {
        const tags: string[] = [];
        if (out.redacted) tags.push(`redacted: ${out.redacted.join(",")}`);
        if (out.scrubbed) tags.push(`scrubbed: ${out.scrubbed.join(",")}`);
        const suffix = tags.length ? ` (${tags.join("; ")})` : "";
        push("info", `remembered ${type} ${out.id.slice(0, 8)}${suffix}`);
      },
      (e: unknown) => {
        push("error", `remember failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    );
  }

  function handleForget(id: string) {
    const ok = store.deleteById(id);
    push(ok ? "info" : "error", ok ? `forgot ${id.slice(0, 8)}` : `not found: ${id}`);
  }

  function handleList(filter: MemoryType | "") {
    const ref = store.resolveScope(scope);
    const rows = store.listByScope(ref.id, (filter || undefined) as MemoryType | undefined, 50);
    if (rows.length === 0) {
      push("info", `(empty in scope "${scope}")`);
      return;
    }
    push("result", formatRows(rows));
  }

  return (
    <Box flexDirection="column">
      {/* Big banner */}
      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        {BIG_BANNER_LINES.map((line, i) => (
          <Text key={i} color="cyan">{line}</Text>
        ))}
        <Text dimColor>cross-agent memory</Text>
      </Box>

      {/* Header */}
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <Box>
          <Text dimColor>scope </Text>
          <Text bold>{scope}</Text>
        </Box>
        <Box>
          <Text color="green">f {stats.fact}</Text>
          <Text dimColor>  </Text>
          <Text color="magenta">d {stats.decision}</Text>
          <Text dimColor>  </Text>
          <Text color="blue">e {stats.episode}</Text>
          <Text dimColor>  </Text>
          <Text color="yellow">a {stats.artifact}</Text>
        </Box>
      </Box>

      {/* Scrolling history */}
      <Box flexDirection="column" paddingX={1} paddingY={1} minHeight={10}>
        <Static items={history}>
          {(entry) => (
            <Box key={entry.id}>
              <Text color={entryColor(entry.kind)}>{entry.text}</Text>
            </Box>
          )}
        </Static>
      </Box>

      {/* Input */}
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="cyan">{"> "}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={run}
          placeholder="type to recall, or /help"
        />
      </Box>

      {/* Footer */}
      <Box paddingX={1}>
        <Text dimColor>
          /help  ·  /remember &lt;type&gt; &lt;text&gt;  ·  /supersede &lt;id&gt; &lt;text&gt;  ·  /quit
        </Text>
      </Box>
    </Box>
  );
}

function entryColor(kind: HistoryEntry["kind"]): string | undefined {
  switch (kind) {
    case "input":
      return "cyan";
    case "error":
      return "red";
    case "info":
      return "gray";
    default:
      return undefined;
  }
}

function formatRows(rows: MemoryRow[]): string {
  return rows
    .map((r) => {
      const date = new Date(r.updatedAt).toISOString().slice(0, 10);
      const tag = r.type.padEnd(8);
      const idShort = r.id.slice(0, 8);
      const body =
        r.type === "decision" && r.rationale
          ? `${r.content}  —  ${r.rationale}`
          : r.content;
      return `  ${tag} ${date}  ${idShort}  ${body}`;
    })
    .join("\n");
}
