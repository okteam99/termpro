// AC-2 失败分类从 shared/remoteHost.ts 单源派生(EXT-6)——connect()/test() 两条
// 路径共享同一套 FailReason key + 文案,不各写字面量。
import { describe, it, expect } from 'vitest';
import { FAIL_REASON_COPY, type FailReason } from '../../../shared/remoteHost';
import { classifyConnectError } from '../orchestrator';

const ALL_REASONS: FailReason[] = [
  'unreachable',
  'auth',
  'timeout',
  'nodeMissing',
  'archUnsupported',
  'deployFailed',
  'startFailed',
  'incompatible',
  'internal',
];

describe('AC-2 failure taxonomy single source', () => {
  it('T-004 FAIL_REASON_COPY 覆盖全部 9 类,每类都有 label', () => {
    for (const reason of ALL_REASONS) {
      expect(FAIL_REASON_COPY[reason]).toBeDefined();
      expect(typeof FAIL_REASON_COPY[reason].label).toBe('string');
      expect(FAIL_REASON_COPY[reason].label.length).toBeGreaterThan(0);
    }
    expect(Object.keys(FAIL_REASON_COPY).sort()).toEqual([...ALL_REASONS].sort());
  });

  it('classifyConnectError(connect/test 共用)产出的 reason 始终是 shared 枚举成员', () => {
    const cases: Array<{ err: Error; expected: FailReason }> = [
      { err: new Error('connect ECONNREFUSED 1.2.3.4:22'), expected: 'unreachable' },
      { err: new Error('getaddrinfo ENOTFOUND bad.host'), expected: 'unreachable' },
      { err: new Error('All configured authentication methods failed'), expected: 'auth' },
      { err: new Error('Timed out while waiting for handshake'), expected: 'timeout' },
      { err: new Error('mystery ssh2 internal failure'), expected: 'internal' },
    ];
    for (const { err, expected } of cases) {
      const reason = classifyConnectError(err);
      expect(reason).toBe(expected);
      expect(FAIL_REASON_COPY[reason]).toBeDefined();
    }
  });
});
