#!/usr/bin/env node
/*
 * T-012: compiled Electron boundary smoke test for the password vault.
 *
 * This intentionally examines Forge's compiled output rather than importing
 * TypeScript source.  It catches a missing preload entry, a regression that
 * makes a renderer-selected preload effective, or a bridge/UI route that is
 * no longer present in the shipped application.
 */
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.vite', 'build');
const rendererDir = path.join(root, '.vite', 'renderer');
const skipBuild = process.argv.includes('--skip-build');
const builtAtArg = process.argv.find((argument) => argument.startsWith('--built-at='));
let buildStartedAt = builtAtArg ? Number(builtAtArg.slice('--built-at='.length)) : 0;

let failures = 0;
function check(condition, description) {
  if (condition) {
    console.log(`PASS ${description}`);
  } else {
    failures += 1;
    console.error(`FAIL ${description}`);
  }
}

function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(target));
    else if (entry.isFile()) result.push(target);
  }
  return result;
}

function findBundle(name, directory) {
  return filesUnder(directory).find((file) => path.basename(file) === name);
}

function readBundle(name, directory) {
  const file = findBundle(name, directory);
  check(Boolean(file), `compiled ${name} exists`);
  if (file && buildStartedAt > 0) {
    check(
      fs.statSync(file).mtimeMs >= buildStartedAt - 2_000,
      `compiled ${name} was refreshed by this build attempt`,
    );
  }
  return file ? fs.readFileSync(file, 'utf8') : '';
}

function includesAll(text, ...needles) {
  return needles.every((needle) => text.includes(needle));
}

if (!skipBuild) {
  console.log('BUILD npm run package');
  buildStartedAt = Date.now();
  const build = spawnSync('npm', ['run', 'package'], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    // Forge runs Vite before its final app-copy phase. In this worktree the
    // latter can fail when an optional native external is absent; the compiled
    // artifacts below, not a stale package exit code, are this test's subject.
    console.warn(
      'WARN Electron Forge package exited non-zero; continuing only if this run produced every compiled artifact.',
    );
  }
  // Forge starts helper processes. Re-exec the runtime journey in a fresh Node
  // process so the Electron driver never inherits a completed build process's
  // handles or environment. The timestamp keeps the artifact check strict.
  const rerun = spawnSync(
    process.execPath,
    [__filename, '--skip-build', `--built-at=${buildStartedAt}`],
    { cwd: root, stdio: 'inherit' },
  );
  process.exitCode = rerun.status ?? 1;
} else {

const mainBundle = readBundle('main.js', buildDir);
const ordinaryPreload = readBundle('preload.js', buildDir);
const guestPreload = readBundle('browserGuestPreload.js', buildDir);
const trustedPreload = readBundle('passwordTrustedPreload.js', buildDir);
const renderer = filesUnder(rendererDir)
  .filter((file) => /\.(?:js|css|html)$/.test(file))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
check(renderer.length > 0, 'compiled renderer assets exist');

// AC-8: a renderer cannot nominate its own preload; BrowserPanel gets the
// main-selected guest bridge and the isolated window gets its own bridge.
check(
  includesAll(mainBundle, 'browserGuestPreload.js', 'passwordTrustedPreload.js', 'passwordTrusted'),
  'main bundle references fixed guest and trusted preload artifacts',
);
check(
  /delete\s+\w+\.preload,delete\s+\w+\.preloadURL/.test(mainBundle),
  'main bundle strips renderer-provided webview preload values before attach',
);
check(
  mainBundle.includes('passwordVaultGuest:lookup') && mainBundle.includes('passwordVaultTrusted:reveal'),
  'main bundle owns separate guest and trusted IPC boundaries',
);
check(
  includesAll(guestPreload, 'passwordVaultGuest:lookup', 'passwordVaultGuest:candidate', 'passwordVaultGuest:result') &&
    !guestPreload.includes('passwordVaultTrusted:reveal'),
  'guest preload contains only constrained page lookup/candidate/result wiring',
);
check(
  includesAll(trustedPreload, 'passwordVaultTrusted:context', 'passwordVaultTrusted:reveal', 'passwordVaultTrusted:copy') &&
    !trustedPreload.includes('passwordVaultGuest:lookup'),
  'trusted preload contains the isolated reveal/copy bridge only',
);
check(
  includesAll(ordinaryPreload, 'passwordVault:capabilities', 'passwordVault:listMetadata', 'passwordVault:openTrusted') &&
    !ordinaryPreload.includes('passwordVaultTrusted:reveal') &&
    !ordinaryPreload.includes('passwordVaultTrusted:copy') &&
    !ordinaryPreload.includes('passwordVaultGuest:lookup'),
  'ordinary preload has metadata/open-window API but no plaintext or guest API',
);

// AC-1 and AC-3: the fixed guest artifact has observable success/failure
// settlement and non-destructive fill behaviour, while main receives status.
check(
  includesAll(guestPreload, 'form_disappeared', 'failed', 'timeout', 'passwordVault:status') &&
    includesAll(mainBundle, 'auth_failed', 'uncertain'),
  'guest and main artifacts emit saved/failure/uncertain browser status evidence',
);
check(
  /!\w+&&\w+\.password\.value/.test(guestPreload) &&
    /!\w+&&\(\(\w+=\w+\.username\)/.test(guestPreload),
  'guest artifact preserves non-empty fields during silent fill',
);

// AC-6 and AC-8: both renderer routes must ship and retain the disclosure
// that a filled DOM value is visible to the page and connected agents.
check(
  includesAll(renderer, 'passwordTrusted', 'Saved Passwords'),
  'renderer artifact ships trusted-window route and saved-passwords management UI',
);
check(
  renderer.includes('Filled values are readable by this page and connected OkBrowser Agents'),
  'browser chrome artifact discloses page/Agent exposure after fill',
);
check(
  renderer.includes('system clipboard') || renderer.includes('Clipboard'),
  'trusted-management UI includes clipboard export disclosure/copy surface',
);

function startLoginFixture() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/login' || url.pathname === '/pre-filled') {
      const prefilled = url.pathname === '/pre-filled';
      response.end(`<!doctype html>
        <title>Password vault fixture</title>
        <main>
          <h1>Sign in</h1>
          <form method="get" action="/signed-in">
            <label>Username <input autocomplete="username" name="username" value="${
              prefilled ? 'manual-user' : ''
            }"></label>
            <label>Password <input type="password" autocomplete="current-password" name="password" value="${
              prefilled ? 'manual-password' : ''
            }"></label>
            <button type="submit">Sign in</button>
          </form>
        </main>`);
      return;
    }
    if (url.pathname === '/signed-in') {
      response.end('<!doctype html><title>Signed in</title><main id="signed-in">Signed in</main>');
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('loopback fixture did not receive a TCP address'));
        return;
      }
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function assertJourney(condition, description) {
  if (!condition) throw new Error(`T-012 journey assertion failed: ${description}`);
  console.log(`PASS ${description}`);
}

async function eventually(action, description, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`${description}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/** Real Electron Browser journey required by TC.md T-012. */
async function run_password_vault_browser_journeys() {
  let electron;
  try {
    ({ _electron: electron } = require('playwright-core'));
  } catch (error) {
    throw new Error(
      `playwright-core Electron driver is required for T-012: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-password-vault-e2e-'));
  let fixture;
  let app;
  let originalClipboard = '';
  let clipboardCaptured = false;
  let journeyCompleted = false;
  let cleanupFailure = null;
  // Never log this value: it proves ordinary pages do not obtain plaintext.
  const password = `pw-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    fixture = await startLoginFixture();
    app = await electron.launch({
      executablePath: require('electron'),
      args: [path.join(root, '.vite', 'build', 'main.js')],
      env: {
        ...process.env,
        OKWORK_E2E_USER_DATA_DIR: userDataDir,
      },
      timeout: 30_000,
    });
    originalClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
    clipboardCaptured = true;
    const mainWindow = await app.firstWindow();
    mainWindow.setDefaultTimeout(15_000);

    // The E2E-only bootstrap creates one disposable workspace. The normal UI
    // then opens its default separate OkBrowser window.
    await eventually(
      () => mainWindow.locator('button[title="Show browser"]').waitFor({ state: 'visible' }),
      'temporary workspace makes the browser control available',
    );
    const browserWindowPromise = app.waitForEvent('window');
    await mainWindow.locator('button[title="Show browser"]').click();
    const browserWindow = await browserWindowPromise;
    browserWindow.setDefaultTimeout(15_000);
    await browserWindow.locator('.browser-panel__address-input').waitFor({ state: 'visible' });
    assertJourney(
      (await browserWindow.locator('.password-status__disclosure').innerText()).includes(
        'Filled values are readable by this page and connected OkBrowser Agents',
      ),
      'OkBrowser chrome continuously discloses page and Agent DOM exposure',
    );

    const address = browserWindow.locator('.browser-panel__address-input');
    const webview = browserWindow.locator('webview');
    async function guestEvaluate(code) {
      return eventually(
        () => webview.evaluate((element, script) => element.executeJavaScript(script), code),
        'webview guest becomes scriptable through its real Electron module boundary',
      );
    }
    async function navigate(pathname) {
      await address.fill(`${fixture.origin}${pathname}`);
      await address.press('Enter');
      await webview.waitFor({ state: 'attached' });
    }

    await navigate('/login');
    await eventually(
      async () => {
        const ready = await guestEvaluate("Boolean(document.querySelector('form'))");
        if (!ready) throw new Error('login fixture has not loaded');
      },
      'loopback standard login form loads in the fixed guest preload',
    );
    await guestEvaluate(
      `(() => {
        const username = document.querySelector('[name=username]');
        const secret = document.querySelector('[name=password]');
        username.value = 'alice';
        secret.value = ${JSON.stringify(password)};
        document.querySelector('form').requestSubmit();
        return true;
      })()`,
    );
    await eventually(
      async () => {
        const signedIn = await guestEvaluate("Boolean(document.querySelector('#signed-in'))");
        if (!signedIn) throw new Error('success page has not loaded');
      },
      'observable same-origin success navigation completes',
    );
    await eventually(
      async () => {
        const text = await browserWindow.locator('.browser-panel').innerText();
        if (!text.includes('New password saved automatically')) throw new Error('saved status absent');
      },
      'AC-1 saves only after observable success and reports non-secret chrome status',
    );

    await navigate('/login');
    await eventually(
      async () => {
        const filled = await guestEvaluate(
          `(() => {
            const username = document.querySelector('[name=username]');
            const secret = document.querySelector('[name=password]');
            return username.value === 'alice' && secret.value === ${JSON.stringify(password)};
          })()`,
        );
        if (!filled) throw new Error('credential not yet filled');
      },
      'AC-3 silently fills a saved single account on the same loopback exact origin',
    );
    assertJourney(
      (await browserWindow.locator('.browser-panel').innerText()).includes('Password filled from'),
      'filled chrome status is visible without exposing the password',
    );

    await navigate('/pre-filled');
    await eventually(
      async () => {
        const preserved = await guestEvaluate(
          "(() => document.querySelector('[name=username]').value === 'manual-user' && document.querySelector('[name=password]').value === 'manual-password')()",
        );
        if (!preserved) throw new Error('silent fill overwrote a non-empty field');
      },
      'AC-3 preserves pre-existing username and password field values',
    );

    await mainWindow.getByTitle('Settings').click();
    await mainWindow.getByRole('menuitem', { name: 'Saved Passwords' }).click();
    await mainWindow.getByRole('heading', { name: 'Saved Passwords' }).waitFor({ state: 'visible' });
    const savedPasswordsText = await mainWindow.locator('.saved-passwords').innerText();
    assertJourney(
      savedPasswordsText.includes(fixture.origin) && savedPasswordsText.includes('alice'),
      'AC-6 management page lists only the saved credential metadata',
    );
    assertJourney(
      !savedPasswordsText.includes(password),
      'ordinary Saved Passwords page never renders the password plaintext',
    );
    assertJourney(
      savedPasswordsText.includes('The website and connected OkBrowser Agents can read values in the page DOM.'),
      'AC-8 management page discloses the filled-DOM exposure boundary',
    );

    const trustedWindowPromise = app.waitForEvent('window');
    await mainWindow.getByRole('button', { name: 'Open trusted window…' }).click();
    const trustedWindow = await trustedWindowPromise;
    trustedWindow.setDefaultTimeout(15_000);
    await trustedWindow.locator('[data-password-action="reveal"]').waitFor({ state: 'visible' });
    assertJourney(
      (await trustedWindow.locator('.trusted-password-window__secret').getAttribute('aria-label')) ===
        'Password masked',
      'trusted window starts with the password masked',
    );
    await trustedWindow.locator('[data-password-action="reveal"]').click();
    await eventually(
      async () => {
        const result = await trustedWindow
          .locator('.trusted-password-window__secret')
          .evaluate((element, expected) => ({
            revealed: element.textContent === expected,
            label: element.getAttribute('aria-label'),
            error: document.querySelector('.trusted-password-window__error')?.textContent ?? '',
          }), password);
        if (!result.revealed) {
          throw new Error(
            `trusted reveal did not receive the expected password (label=${result.label}; error=${result.error})`,
          );
        }
      },
      'AC-6 real user click reveals plaintext only in the isolated trusted window',
    );
    assertJourney(true, 'AC-6 real user click reveals plaintext only in the isolated trusted window');
    assertJourney(
      !(await mainWindow.locator('.saved-passwords').innerText()).includes(password),
      'reveal leaves the ordinary management renderer without plaintext',
    );
    await trustedWindow.locator('[data-password-action="copy"]').click();
    await eventually(
      async () => {
        const copied = await app.evaluate(
          ({ clipboard }, expected) => clipboard.readText() === expected,
          password,
        );
        if (!copied) throw new Error('clipboard did not receive the trusted-window export');
      },
      'AC-6 real trusted-window click exports the password to the system clipboard',
    );
    assertJourney(true, 'AC-6 real trusted-window click exports the password to the system clipboard');
    assertJourney(
      (await trustedWindow.locator('.trusted-password-window__body').innerText()).includes(
        'Other apps and ordinary OkWork pages may read it.',
      ),
      'trusted copy UI discloses the explicit clipboard export boundary',
    );
    journeyCompleted = true;
  } finally {
    // Clipboard is global OS state. Restore before closing Electron because the
    // product's lease intentionally clears an unchanged copied value on exit.
    if (app && clipboardCaptured) {
      try {
        await app.evaluate(({ clipboard }, original) => clipboard.writeText(original), originalClipboard);
        const restored = await app.evaluate(
          ({ clipboard }, original) => clipboard.readText() === original,
          originalClipboard,
        );
        if (!restored) throw new Error('clipboard readback differs after restoration');
        console.log('PASS E2E restores the pre-existing system clipboard text');
      } catch (error) {
        cleanupFailure = new Error(
          `T-012 could not restore the prior clipboard text: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (app) await app.close().catch(() => undefined);
    if (fixture) await closeServer(fixture.server).catch(() => undefined);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  if (cleanupFailure) throw cleanupFailure;
  if (journeyCompleted) console.log('T-012 ELECTRON JOURNEYS: PASS');
}

async function main() {
  if (failures > 0) {
    throw new Error(`T-012 CONTRACT failed with ${failures} assertion${failures === 1 ? '' : 's'}`);
  }
  console.log('\nT-012 CONTRACT: PASS (compiled boundary assertions)');
  await run_password_vault_browser_journeys();
}

void main().catch((error) => {
  console.error(`T-012: FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
}
