// hostBundle.detectArch:uname -sm → HostArch 归一化(AC-4)。
import { describe, it, expect } from 'vitest';
import { detectArch, resolveBundleDir } from '../hostBundle';

describe('detectArch', () => {
  it('Darwin arm64 → darwin-arm64', () => {
    expect(detectArch('Darwin arm64')).toBe('darwin-arm64');
  });
  it('Linux x86_64 → linux-x64', () => {
    expect(detectArch('Linux x86_64')).toBe('linux-x64');
  });
  it('Linux amd64 → linux-x64(部分发行版归一化输出)', () => {
    expect(detectArch('Linux amd64')).toBe('linux-x64');
  });
  it('Linux aarch64 → linux-arm64', () => {
    expect(detectArch('Linux aarch64')).toBe('linux-arm64');
  });
  it('未知架构 → null(archUnsupported)', () => {
    expect(detectArch('Darwin x86_64')).toBeNull();
    expect(detectArch('FreeBSD amd64')).toBeNull();
    expect(detectArch('')).toBeNull();
  });
  it('容忍首尾空白/多余空格', () => {
    expect(detectArch('  Linux   x86_64  \n')).toBe('linux-x64');
  });
});

describe('resolveBundleDir', () => {
  it('打包态取 resourcesPath/host-bundles/<arch>', () => {
    const dir = resolveBundleDir('darwin-arm64', { resourcesPath: '/App/Resources', isPackaged: true });
    expect(dir).toBe('/App/Resources/host-bundles/darwin-arm64');
  });
  it('dev 态取 <repoRoot>/out/host-bundles/<arch>', () => {
    const dir = resolveBundleDir('linux-x64', { resourcesPath: '/repo', isPackaged: false });
    expect(dir).toBe('/repo/out/host-bundles/linux-x64');
  });
});
