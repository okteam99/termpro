/**
 * Pure helper — NO electron import (keeps this unit-testable in node env).
 * Builds the additionalArguments array for BrowserWindow webPreferences.
 */
export function buildAdditionalArguments({
  version,
  smoke,
  dev,
  locale,
}: {
  version: string;
  smoke: boolean;
  dev: boolean;
  /** 窗口创建时已解析的生效 locale(renderer 首帧前应用,避免语言闪换) */
  locale?: string;
}): string[] {
  const args: string[] = [];
  if (version) {
    args.push(`--okwork-version=${version}`);
  }
  if (smoke) {
    args.push('--okwork-smoke');
  }
  if (dev) {
    args.push('--okwork-dev');
  }
  if (locale) {
    args.push(`--okwork-locale=${locale}`);
  }
  return args;
}
