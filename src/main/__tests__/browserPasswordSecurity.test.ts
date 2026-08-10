import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PASSWORD_VAULT_CHANNELS } from '../../shared/passwordVault';
import {
  PasswordVaultController,
  type DecryptedPasswordCredentialLike,
  type PasswordGuestSender,
  type PasswordVaultPort,
} from '../passwordVaultController';

const PROFILE_A = 'a'.repeat(32);
const PROFILE_B = 'b'.repeat(32);
const SECRET = 'BL006-security-sentinel';

class Guest implements PasswordGuestSender {
  readonly sent: unknown[][] = [];
  constructor(
    readonly id: number,
    private readonly url: string,
  ) {}
  getURL(): string {
    return this.url;
  }
  isDestroyed(): boolean {
    return false;
  }
  send(_channel: string, ...args: unknown[]): void {
    this.sent.push(args);
  }
  once(): unknown {
    return undefined;
  }
}

function vault(): PasswordVaultPort {
  const entry: DecryptedPasswordCredentialLike = {
    id: 'entry-1',
    profileId: PROFILE_A,
    origin: 'https://accounts.example.test',
    username: 'alice',
    password: SECRET,
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: 1,
  };
  return {
    isAvailable: () => true,
    listMetadata: async () => ({
      entries: [
        {
          id: entry.id,
          profileId: entry.profileId,
          origin: entry.origin,
          username: entry.username,
          createdAt: 1,
          updatedAt: 1,
          lastUsedAt: 1,
        },
      ],
      unavailableProfiles: [],
    }),
    lookup: async (profileId, origin) =>
      profileId === entry.profileId && origin === entry.origin ? [entry] : [],
    getDecrypted: async (profileId, id) => {
      if (profileId !== entry.profileId || id !== entry.id)
        throw Object.assign(new Error('not found'), {
          code: 'VAULT_ENTRY_NOT_FOUND',
        });
      return entry;
    },
    upsert: vi.fn(),
    deleteEntry: vi.fn(async () => false),
    deleteProfile: vi.fn(async () => false),
  };
}

describe('browser password trust boundaries', () => {
  it('test_AC8_rejects_untrusted_vault_access_while_disclosing_dom_and_clipboard_exports', async () => {
    const controller = new PasswordVaultController({
      vault: vault(),
      isProfileActive: () => true,
      onMetadataChanged: vi.fn(),
    });
    const websiteOrAgent = new Guest(
      100,
      'https://accounts.example.test/login',
    );
    const wrongProfileGuest = new Guest(
      101,
      'https://accounts.example.test/login',
    );
    const trustedGuest = new Guest(102, 'https://accounts.example.test/login');
    controller.registerGuest(wrongProfileGuest, PROFILE_B, 10);
    controller.registerGuest(trustedGuest, PROFILE_A, 10);

    // A page/Agent that is not registered by main cannot enumerate, capture, or decrypt anything.
    await expect(controller.lookup(websiteOrAgent.id, {})).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(
      controller.acceptCandidate(websiteOrAgent.id, {
        nonce: 'n',
        username: 'alice',
        password: SECRET,
      }),
    ).toBe(false);
    await expect(
      controller.fillEntry(websiteOrAgent.id, 'entry-1'),
    ).resolves.toBe(false);
    // A registered guest in another Profile does not receive credentials from Profile A.
    await expect(controller.lookup(wrongProfileGuest.id, {})).resolves.toEqual({
      kind: 'none',
    });
    // The fixed guest gets exactly the current page credential, which is the intentional DOM export.
    await expect(controller.lookup(trustedGuest.id, {})).resolves.toMatchObject(
      { kind: 'credential', username: 'alice', password: SECRET },
    );

    const ordinaryPreload = fs.readFileSync(
      path.join(process.cwd(), 'src/preload/preload.ts'),
      'utf8',
    );
    const mainWiring = fs.readFileSync(
      path.join(process.cwd(), 'src/main/main.ts'),
      'utf8',
    );
    const savedPasswords = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/renderer/components/settings/SavedPasswordsPage.tsx',
      ),
      'utf8',
    );
    const browserChrome = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/renderer/components/browser/PasswordStatusBar.tsx',
      ),
      'utf8',
    );
    expect(Object.keys(PASSWORD_VAULT_CHANNELS).join(',')).not.toMatch(
      /reveal|copy|decrypt/i,
    );
    expect(ordinaryPreload).not.toContain('passwordTrusted:');
    expect(savedPasswords).toContain(
      'connected OkBrowser Agents can read values in the page DOM',
    );
    expect(savedPasswords).toContain(
      'Other apps and ordinary OkWork pages may read the exported value',
    );
    expect(browserChrome).not.toContain(
      'Filled values are readable by this page and connected OkBrowser Agents',
    );
    expect(browserChrome).not.toContain(
      'other local apps and ordinary OkWork pages may read the password from the system clipboard',
    );
    expect(browserChrome).toContain(
      'The page session may continue, but password save and fill are paused.',
    );
    const profileSettings = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/renderer/components/settings/BrowserProfilesSection.tsx',
      ),
      'utf8',
    );
    expect(profileSettings).not.toContain(
      'other local apps and ordinary OkWork pages may read the password from the system clipboard',
    );
    expect(profileSettings).not.toMatch(/AUTHORITY/);
    expect(mainWiring).toMatch(
      /profileCatalog\.getEntry\(profileId\)\?\.lifecycle === ["']active["']/,
    );
    expect(mainWiring).toContain(
      'passwordVaultIpc.closeProfileTrustedWindows(profileId)',
    );
  });
});
