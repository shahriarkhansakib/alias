import { describe, expect, it } from 'vitest';
import { decideGatewayAccess, isGatewayPath } from './gateway-policy';

describe('gateway policy', () => {
  describe('happy paths', () => {
    it('lets an admin reach every system UI and API', () => {
      for (const path of [
        '/intake/admin',
        '/intake/admin/communication',
        '/studio',
        '/studio/dashboard/new',
        '/publish',
        '/publish/analytics',
        '/svc/creative/api/v1/health',
        '/svc/publishing/api/social/posts',
      ]) {
        expect(decideGatewayAccess(path, 'admin')).toEqual({ kind: 'allow' });
      }
    });

    it('lets a client use the System 1 chat, its APIs and its assets', () => {
      for (const path of [
        '/intake',
        '/intake/campaign/new',
        '/intake/campaign/abc123',
        '/intake/api/conversations/abc123/messages',
        '/intake/api/auth/session',
        '/intake/_next/static/chunk.js',
      ]) {
        expect(decideGatewayAccess(path, 'client')).toEqual({ kind: 'allow' });
      }
    });

    it('does not gate platform pages', () => {
      for (const path of ['/', '/login', '/register', '/dashboard', '/admin', '/api/v1/health']) {
        expect(decideGatewayAccess(path, 'anonymous')).toEqual({ kind: 'not-gated' });
      }
    });
  });

  describe('edge cases', () => {
    it('matches whole path segments only', () => {
      expect(isGatewayPath('/intakeform')).toBe(false);
      expect(isGatewayPath('/studios')).toBe(false);
      expect(isGatewayPath('/publisher')).toBe(false);
      expect(isGatewayPath('/svcx/creative')).toBe(false);
      expect(decideGatewayAccess('/intakeform', 'anonymous')).toEqual({ kind: 'not-gated' });
    });

    it('treats the bare prefixes as gated', () => {
      expect(isGatewayPath('/intake')).toBe(true);
      expect(isGatewayPath('/studio')).toBe(true);
      expect(isGatewayPath('/publish')).toBe(true);
    });

    it('keeps a client out of System 1 operator pages even with nested paths', () => {
      expect(decideGatewayAccess('/intake/admin/campaigns/42', 'client')).toEqual({
        kind: 'redirect',
        to: '/dashboard',
      });
    });
  });

  describe('error cases', () => {
    it('sends signed-out visitors of system pages to login', () => {
      for (const path of ['/intake/campaign/new', '/studio', '/publish']) {
        expect(decideGatewayAccess(path, 'anonymous')).toEqual({ kind: 'redirect', to: '/login' });
      }
    });

    it('rejects signed-out API calls with forbidden instead of a redirect', () => {
      expect(decideGatewayAccess('/svc/creative/api/v1/briefs', 'anonymous')).toEqual({
        kind: 'forbidden',
      });
      expect(decideGatewayAccess('/intake/api/campaigns', 'anonymous')).toEqual({
        kind: 'forbidden',
      });
    });

    it('redirects a client away from admin-only system pages', () => {
      for (const path of ['/studio', '/publish', '/intake/admin']) {
        expect(decideGatewayAccess(path, 'client')).toEqual({ kind: 'redirect', to: '/dashboard' });
      }
    });

    it('forbids a client from admin-only APIs', () => {
      for (const path of [
        '/svc/creative/api/v1/briefs',
        '/svc/publishing/api/social/publish',
        '/intake/api/admin/campaigns',
      ]) {
        expect(decideGatewayAccess(path, 'client')).toEqual({ kind: 'forbidden' });
      }
    });
  });
});
