# Password-vault E2E validation (T-012)

Run the compiled-boundary validation from the repository root:

```sh
node e2e/password-vault.e2e.cjs
```

The command runs `npm run package`, then checks the generated Electron Forge
artifacts under `.vite/`. Forge's Vite phase produces these artifacts before
the final macOS package-copy phase. If that later phase fails because a native
external is absent, the script continues only when every current compiled
artifact exists, and reports the package failure as a warning. It verifies the
security-critical wiring that a source-only test could miss:

- main selects the fixed guest and trusted preload artifacts and strips a
  renderer-provided webview preload;
- the normal preload contains only metadata/open-window password operations,
  not trusted reveal/copy or guest lookup operations;
- guest/trusted preloads expose distinct constrained channels;
- compiled renderer assets contain the Saved passwords/trusted-window route,
  browser status behaviour, and the page/Agent exposure disclosure.

Use `--skip-build` only after a successful build when iterating on the
artifact checks and browser journey.

## Real Electron journey

The script uses `playwright-core`'s Electron driver, launches the compiled
application, and starts a disposable loopback login fixture. It creates a
`mkdtemp` user-data directory and passes it through the development-only,
absolute-path `OKWORK_E2E_USER_DATA_DIR` hook; the app names this Safe Storage
service `OkWork-E2E`. The script deletes only that directory in `finally`.

The journey covers successful loopback login save, revisit fill, pre-filled
field preservation, the normal Saved Passwords metadata page and disclosures,
and trusted reveal/copy. It saves the real system clipboard before testing and
restores it in `finally`; the generated password sentinel is never logged.

The test intentionally fails if any real GUI action is blocked or a secret
appears in the ordinary renderer. It does not report skipped browser journeys
as passed.
