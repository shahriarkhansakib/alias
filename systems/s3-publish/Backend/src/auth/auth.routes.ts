import { Router } from 'express';
import { AuthController } from './auth.controller';
import { requireAuth } from './auth.middleware';

export function createAuthRouter(): Router {
  const router = Router();
  const controller = new AuthController();

  router.post('/signup', controller.signup);
  router.post('/login', controller.login);
  router.post('/logout', controller.logout);
  router.get('/me', requireAuth, controller.me);
  router.post('/owner-setup', controller.ownerSetup);

  return router;
}
