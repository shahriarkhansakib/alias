import request from 'supertest';
import { createApp } from '../src/app';
import { getAllowedOrigins } from '../src/config/env';

describe('CORS Configuration Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Allowed Local Origin (http://localhost:5173)', () => {
    it('handles OPTIONS preflight for /api/auth/owner-setup with exact origin and credentials', async () => {
      const app = createApp();

      const res = await request(app)
        .options('/api/auth/owner-setup')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-methods']).toMatch(/POST/);
      expect(res.headers['access-control-allow-headers']).toMatch(/Content-Type/i);
    });

    it('sets CORS headers on actual POST /api/auth/owner-setup for allowed origin', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/owner-setup')
        .set('Origin', 'http://localhost:5173')
        .set('Content-Type', 'application/json')
        .send({ setupToken: 'invalid', email: 'test@example.com', password: 'password123' });

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      // Origin is never wildcard '*' when credentials mode is true
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    });

    it('sets CORS headers on POST /api/auth/login for allowed origin', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:5173')
        .set('Content-Type', 'application/json')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('handles OPTIONS preflight for /api/social/posts', async () => {
      const app = createApp();

      const res = await request(app)
        .options('/api/social/posts')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('Disallowed Origin', () => {
    it('omits Access-Control-Allow-Origin on OPTIONS preflight for untrusted origin', async () => {
      const app = createApp();

      const res = await request(app)
        .options('/api/auth/owner-setup')
        .set('Origin', 'http://untrusted-attacker.com')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('omits Access-Control-Allow-Origin on actual POST for untrusted origin', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/owner-setup')
        .set('Origin', 'http://untrusted-attacker.com')
        .set('Content-Type', 'application/json')
        .send({ setupToken: 'invalid', email: 'test@example.com', password: 'password123' });

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('Production Origin Restrictions', () => {
    it('does not allow localhost:5173 in production by default', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.CLIENT_URL;

      const origins = getAllowedOrigins();
      expect(origins).not.toContain('http://localhost:5173');
      expect(origins).toEqual([]);
    });

    it('allows only configured CLIENT_URL in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.CLIENT_URL = 'https://dashboard.example.com';

      const origins = getAllowedOrigins();
      expect(origins).toEqual(['https://dashboard.example.com']);
      expect(origins).not.toContain('http://localhost:5173');
    });

    it('includes localhost:5173 in development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.CLIENT_URL;

      const origins = getAllowedOrigins();
      expect(origins).toContain('http://localhost:5173');
    });
  });
});
