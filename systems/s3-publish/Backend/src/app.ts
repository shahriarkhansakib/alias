import express, { Express } from 'express';
import cors from 'cors';
import path from 'path';
import cookieParser from 'cookie-parser';
import { createSocialRouter } from './routes/social.routes';
import { createAuthRouter } from './auth/auth.routes';
import { PublisherService } from './social/services/publisher.service';
import { PostRepositoryService } from './social/services/post-repository.service';
import { AnalyticsService } from './social/services/analytics.service';
import { SocialConnectService } from './social/services/social-connect.service';
import { CommentService } from './social/services/comment.service';
import { TrackingService } from './tracking/services/tracking.service';
import { TrackingController } from './tracking/controllers/tracking.controller';
import { TrackingRateLimiter } from './tracking/utils/tracking-rate-limiter';
import { createTrackingRouter } from './tracking/routes/tracking.routes';
import { generateToken } from './auth/auth.service';
import { getAllowedOrigins } from './config/env';

export function createApp(
  customPublisherService?: PublisherService,
  customPostRepository?: PostRepositoryService,
  customAnalyticsService?: AnalyticsService,
  testAuthUser?: { userId: string; role: string },
  customSocialConnectService?: SocialConnectService,
  customCommentService?: CommentService,
  customTrackingService?: TrackingService,
  customTrackingRateLimiter?: TrackingRateLimiter
): Express {
  const app = express();

  const allowedOrigins = getAllowedOrigins();
  const corsOptions: cors.CorsOptions = {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  };

  // Tracking setup
  const trackingService = customTrackingService || new TrackingService();
  const trackingController = new TrackingController(trackingService, customTrackingRateLimiter);

  // Phase 2: Route-specific CORS preflight for public website event ingestion
  app.options('/api/tracking/events', trackingController.handleEventPreflight);

  // Apply dashboard CORS to internal API routes while allowing route-specific CORS for public tracking
  app.use((req, res, next) => {
    if (req.path === '/api/tracking/events' || req.path === '/t.js' || req.path.startsWith('/r/')) {
      return next();
    }
    return cors(corsOptions)(req, res, next);
  });
  app.options('*', cors(corsOptions));

  // Bypass global express.json() for /api/tracking/events so source/global rate limiting and origin checks run first
  app.use((req, res, next) => {
    if (req.path === '/api/tracking/events') {
      return next();
    }
    return express.json()(req, res, next);
  });
  app.use(cookieParser());

  // Explicit test-only auth injection (cannot be enabled by NODE_ENV alone)
  if (testAuthUser) {
    const testToken = generateToken(testAuthUser.userId, testAuthUser.role);
    app.use((req, _res, next) => {
      if (!req.cookies) req.cookies = {};
      if (!req.cookies.auth_token) {
        req.cookies.auth_token = testToken;
      }
      next();
    });
  }

  // Public tracked-link redirect endpoint (unauthenticated, safe server-side lookup)
  app.get('/r/:slug', trackingController.handlePublicRedirect);

  // Phase 2: Public First-Party Tracking Script (unauthenticated, cached)
  app.get('/t.js', trackingController.handleServeScript);

  // Phase 2: Public Website Event Ingestion (unauthenticated, origin-checked, size-limited, layered rate limits)
  app.options('/api/tracking/events', trackingController.handleEventPreflight);
  app.post(
    '/api/tracking/events',
    trackingController.handlePreBodyIngest,
    express.json({ limit: '10kb' }),
    trackingController.handlePublicEventIngest
  );

  // Serve static UI for testing & dashboard
  const publicPath = path.join(__dirname, '..', '..', 'Frontend', 'public');
  app.use(express.static(publicPath));

  // Mount Auth endpoints
  app.use('/api/auth', createAuthRouter());

  // Mount Tracking API endpoints
  app.use('/api/social/tracking', createTrackingRouter(trackingService));

  // Mount API endpoints
  app.use(
    '/api/social',
    createSocialRouter(
      customPublisherService,
      customPostRepository,
      customAnalyticsService,
      customSocialConnectService,
      customCommentService
    )
  );

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'Social Publishing Agent API' });
  });

  return app;
}
