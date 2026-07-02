import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs';
import path from 'node:path';

// plugin-vite 打包时不携带 node_modules(默认一切被 vite 打进 bundle),
// 但 node-pty 是原生模块、在 vite.host.config 里 external,
// 必须在 packageAfterCopy 钩子里手动搬进产物(含其运行时依赖)。
const EXTERNAL_MODULES = ['node-pty'];

async function copyModuleWithDeps(
  name: string,
  buildPath: string,
  seen: Set<string>,
): Promise<void> {
  if (seen.has(name)) return;
  seen.add(name);
  const src = path.join(__dirname, 'node_modules', name);
  if (!fs.existsSync(src)) throw new Error(`external module not found: ${name}`);
  await fs.promises.cp(src, path.join(buildPath, 'node_modules', name), {
    recursive: true,
    dereference: true,
  });
  const pkg = JSON.parse(
    await fs.promises.readFile(path.join(src, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    await copyModuleWithDeps(dep, buildPath, seen);
  }
}

// 签名/公证:与 cmux-pro 同一套 secrets 体系(APPLE_*)。
// 环境变量缺省时回退 ad-hoc 签名,本地 npm run make 不受影响。
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY;
const canNotarize =
  !!process.env.APPLE_ID &&
  !!process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  !!process.env.APPLE_TEAM_ID;

// make:dev 出 DEV 渠道包:独立名称/bundleId/userData,与正式版可同时安装
const isDevBuild = !!process.env.TERMPRO_DEV_BUILD;

const config: ForgeConfig = {
  packagerConfig: {
    // node-pty 整目录解出 asar:prebuilds 里除了 .node 还有
    // spawn-helper 可执行文件,留在 asar 内无法 exec
    asar: { unpack: '**/node_modules/node-pty/**' },
    name: isDevBuild ? 'TermPro Dev' : 'TermPro',
    appBundleId: isDevBuild
      ? 'com.okteam99.termpro.dev'
      : 'com.okteam99.termpro',
    icon: './assets/icon', // packager 自动按平台补 .icns/.ico
    // Markdown 文件关联:Finder「打开方式」推荐 TermPro(Alternate = 不抢默认,
    // 仅进候选列表);双击 .md 由 main 的 open-file 事件路由到查看器窗口。
    // 仅对打包后的 .app 生效(Launch Services 扫描 bundle);dev 模式不注册。
    extendInfo: {
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'Markdown Document',
          CFBundleTypeRole: 'Viewer',
          LSHandlerRank: 'Alternate',
          CFBundleTypeExtensions: [
            'md',
            'markdown',
            'mdown',
            'mkd',
            'mdwn',
            'mkdn',
            'markdn',
          ],
          LSItemContentTypes: ['net.daringfireball.markdown', 'public.markdown'],
        },
      ],
    },
    ...(signingIdentity
      ? {
          osxSign: { identity: signingIdentity },
          ...(canNotarize
            ? {
                osxNotarize: {
                  appleId: process.env.APPLE_ID!,
                  appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD!,
                  teamId: process.env.APPLE_TEAM_ID!,
                },
              }
            : {}),
        }
      : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    // 拖拽安装 DMG;注意:DMG 不解决 Gatekeeper——签名+公证才是「下载即开」的前提
    new MakerDMG({ format: 'ULFO' }, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      const seen = new Set<string>();
      for (const name of EXTERNAL_MODULES) {
        await copyModuleWithDeps(name, buildPath, seen);
      }
      // 裁掉无关平台的 prebuilds,减小包体
      const prebuilds = path.join(buildPath, 'node_modules/node-pty/prebuilds');
      for (const entry of await fs.promises.readdir(prebuilds)) {
        if (!entry.startsWith('darwin-')) {
          await fs.promises.rm(path.join(prebuilds, entry), {
            recursive: true,
            force: true,
          });
        }
      }
    },
  },
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          // Host process: pure Node, forked via utilityProcess. Built as a
          // separate entry so it stays free of Electron imports (remote-ready).
          entry: 'src/host/host.ts',
          config: 'vite.host.config.ts',
          target: 'main',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
