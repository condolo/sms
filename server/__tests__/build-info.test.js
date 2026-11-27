'use strict';

describe('build info', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.resetModules();
  });

  test('uses the platform commit and deployment timestamp when provided', () => {
    process.env.RENDER_GIT_COMMIT = 'abc123';
    process.env.DEPLOYED_AT = '2026-11-27T06:00:00.000Z';
    const info = require('../utils/build-info');
    expect(info).toMatchObject({
      version: expect.any(String),
      commit: 'abc123',
      deployedAt: '2026-11-27T06:00:00.000Z',
      node: process.version,
    });
  });

  test('falls back to development outside a deployed environment', () => {
    delete process.env.RENDER_GIT_COMMIT;
    delete process.env.GIT_COMMIT;
    delete process.env.COMMIT_SHA;
    delete process.env.DEPLOYED_AT;
    const info = require('../utils/build-info');
    expect(info.commit).toBe('development');
    expect(info.deployedAt).toBeNull();
  });
});
