// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import type { PasswordCredentialMetadata } from '../../../../shared/passwordVault';
import { SavedPasswordsPage, type SavedPasswordsPageProps } from '../SavedPasswordsPage';

expect.extend(matchers);

const PROFILES = [
  { id: 'profile-work', name: 'Work' },
  { id: 'profile-personal', name: 'Personal' },
];

const ENTRIES: PasswordCredentialMetadata[] = [
  {
    id: 'entry-github',
    profileId: 'profile-work',
    origin: 'https://github.com',
    username: 'alice@example.com',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    lastUsedAt: 1_700_000_000_000,
  },
  {
    id: 'entry-aws',
    profileId: 'profile-personal',
    origin: 'https://console.aws.amazon.com',
    username: 'bob@example.com',
    createdAt: 1_710_000_000_000,
    updatedAt: 1_710_000_000_000,
    lastUsedAt: 1_710_000_000_000,
  },
];

function props(overrides: Partial<SavedPasswordsPageProps> = {}): SavedPasswordsPageProps {
  return {
    entries: ENTRIES,
    profiles: PROFILES,
    state: 'ready',
    onDelete: vi.fn().mockResolvedValue(undefined),
    onOpenTrusted: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function test_AC6_renders_masked_metadata_states_and_filters() {
  const { rerender } = render(<SavedPasswordsPage {...props({ state: 'loading' })} />);

  expect(screen.getByLabelText('Loading saved passwords')).toBeInTheDocument();
  expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();

  rerender(
    <SavedPasswordsPage
      {...props({ state: 'error', errorCode: 'VAULT_CORRUPT', entries: [] })}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load saved passwords');
  expect(screen.getByRole('alert')).toHaveTextContent('could not be read safely');

  rerender(<SavedPasswordsPage {...props({ state: 'ready' })} />);
  expect(screen.getByText('https://github.com')).toBeInTheDocument();
  expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  expect(screen.getByText('https://console.aws.amazon.com')).toBeInTheDocument();
  expect(screen.getAllByLabelText('Password masked')).toHaveLength(2);

  const search = screen.getByPlaceholderText('Search site, username or Profile');
  fireEvent.change(search, { target: { value: 'console.aws' } });
  expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
  expect(screen.getByText('bob@example.com')).toBeInTheDocument();

  fireEvent.change(search, { target: { value: 'alice@example.com' } });
  expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();

  fireEvent.change(search, { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Filter by Profile'), {
    target: { value: 'profile-personal' },
  });
  expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
  expect(screen.getByText('bob@example.com')).toBeInTheDocument();

  fireEvent.change(search, { target: { value: 'does-not-exist' } });
  expect(screen.getByRole('status')).toHaveTextContent('No matching saved passwords');

  rerender(<SavedPasswordsPage {...props({ state: 'ready', entries: [] })} />);
  expect(screen.getByRole('status')).toHaveTextContent('No saved passwords yet');
}

describe('SavedPasswordsPage', () => {
  it('T-006 / AC-6 renders masked metadata states and filters', async () => {
    await test_AC6_renders_masked_metadata_states_and_filters();
  });

  it('opens only the trusted window and deletes through explicit inline confirmation', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onOpenTrusted = vi.fn().mockResolvedValue(undefined);
    render(<SavedPasswordsPage {...props({ onDelete, onOpenTrusted })} />);

    const githubRow = screen.getByText('alice@example.com').closest('article');
    expect(githubRow).not.toBeNull();
    fireEvent.click(within(githubRow!).getByRole('button', { name: 'Open trusted window…' }));
    await waitFor(() => expect(onOpenTrusted).toHaveBeenCalledWith(ENTRIES[0]));

    fireEvent.click(within(githubRow!).getByRole('button', { name: 'Delete' }));
    expect(within(githubRow!).getByText('Delete this saved password?')).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(within(githubRow!).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(ENTRIES[0]));
  });

  it('fails closed when encryption is unavailable and keeps disclosure visible', () => {
    render(<SavedPasswordsPage {...props({ state: 'unavailable' })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Password protection is unavailable');
    expect(screen.getAllByRole('button', { name: 'Open trusted window…' })[0]).toBeDisabled();
    expect(screen.getByText('After filling a web page')).toBeInTheDocument();
    expect(screen.getByText('After copying to the clipboard')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Password masked')).toHaveLength(2);
  });
});
