/**
 * Pure helpers — NO electron import (keeps this unit-testable in node env).
 * Extract `--termpro-<name>=<v>` values from a process.argv-like array.
 * All failure modes (absent / empty / no `=` / blank after trim) return "".
 * Never throws.
 */
function parseArgValue(argv: string[], prefix: string): string {
  for (const arg of argv) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length).trim();
    }
  }
  return '';
}

export function parseVersionArg(argv: string[]): string {
  return parseArgValue(argv, '--termpro-version=');
}

/** 窗口创建时 main 已解析的生效 locale('en' | 'zh-CN';缺失 → "") */
export function parseLocaleArg(argv: string[]): string {
  return parseArgValue(argv, '--termpro-locale=');
}
