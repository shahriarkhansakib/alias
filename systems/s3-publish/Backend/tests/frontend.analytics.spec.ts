import { renderMetricCard } from '../src/ui/components/MetricCard';
import { renderAnalyticsFilters } from '../src/ui/components/AnalyticsFilters';
import { renderPerformanceChart } from '../src/ui/components/PerformanceChart';
import { renderReactionBreakdown } from '../src/ui/components/ReactionBreakdown';
import { renderPostPerformanceTable } from '../src/ui/components/PostPerformanceTable';
import { renderPostDetailsModal } from '../src/ui/components/PostDetailsModal';

describe('Frontend Dashboard UI Component Tests', () => {
  describe('MetricCard Component', () => {
    test('renders label and formatted number value', () => {
      const html = renderMetricCard({ label: 'Impressions', value: 1500, icon: '👁️' });
      expect(html).toContain('Impressions');
      expect(html).toContain('1,500');
      expect(html).toContain('👁️');
    });

    test('renders percentage format correctly', () => {
      const html = renderMetricCard({ label: 'Engagement Rate', value: 8.182, format: 'percentage' });
      expect(html).toContain('Engagement Rate');
      expect(html).toContain('8.18%');
    });

    test('handles zero/null value gracefully', () => {
      const html = renderMetricCard({ label: 'Views', value: null });
      expect(html).toContain('Views');
      expect(html).toContain('0');
    });
  });

  describe('AnalyticsFilters Component', () => {
    test('renders selected platform filter and control buttons', () => {
      const html = renderAnalyticsFilters({ platform: 'facebook', fromDate: '2026-09-01', toDate: '2026-09-24' });
      expect(html).toContain('value="facebook" selected');
      expect(html).toContain('value="2026-09-01"');
      expect(html).toContain('value="2026-09-24"');
      expect(html).toContain('btn-apply-filters');
      expect(html).toContain('btn-refresh-dashboard');
    });
  });

  describe('PerformanceChart Component', () => {
    test('renders timeline SVG chart points and metric toggles', () => {
      const points = [
        { date: '2026-09-23', reach: 100, impressions: 150, likes: 10, comments: 2, shares: 1 },
        { date: '2026-09-24', reach: 200, impressions: 300, likes: 25, comments: 5, shares: 3 },
      ];
      const html = renderPerformanceChart(points, 'reach');

      expect(html).toContain('Performance Over Time');
      expect(html).toContain('<svg');
      expect(html).toContain('data-metric="reach"');
      expect(html).toContain('data-metric="impressions"');
      expect(html).toContain('2026-09-23: 100 reach');
    });

    test('renders empty state when timeline array is empty', () => {
      const html = renderPerformanceChart([], 'reach');
      expect(html).toContain('No timeline data available');
    });
  });

  describe('ReactionBreakdown Component', () => {
    test('renders unsupported notice and N/A when reactionBreakdown is null', () => {
      const html = renderReactionBreakdown(null, 45);
      expect(html).toContain('Facebook Reaction Breakdown');
      expect(html).toContain('Total Likes: 45');
      expect(html).toContain('Individual reaction type breakdown is not provided');
      expect(html).toContain('N/A');
    });

    test('renders exact reaction values when reactionBreakdown object exists', () => {
      const breakdown = { like: 30, love: 10, haha: 3, wow: 1, sad: 0, angry: 1 };
      const html = renderReactionBreakdown(breakdown, 45);

      expect(html).toContain('Like');
      expect(html).toContain('>30</div>');
      expect(html).toContain('Love');
      expect(html).toContain('>10</div>');
      expect(html).not.toContain('Individual reaction type breakdown is not provided');
    });
  });

  describe('PostPerformanceTable Component', () => {
    test('renders post rows with metrics and engagement rate', () => {
      const posts = [
        {
          internalPostId: 'p_1',
          caption: 'Test Social Post Caption',
          platforms: [{ platform: 'facebook', status: 'published' }],
          status: 'published',
        },
      ];
      const postAnalyticsMap = {
        p_1: {
          postId: 'p_1',
          metrics: { reach: 1200, impressions: 1500, likes: 80, comments: 12, shares: 9, engagementRate: 8.18 },
        },
      };

      const html = renderPostPerformanceTable(posts, postAnalyticsMap);

      expect(html).toContain('Test Social Post Caption');
      expect(html).toContain('1,200');
      expect(html).toContain('1,500');
      expect(html).toContain('80');
      expect(html).toContain('8.18%');
    });

    test('renders empty state when posts array is empty', () => {
      const html = renderPostPerformanceTable([], {});
      expect(html).toContain('No published social posts found');
    });
  });

  describe('PostDetailsModal Component', () => {
    test('renders post detail modal with caption, metrics, timeline, and reaction breakdown', () => {
      const postData = {
        internalPostId: 'p_99',
        caption: 'Detailed Analytics Modal Test Post',
        platforms: [{ platform: 'facebook', status: 'published' }],
        createdAt: '2026-09-24T12:00:00.000Z',
      };
      const analyticsData = {
        postId: 'p_99',
        platform: 'facebook',
        metrics: { reach: 500, impressions: 600, likes: 40, comments: 5, shares: 2, clicks: 10, views: 0, engagementRate: 11.4 },
        reactionBreakdown: null,
        timeline: [{ date: '2026-09-24', reach: 500, impressions: 600, likes: 40, comments: 5, shares: 2, clicks: 10, views: 0, engagementRate: 11.4 }],
      };

      const html = renderPostDetailsModal(postData, analyticsData);

      expect(html).toContain('Detailed Analytics Modal Test Post');
      expect(html).toContain('id="post-details-modal"');
      expect(html).toContain('500');
      expect(html).toContain('11.40%');
      expect(html).toContain('Facebook Reaction Breakdown');
    });
  });
});
