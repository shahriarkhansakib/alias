import dotenv from 'dotenv';
import path from 'path';

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { getDbPool } from './index';
import { ZernioClient } from '../social/providers/zernio/zernio.client';
import { v4 as uuidv4 } from 'uuid';

const FAKE_POST_IDS = [
  'zernio_idempotent_104',
  'zernio_sched_103',
  'zernio_multi_102',
  'zernio_fb_101',
  'zernio_api_test_2',
  'zernio_api_test_1',
  'zernio_idempotency_post_777',
];

async function main() {
  const pool = getDbPool();
  if (!pool) {
    console.error('Cannot connect to database. Pool is null.');
    process.exit(1);
  }

  const client = await pool.connect();
  const zernio = new ZernioClient();

  try {
    console.log('=== STEP 1: INSPECTING ZERNIO API ===');
    const analyticsRes = await zernio.getAnalytics({ limit: 100 });
    const zernioPosts: any[] = analyticsRes?.posts || [];
    console.log(`Fetched ${zernioPosts.length} posts from Zernio analytics.`);
    
    for (let i = 0; i < zernioPosts.length; i++) {
      const p = zernioPosts[i];
      console.log(`\n--- Post #${i + 1} ---`);
      console.log('ID / _id:', p._id || p.id);
      console.log('Platform:', p.platform);
      console.log('PlatformPostId:', p.platformPostId);
      console.log('PlatformPostUrl:', p.platformPostUrl);
      console.log('Content / Caption:', p.caption || p.content || p.message || p.text);
      console.log('CreatedAt:', p.createdAt || p.date || p.publishedAt);
      console.log('Analytics Metrics:', JSON.stringify(p.analytics || {}));
    }

    // Try /posts endpoint as well
    try {
      const postsApiRes = await (zernio as any).client.get('/posts', {
        headers: { Authorization: `Bearer ${zernio.getApiKey()}` },
        params: { limit: 100 }
      });
      console.log('\n--- Zernio /posts API Response ---');
      const apiPosts = postsApiRes.data?.posts || postsApiRes.data || [];
      console.log(`Found ${Array.isArray(apiPosts) ? apiPosts.length : 0} posts from /posts`);
      if (Array.isArray(apiPosts) && apiPosts.length > 0) {
        console.log('Sample from /posts:', JSON.stringify(apiPosts[0], null, 2));
      }
    } catch (e: any) {
      console.log('GET /posts not available:', e.response?.status || e.message);
    }

    console.log('\n=== STEP 2: REMOVING 7 FAKE UNIT-TEST ROWS FROM DB ===');
    await client.query('BEGIN');

    // Find fake posts in posts or post_platforms
    const fakeRows = await client.query(
      `SELECT DISTINCT p.id, p.caption, pp.zernio_post_id
       FROM posts p
       LEFT JOIN post_platforms pp ON pp.post_id = p.id
       WHERE pp.zernio_post_id = ANY($1::text[])
          OR p.id = ANY($1::text[])
          OR p.idempotency_key ILIKE 'custom_idempotency%'
          OR p.idempotency_key ILIKE 'req_%'`,
      [FAKE_POST_IDS]
    );

    console.log(`Found ${fakeRows.rows.length} fake post records in local DB to remove:`);
    for (const r of fakeRows.rows) {
      console.log(`- Post ID: ${r.id}, Zernio ID: ${r.zernio_post_id}, Caption: "${r.caption}"`);
    }

    if (fakeRows.rows.length > 0) {
      const postIdsToDelete = fakeRows.rows.map((r) => r.id);
      // Cascades to post_platforms, analytics_snapshots, analytics_timeline
      await client.query(
        `DELETE FROM posts WHERE id = ANY($1::text[])`,
        [postIdsToDelete]
      );
      console.log(`Deleted ${postIdsToDelete.length} posts and their platform/analytics cascade rows.`);
    }

    console.log('\n=== STEP 3: BACKFILLING REAL POSTS FROM ZERNIO ===');
    let insertedCount = 0;
    for (const zp of zernioPosts) {
      const zernioId = String(zp._id || zp.id || '');
      if (!zernioId) continue;

      // Check if this zernio post already exists
      const existing = await client.query(
        `SELECT pp.post_id
         FROM post_platforms pp
         WHERE pp.zernio_post_id = $1
            OR (pp.platform_post_id IS NOT NULL AND pp.platform_post_id = $2)
         LIMIT 1`,
        [zernioId, zp.platformPostId || null]
      );

      if (existing.rows.length > 0) {
        console.log(`Post with Zernio ID ${zernioId} already exists as post ${existing.rows[0].post_id}. Skipping.`);
        continue;
      }

      const internalPostId = `post_${uuidv4()}`;
      const caption = zp.caption || zp.content || zp.message || zp.text || `Social Post (${zp.platform || 'facebook'})`;
      const mediaUrl = zp.imageUrl || zp.mediaUrl || zp.media?.[0]?.url || null;
      const createdAt = zp.createdAt || zp.publishedAt || zp.date || new Date().toISOString();
      const status = 'published';

      await client.query(
        `INSERT INTO posts (id, idempotency_key, caption, media_url, status, created_at, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          internalPostId,
          `zernio_sync_${zernioId}`,
          caption,
          mediaUrl,
          status,
          new Date(createdAt),
          new Date(createdAt),
        ]
      );

      const postPlatformId = `pf_${uuidv4()}`;
      const platform = zp.platform || zp.platforms?.[0]?.platform || 'facebook';
      const platformPostId = zp.platformPostId || zp.platforms?.[0]?.platformPostId || null;
      const platformPostUrl = zp.platformPostUrl || zp.platforms?.[0]?.platformPostUrl || null;

      await client.query(
        `INSERT INTO post_platforms (id, post_id, platform, account_id, zernio_post_id, platform_post_id, platform_post_url, status, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          postPlatformId,
          internalPostId,
          platform,
          null,
          zernioId,
          platformPostId,
          platformPostUrl,
          status,
          new Date(createdAt),
        ]
      );

      // If snapshot analytics exist
      const m = zp.analytics;
      if (m) {
        const snapId = `snap_${uuidv4()}`;
        await client.query(
          `INSERT INTO analytics_snapshots
           (id, post_platform_id, impressions, reach, likes, comments, shares, saves, clicks, views, engagement_rate, fetched_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            snapId,
            postPlatformId,
            m.impressions || 0,
            m.reach || 0,
            m.likes || 0,
            m.comments || 0,
            m.shares || 0,
            m.saves || 0,
            m.clicks || 0,
            m.views || 0,
            m.engagementRate || 0,
            new Date(),
          ]
        );
      }

      console.log(`Inserted real post: internalPostId=${internalPostId}, zernioId=${zernioId}, caption="${caption.slice(0, 40)}..."`);
      insertedCount++;
    }

    await client.query('COMMIT');
    console.log(`\nSuccessfully backfilled ${insertedCount} real posts into local DB!`);

    // Verify current DB state
    const currentPosts = await client.query(
      `SELECT p.id, p.caption, p.status, pp.platform, pp.zernio_post_id, pp.platform_post_id
       FROM posts p
       JOIN post_platforms pp ON pp.post_id = p.id
       ORDER BY p.created_at DESC`
    );
    console.log('\n=== CURRENT POSTS IN DB ===');
    console.table(currentPosts.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during cleanup and sync:', err);
  } finally {
    client.release();
    process.exit(0);
  }
}

main();
