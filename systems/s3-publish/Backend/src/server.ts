import { createApp } from './app';
import { config, validateConfig } from './config/env';
import { PostRepositoryService } from './social/services/post-repository.service';
import { ZernioPublisher } from './social/providers/zernio/zernio.publisher';
import { ZernioClient } from './social/providers/zernio/zernio.client';
import { PlatformRouter } from './social/router/platform.router';
import { ScheduledPostService } from './social/services/scheduled-post.service';

try {
  validateConfig();
} catch (err: any) {
  console.warn('[Warning]', err.message);
}

const app = createApp();

const postRepository = new PostRepositoryService();
const platformRouter = new PlatformRouter();
const zernioClient = new ZernioClient();
const zernioPublisher = new ZernioPublisher(zernioClient, platformRouter);
const scheduledPostService = new ScheduledPostService(postRepository, zernioPublisher);

app.listen(config.port, () => {
  console.log(`🚀 Social Publishing Agent server listening on http://localhost:${config.port}`);
  console.log(`📡 Base Zernio URL: ${config.zernioBaseUrl}`);
  const key = config.zernioApiKey;
  console.log(`🔑 ZERNIO_API_KEY exists: ${!!key}, length: ${key ? key.length : 0}, startsWithSk: ${key ? key.startsWith('sk_') : false}`);
  scheduledPostService.start(30000);
});
