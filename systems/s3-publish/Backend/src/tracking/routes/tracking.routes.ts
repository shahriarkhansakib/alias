import { Router } from 'express';
import { TrackingController } from '../controllers/tracking.controller';
import { TrackingService } from '../services/tracking.service';
import { requireAuth } from '../../auth/auth.middleware';

export function createTrackingRouter(trackingService?: TrackingService): Router {
  const router = Router();
  const controller = new TrackingController(trackingService);

  // All tracking management and reporting endpoints require authentication
  router.use(requireAuth);

  // Products
  router.post('/products', controller.createProduct);
  router.get('/products', controller.getProducts);

  // Campaigns
  router.post('/campaigns', controller.createCampaign);
  router.get('/campaigns', controller.getCampaigns);

  // Tracked Links
  router.post('/links', controller.createTrackedLink);
  router.get('/links', controller.getTrackedLinks);

  // Hierarchical Stats
  router.get('/stats', controller.getStats);

  // Phase 2: Connected Websites & Activity Stats
  router.post('/websites', controller.registerWebsite);
  router.get('/websites', controller.getWebsites);
  router.get('/website-stats', controller.getWebsiteStats);

  return router;
}
