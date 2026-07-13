#!/usr/bin/env node
// Host 独立部署产物打包脚本(阶段 F 打包 spike / TECH 步骤 14)。
//
// 产出:<out>/host.js(vite 打的单 JS bundle,ws 打入 · node-pty/bufferutil/utf-8-validate
// 保留 external)+ <out>/node_modules/node-pty(仅目标平台原生二进制,裁到 lib/ + build/Release/)
// + 最小 <out>/package.json(engines.node>=20)+ README.md。可选 --tar 直接打 tar.gz。
//
// 不驱动 electron-forge 的既有打包(forge.config.ts / vite.host.config.ts 不变),
// 这是一条独立于 forge 的 standalone 产物流水线,同时供本地验证与 CI 复用。
//
// 用法:
//   node scripts/package-host.mjs --out <dir> [--platform darwin-arm64]
//     [--native-dir <含 pty.node(+spawn-helper) 的目录>] [--tar <path.tar.gz>]
//
// --platform 只是产物标签(默认 `${process.platform}-${process.arch}`),不驱动交叉编译。
// --native-dir 缺省时按优先级自动探测本地 node_modules/node-pty:
//   1) build/Release/(node-gyp 源码编译产物,linux CI 走这条)
//   2) prebuilds/<platform>/(darwin/win 的官方预编译,本机走这条)

import { build } from 'vite';
import { builtinModules } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { out: null, platform: null, nativeDir: null, tar: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--platform') opts.platform = argv[++i];
    else if (a === '--native-dir') opts.nativeDir = argv[++i];
    else if (a === '--tar') opts.tar = argv[++i];
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!opts.out) throw new Error('--out <dir> is required');
  return opts;
}

/** vite 打 host.ts 成单 CJS 文件(复用 forge vite 插件对 main-target build 的口径:
 * node builtins external + node-pty/bufferutil/utf-8-validate external,见 vite.host.config.ts
 * 与 @electron-forge/plugin-vite 的 vite.main.config.js/vite.base.config.js)。 */
async function bundleHost(outDir) {
  const external = [
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
    'node-pty',
    'bufferutil',
    'utf-8-validate',
  ];
  await build({
    configFile: false,
    logLevel: 'warn',
    resolve: {
      conditions: ['node'],
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: path.join(repoRoot, 'src/host/host.ts'),
        fileName: () => 'host.js',
        formats: ['cjs'],
      },
      rollupOptions: { external },
    },
  });
}

/** 探测本地 node-pty 原生二进制目录(build/Release 优先,其次 prebuilds/<platform>)。 */
function detectNativeDir(platformLabel) {
  const pkgDir = path.join(repoRoot, 'node_modules/node-pty');
  const buildRelease = path.join(pkgDir, 'build/Release');
  if (
    fs.existsSync(path.join(buildRelease, 'pty.node')) ||
    fs.existsSync(path.join(buildRelease, 'pty.node.node'))
  ) {
    return buildRelease;
  }
  const prebuild = path.join(pkgDir, 'prebuilds', platformLabel);
  if (fs.existsSync(path.join(prebuild, 'pty.node'))) return prebuild;
  return null;
}

async function copyJsOnly(src, dst) {
  await fs.promises.cp(src, dst, {
    recursive: true,
    filter: (s) => {
      const st = fs.statSync(s);
      if (st.isDirectory()) return true;
      return s.endsWith('.js') && !s.endsWith('.test.js');
    },
  });
}

/** 组装 <out>/node_modules/node-pty:最小 package.json + lib/(仅 .js,剔除 *.test.js)
 * + build/Release/{pty.node,spawn-helper}(来自 nativeDir)。 */
async function assembleNodePty(outDir, nativeDir) {
  const srcPkgRaw = await fs.promises.readFile(
    path.join(repoRoot, 'node_modules/node-pty/package.json'),
    'utf8',
  );
  const srcPkg = JSON.parse(srcPkgRaw);
  const destDir = path.join(outDir, 'node_modules/node-pty');
  await fs.promises.mkdir(destDir, { recursive: true });

  // 最小 package.json:去掉 scripts(install/postinstall 会误触发 node-gyp)与开发期依赖,
  // 只留运行时 require('node-pty') 需要的 main 入口。
  await fs.promises.writeFile(
    path.join(destDir, 'package.json'),
    JSON.stringify({ name: srcPkg.name, version: srcPkg.version, main: srcPkg.main }, null, 2),
  );

  await copyJsOnly(
    path.join(repoRoot, 'node_modules/node-pty/lib'),
    path.join(destDir, 'lib'),
  );

  const destRelease = path.join(destDir, 'build/Release');
  await fs.promises.mkdir(destRelease, { recursive: true });
  for (const name of ['pty.node', 'spawn-helper', 'conpty.node', 'winpty.dll']) {
    const src = path.join(nativeDir, name);
    if (fs.existsSync(src)) {
      await fs.promises.copyFile(src, path.join(destRelease, name));
      if (name === 'spawn-helper') await fs.promises.chmod(path.join(destRelease, name), 0o755);
    }
  }
  if (!fs.existsSync(path.join(destRelease, 'pty.node'))) {
    throw new Error(`no pty.node found in native dir: ${nativeDir}`);
  }
}

async function writeArtifactMeta(outDir, platformLabel) {
  const rootPkg = JSON.parse(
    await fs.promises.readFile(path.join(repoRoot, 'package.json'), 'utf8'),
  );
  await fs.promises.writeFile(
    path.join(outDir, 'package.json'),
    JSON.stringify(
      {
        name: 'okwork-host',
        version: rootPkg.version,
        private: true,
        main: 'host.js',
        engines: { node: '>=20' },
      },
      null,
      2,
    ),
  );
  await fs.promises.writeFile(
    path.join(outDir, 'README.md'),
    `# OkWork Host — standalone artifact (spike, platform: ${platformLabel})\n\n` +
      `产物内容:\`host.js\`(vite bundle,ws 已打入,node-pty 保持 external)+ \`node_modules/node-pty\`\n` +
      `(仅本平台原生二进制)。要求 Node >= 20。\n\n` +
      `## 启动\n\n\`\`\`sh\nOKWORK_HOST_TOKEN=<your-token> node host.js --listen 127.0.0.1:<port>\n\`\`\`\n\n` +
      `不传 \`OKWORK_HOST_TOKEN\` 时自动生成 128-bit token,单行打印:\n\`\`\`\n[host] token=<token>\n\`\`\`\n\n` +
      `就绪日志(可 grep):\n\`\`\`\n[host] listening ws://127.0.0.1:<port> protocol=v1\n\`\`\`\n\n` +
      `见 \`scripts/verify-host-artifact.mjs\`(仓库内)对本产物做端到端验证(WS 握手 + PTY 真实 spawn)。\n`,
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const platformLabel = opts.platform ?? `${process.platform}-${process.arch}`;
  const outDir = path.resolve(opts.out);
  await fs.promises.rm(outDir, { recursive: true, force: true });
  await fs.promises.mkdir(outDir, { recursive: true });

  console.log(`[package-host] bundling host.ts -> ${path.join(outDir, 'host.js')}`);
  await bundleHost(outDir);

  const nativeDir = opts.nativeDir ? path.resolve(opts.nativeDir) : detectNativeDir(platformLabel);
  if (!nativeDir) {
    throw new Error(
      `could not auto-detect node-pty native dir for platform=${platformLabel}; pass --native-dir`,
    );
  }
  console.log(`[package-host] assembling node-pty native (source: ${nativeDir})`);
  await assembleNodePty(outDir, nativeDir);

  await writeArtifactMeta(outDir, platformLabel);

  if (opts.tar) {
    const tarPath = path.resolve(opts.tar);
    await fs.promises.mkdir(path.dirname(tarPath), { recursive: true });
    console.log(`[package-host] tar -czf ${tarPath}`);
    execFileSync('tar', ['-czf', tarPath, '-C', path.dirname(outDir), path.basename(outDir)]);
  }

  console.log(`[package-host] done: ${outDir}`);
}

main().catch((err) => {
  console.error('[package-host] failed:', err);
  process.exit(1);
});
