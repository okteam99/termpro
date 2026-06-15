// E2E 回归:TERMPRO-B260615152207 · WebGL 字形图集分页变更整屏重绘消除 CJK 乱码
//
// 复现根因触发路径(真实 Electron 渲染进程 · 真实 WebGL · 真实 @xterm/addon-webgl):
//   向一个挂载了真实 WebglAddon 的 Terminal 写入大量「不同」CJK 字形,撑爆字形图集分页
//   上限,触发真实的 onRemoveTextureAtlasCanvas(页合并/删页 = texturePage 索引重排,
//   正是乱码根因)。断言:① 该事件在 CJK 海量字形下确实触发(验证根因假设);
//   ② 被测的真实修复 wireWebglAtlasResync(经 esbuild 现场转译 src 原文件)在该事件后
//   确实触发 term.refresh 整屏重绘(验证修复生效路径)。
//
// jsdom 无 WebGL,故此验证只能在真实 Electron 渲染进程跑(单测覆盖接线契约,本 e2e 覆盖
// 「真实图集在 CJK 下确会溢出 + 修复确会响应」)。像素级「肉眼无乱码」仍需真人在窗口确认。
//
// 运行(在 worktree 根):
//   node_modules/.bin/electron docs/features/TERMPRO-B260615152207/e2e/atlas-resync.e2e.cjs
// 退出码:0 = PASS 或 环境性 SKIP(WebGL 不可用 / 未在时限内溢出);非 0 = 真失败。

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const esbuild = require('esbuild');

// 本文件位于 <worktree>/docs/features/TERMPRO-B260615152207/e2e/ · 上溯 4 级到 worktree 根
const WT = path.resolve(__dirname, '../../../..');
const xtermJs = path.join(WT, 'node_modules/@xterm/xterm/lib/xterm.js');
const webglJs = path.join(WT, 'node_modules/@xterm/addon-webgl/lib/addon-webgl.js');
const uni11Js = path.join(WT, 'node_modules/@xterm/addon-unicode11/lib/addon-unicode11.js');
const xtermCss = fs.readFileSync(path.join(WT, 'node_modules/@xterm/xterm/css/xterm.css'), 'utf8');

app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// 现场把被测的真实修复源文件转成 CJS · e2e 跑的是生产代码本身(非复刻)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'termpro-e2e-atlas-'));
const helperCjs = path.join(tmp, 'webglAtlasResync.cjs');
esbuild.buildSync({
  entryPoints: [path.join(WT, 'src/renderer/terminal/webglAtlasResync.ts')],
  outfile: helperCjs,
  bundle: true,
  format: 'cjs',
  platform: 'node',
});

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${xtermCss}
html,body{margin:0;background:#1e2227} #t{width:920px;height:620px}
</style></head><body><div id="t"></div><script>
const { ipcRenderer } = require('electron');
const send = (r) => ipcRenderer.send('e2e-result', r);
try {
  const { Terminal } = require(${JSON.stringify(xtermJs)});
  const { WebglAddon } = require(${JSON.stringify(webglJs)});
  const { Unicode11Addon } = require(${JSON.stringify(uni11Js)});
  const { wireWebglAtlasResync } = require(${JSON.stringify(helperCjs)});

  const term = new Terminal({ allowProposedApi: true, fontFamily: 'Menlo, Monaco, monospace', fontSize: 13, scrollback: 0 });
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  term.open(document.getElementById('t'));

  let webgl = null, webglErr = null;
  try { webgl = new WebglAddon(); term.loadAddon(webgl); } catch (e) { webglErr = String(e); }
  if (!webgl) { send({ webglActive: false, webglErr }); }
  else {
    let removeFired = 0;
    webgl.onRemoveTextureAtlasCanvas(() => { removeFired++; });
    // 在接线修复之前包裹 term.refresh —— 只有修复在 onRemove 上调度的整屏重绘会经过这里
    // (xterm 内部走 RenderService.refreshRows · 不经公开 term.refresh),故计数=修复的响应
    let helperRefreshCount = 0;
    const origRefresh = term.refresh.bind(term);
    term.refresh = (s, e) => { helperRefreshCount++; return origRefresh(s, e); };
    wireWebglAtlasResync(webgl, term);

    const cols = term.cols || 80, rows = term.rows || 24;
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    (async () => {
      let code = 0x4e00, written = 0;
      const CAP = 24000, DEADLINE = Date.now() + 25000;
      // 每屏写满「全不同」CJK,逼真实图集逐页填满 → 超过 maxAtlasPages → 合并/删页
      while (removeFired === 0 && written < CAP && Date.now() < DEADLINE) {
        let s = '';
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            s += String.fromCodePoint(code++);
            written++;
            if (code > 0x9fa5) code = 0x4e00;
          }
          s += '\\r\\n';
        }
        term.write(s);
        await raf(); await raf(); // 让 WebGL 渲染器实际绘制 → 字形进图集
      }
      // 让修复在 onRemove 上排的微任务 refresh 跑完
      await raf(); await raf();
      send({ webglActive: true, removeFired, helperRefreshCount, written, cols, rows });
    })();
  }
} catch (e) { send({ fatal: String((e && e.stack) || e) }); }
</script></body></html>`;

const htmlPath = path.join(tmp, 'runner.html');
fs.writeFileSync(htmlPath, html);

let finished = false;
const finish = (code, msg) => {
  if (finished) return;
  finished = true;
  console.log(msg);
  try { app.exit(code); } catch (_) { process.exit(code); }
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: true, width: 1000, height: 720,
    webPreferences: { offscreen: false, nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  ipcMain.on('e2e-result', (_e, r) => {
    console.log('E2E_RESULT ' + JSON.stringify(r));
    if (r.fatal) return finish(2, 'E2E_FAIL fatal: ' + r.fatal);
    if (r.webglActive === false) return finish(0, 'E2E_SKIP webgl-unavailable: ' + (r.webglErr || ''));
    if (r.removeFired > 0 && r.helperRefreshCount > 0) return finish(0, 'E2E_OK atlas-overflow→resync (removeFired=' + r.removeFired + ' refresh=' + r.helperRefreshCount + ' glyphs=' + r.written + ')');
    if (r.removeFired === 0) return finish(0, 'E2E_SKIP atlas-no-overflow-in-window (glyphs=' + r.written + ')');
    return finish(2, 'E2E_FAIL resync-not-triggered ' + JSON.stringify(r));
  });
  await win.loadURL('file://' + htmlPath);
});

setTimeout(() => finish(5, 'E2E_TIMEOUT'), 60000);
