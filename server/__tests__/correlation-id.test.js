const { resolveCorrelationId, correlationIdMiddleware } = require('../utils/correlation-id');

describe('resolveCorrelationId', () => {
  test('reuses a valid incoming x-request-id header', () => {
    const req = { headers: { 'x-request-id': 'abc-123_XYZ' } };
    expect(resolveCorrelationId(req)).toBe('abc-123_XYZ');
  });

  test('reuses a valid incoming x-correlation-id header when x-request-id is absent', () => {
    const req = { headers: { 'x-correlation-id': 'req_9f8e' } };
    expect(resolveCorrelationId(req)).toBe('req_9f8e');
  });

  test('generates a fresh UUID when no header is present', () => {
    const req = { headers: {} };
    const id = resolveCorrelationId(req);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('generates a fresh UUID for an oversized header value (log-injection/DoS defense)', () => {
    const req = { headers: { 'x-request-id': 'a'.repeat(500) } };
    const id = resolveCorrelationId(req);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('generates a fresh UUID for a header value with unsafe characters', () => {
    const req = { headers: { 'x-request-id': 'abc\ninjected: true' } };
    const id = resolveCorrelationId(req);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('generates a fresh UUID for an empty-string header', () => {
    const req = { headers: { 'x-request-id': '' } };
    const id = resolveCorrelationId(req);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('handles a missing headers object without throwing', () => {
    expect(() => resolveCorrelationId({})).not.toThrow();
    expect(() => resolveCorrelationId(undefined)).not.toThrow();
  });
});

describe('correlationIdMiddleware', () => {
  test('sets req.correlationId and calls next()', () => {
    const req = { headers: { 'x-request-id': 'trace-001' } };
    const next = jest.fn();

    correlationIdMiddleware(req, {}, next);

    expect(req.correlationId).toBe('trace-001');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
