/**
 * Pure helper — NO electron import (keeps this unit-testable in node env).
 * Builds the additionalArguments array for BrowserWindow webPreferences.
 */
export function buildAdditionalArguments({
  version,
  smoke,
  dev,
}: {
  version: string;
  smoke: boolean;
  dev: boolean;
}): string[] {
  const args: string[] = [];
  if (version) {
    args.push(`--termpro-version=${version}`);
  }
  if (smoke) {
    args.push('--termpro-smoke');
  }
  if (dev) {
    args.push('--termpro-dev');
  }
  return args;
}
