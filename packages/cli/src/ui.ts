// Tiny ANSI helpers — zero deps. Auto-disable when not a TTY or NO_COLOR set.
const enabled =
  process.stdout.isTTY === true &&
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb";

const wrap = (open: number, close: number) => (s: string) =>
  enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s;

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

// Small anchor. Hand-tuned monospace. Renders ~7 lines tall.
export function banner(): string {
  const a = c.cyan;
  const d = c.dim;
  const b = c.bold;
  const lines = [
    a("       _"),
    a("      ( )"),
    a("       H"),
    a("      _H_"),
    a("   .-'-.-'-."),
    a("  /         \\"),
    a("  '---------'"),
  ];
  const title = `${b(c.cyan("Anchor"))}  ${d("· cross-agent memory")}`;
  return lines.join("\n") + "\n" + title + "\n";
}

export function kv(key: string, value: string): string {
  return `${c.dim(key.padEnd(10))} ${value}`;
}

export function ok(msg: string): string {
  return `${c.green("✓")} ${msg}`;
}

export function warn(msg: string): string {
  return `${c.yellow("!")} ${msg}`;
}

export function err(msg: string): string {
  return `${c.red("✗")} ${msg}`;
}
