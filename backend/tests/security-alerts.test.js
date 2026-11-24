import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-security-alerts';

const [{ AuditEvent }, { SecurityAlert }, { User }, { PushSubscription }, securityAlerts] = await Promise.all([
  import('../src/models/AuditEvent.js'),
  import('../src/models/SecurityAlert.js'),
  import('../src/models/User.js'),
  import('../src/models/PushSubscription.js'),
  import('../src/lib/securityAlerts.js'),
]);
const {
  raiseLoginFailureAlerts,
  raiseUnavailableRecordAlerts,
  raiseRevokedSessionReuseAlert,
} = securityAlerts;

const originalCountDocuments = AuditEvent.countDocuments;
const originalAuditCreate = AuditEvent.create;
const originalAlertCreate = SecurityAlert.create;
const originalUserFind = User.find;
const originalPushFind = PushSubscription.find;

after(() => {
  AuditEvent.countDocuments = originalCountDocuments;
  AuditEvent.create = originalAuditCreate;
  SecurityAlert.create = originalAlertCreate;
  User.find = originalUserFind;
  PushSubscription.find = originalPushFind;
});

test('repeated login failures alert the affected account and admins once per window', async () => {
  const userId = '111111111111111111111111';
  const adminId = '222222222222222222222222';
  const created = new Map();
  let countedFilter;

  AuditEvent.countDocuments = async (filter) => {
    countedFilter = filter;
    return 5;
  };
  SecurityAlert.create = async ([alert]) => {
    if (created.has(alert.dedupeKey)) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    created.set(alert.dedupeKey, alert);
    return [alert];
  };
  User.find = (filter) => {
    assert.deepEqual(filter, { role: 'admin', status: 'active' });
    const query = { select: () => query, lean: async () => [{ _id: adminId }] };
    return query;
  };
  PushSubscription.find = () => {
    const query = { select: () => query, lean: async () => [] };
    return query;
  };

  const input = {
    sourceKey: 'ip-hash',
    targetUserId: userId,
    requestId: 'request-1',
  };
  assert.equal(await raiseLoginFailureAlerts(input), 2);
  assert.equal(await raiseLoginFailureAlerts(input), 0);
  assert.equal(countedFilter.eventType, 'auth.login.failed');
  assert.equal(countedFilter.targetUserId, userId);
  assert.equal(created.size, 2);
  assert.deepEqual([...created.values()].map((alert) => String(alert.userId)).sort(), [adminId, userId].sort());
});

test('repeated denied records and revoked session reuse generate scoped alerts', async () => {
  const userId = '333333333333333333333333';
  const adminId = '444444444444444444444444';
  const created = new Map();
  const auditEvents = [];
  let attempts = 2;
  AuditEvent.countDocuments = async (filter) => {
    assert.equal(filter.eventType, 'access.denied');
    assert.equal(String(filter.actorUserId), userId);
    return attempts;
  };
  AuditEvent.create = async (event) => {
    auditEvents.push(event);
    return event;
  };
  SecurityAlert.create = async ([alert]) => {
    if (created.has(alert.dedupeKey)) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    created.set(alert.dedupeKey, alert);
    return [alert];
  };
  User.find = () => {
    const query = { select: () => query, lean: async () => [{ _id: adminId }] };
    return query;
  };
  PushSubscription.find = () => {
    const query = { select: () => query, lean: async () => [] };
    return query;
  };

  const deniedAttempt = { actorUserId: userId, sourceKey: 'source-hash', requestId: 'denied-1' };
  assert.equal(await raiseUnavailableRecordAlerts(deniedAttempt), 0);
  attempts = 3;
  assert.equal(await raiseUnavailableRecordAlerts(deniedAttempt), 2);

  await raiseRevokedSessionReuseAlert({
    userId,
    tokenId: 'revoked-session-id',
    sourceKey: 'source-hash',
    requestId: 'reuse-1',
  });
  assert.equal(auditEvents[0].eventType, 'auth.session.reuse_detected');
  assert.equal(auditEvents[0].sourceKey, 'source-hash');
  assert.deepEqual(
    [...created.values()].filter((alert) => alert.alertType === 'revoked_session_reuse').map((alert) => String(alert.userId)).sort(),
    [adminId, userId].sort(),
  );
});
