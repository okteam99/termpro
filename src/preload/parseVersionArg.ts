/**
 * Pure helper — NO electron import (keeps this unit-testable in node env).
 * Extracts the --termpro-version=<v> value from a process.argv-like array.
 * All failure modes (absent / empty / no `=` / blank after trim) return "".
 * Never throws.
 */
export function parseVersionArg(argv: string[]): string {
  const prefix = '--termpro-version=';
  for (const arg of argv) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length).trim();
    }
  }
  return '';
}
