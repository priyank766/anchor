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

// Big block-letter ANCHOR. ANSI Shadow style.
// Each line is a separate string so the TUI can render it row-by-row.
export const BIG_BANNER_LINES = [
  " █████╗ ███╗   ██╗ ██████╗██╗  ██╗ ██████╗ ██████╗",
  "██╔══██╗████╗  ██║██╔════╝██║  ██║██╔═══██╗██╔══██╗",
  "███████║██╔██╗ ██║██║     ███████║██║   ██║██████╔╝",
  "██╔══██║██║╚██╗██║██║     ██╔══██║██║   ██║██╔══██╗",
  "██║  ██║██║ ╚████║╚██████╗██║  ██║╚██████╔╝██║  ██║",
  "╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝",
];

export function banner(): string {
  const colored = BIG_BANNER_LINES.map((l) => c.cyan(l)).join("\n");
  const tagline = c.dim("cross-agent memory");
  return `${colored}\n${tagline}\n`;
}

export function kv(key: string, value: string): string {
  return `${c.dim(key.padEnd(10))} ${value}`;
}

export function ok(msg: string): string {
  return `${c.green("ok")} ${msg}`;
}

export function warn(msg: string): string {
  return `${c.yellow("!")} ${msg}`;
}

export function err(msg: string): string {
  return `${c.red("x")} ${msg}`;
}
