export function isSystemBrowserUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isInternalDevServerNavigation(
  raw: string,
  devServerUrl: string | undefined,
): boolean {
  if (!devServerUrl) return false;
  try {
    const target = new URL(raw);
    const devServer = new URL(devServerUrl);
    return target.origin === devServer.origin;
  } catch {
    return false;
  }
}
