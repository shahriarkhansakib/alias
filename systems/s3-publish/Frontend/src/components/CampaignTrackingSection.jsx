import React, { useState, useEffect } from 'react';
import { 
  Link2, 
  Plus, 
  Copy, 
  Check, 
  ExternalLink, 
  AlertTriangle, 
  Info, 
  RefreshCw, 
  Layers, 
  Package, 
  MousePointerClick,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { apiService } from '../services/api';

export default function CampaignTrackingSection() {
  const [stats, setStats] = useState(null);
  const [connectedWebsites, setConnectedWebsites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Forms state
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'product' | 'campaign' | 'link'
  const [copyStatus, setCopyStatus] = useState({});

  // Product form
  const [productName, setProductName] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [productSubmitting, setProductSubmitting] = useState(false);
  const [productError, setProductError] = useState('');

  // Campaign form
  const [selectedProductId, setSelectedProductId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [campaignSubmitting, setCampaignSubmitting] = useState(false);
  const [campaignError, setCampaignError] = useState('');

  // Link form
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [recentlyGeneratedLink, setRecentlyGeneratedLink] = useState(null);

  // Expanded items state
  const [expandedProducts, setExpandedProducts] = useState({});

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [res, websitesRes] = await Promise.allSettled([
        apiService.getTrackingStats(),
        apiService.getTrackingWebsites(),
      ]);

      if (res.status === 'fulfilled' && res.value && res.value.success) {
        setStats(res.value);
        // Expand all products by default if few
        const initialExpanded = {};
        (res.value.products || []).forEach((p) => {
          initialExpanded[p.id] = true;
        });
        setExpandedProducts(initialExpanded);
      }

      if (websitesRes.status === 'fulfilled' && websitesRes.value?.websites) {
        setConnectedWebsites(websitesRes.value.websites || []);
      }
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to load tracking data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCopy = (url, linkId) => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopyStatus((prev) => ({ ...prev, [linkId]: true }));
      setTimeout(() => {
        setCopyStatus((prev) => ({ ...prev, [linkId]: false }));
      }, 2000);
    });
  };

  const toggleProductExpand = (id) => {
    setExpandedProducts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // 1. Submit Product
  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (!productName.trim() || !productUrl.trim()) {
      setProductError('Product name and destination URL are required.');
      return;
    }
    setProductSubmitting(true);
    setProductError('');

    try {
      await apiService.createTrackingProduct({
        name: productName.trim(),
        destinationUrl: productUrl.trim(),
      });
      setProductName('');
      setProductUrl('');
      setActiveTab('overview');
      await loadData(true);
    } catch (err) {
      setProductError(err?.response?.data?.error || err.message || 'Failed to create product.');
    } finally {
      setProductSubmitting(false);
    }
  };

  // 2. Submit Campaign
  const handleCreateCampaign = async (e) => {
    e.preventDefault();
    if (!selectedProductId || !campaignName.trim()) {
      setCampaignError('Please select a product and enter a campaign name.');
      return;
    }
    setCampaignSubmitting(true);
    setCampaignError('');

    try {
      await apiService.createTrackingCampaign({
        productId: selectedProductId,
        name: campaignName.trim(),
      });
      setCampaignName('');
      setActiveTab('overview');
      await loadData(true);
    } catch (err) {
      setCampaignError(err?.response?.data?.error || err.message || 'Failed to create campaign.');
    } finally {
      setCampaignSubmitting(false);
    }
  };

  // 3. Submit Tracked Link
  const handleCreateLink = async (e) => {
    e.preventDefault();
    if (!selectedCampaignId) {
      setLinkError('Please select a campaign to generate a tracked link.');
      return;
    }
    setLinkSubmitting(true);
    setLinkError('');
    setRecentlyGeneratedLink(null);

    try {
      const res = await apiService.createTrackingLink({
        campaignId: selectedCampaignId,
        label: linkLabel.trim() || undefined,
      });
      if (res && res.link) {
        setRecentlyGeneratedLink(res.link);
      }
      setLinkLabel('');
      await loadData(true);
    } catch (err) {
      setLinkError(err?.response?.data?.error || err.message || 'Failed to generate tracked link.');
    } finally {
      setLinkSubmitting(false);
    }
  };

  const products = stats?.products || [];
  const allCampaigns = products.flatMap((p) =>
    (p.campaigns || []).map((c) => ({ ...c, productName: p.name, productId: p.id }))
  );
  const totalLinks = products.reduce(
    (acc, p) => acc + (p.campaigns || []).reduce((cAcc, c) => cAcc + (c.links || []).length, 0),
    0
  );

  return (
    <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Link2 className="w-4 h-4 text-emerald-400" />
              Campaign Performance & Link Tracking
            </h3>
            <span className="text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              First-Party Direct Clicks
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Generate unique tracked links to compare visits by product, campaign, and post.
            Metric label: <span className="font-semibold text-slate-300">Tracked clicks (not unique visitors)</span>.
            Measured separately from Facebook/Zernio platform-reported post clicks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={refreshing || loading}
            aria-label="Refresh tracking data"
            className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Hosting Configuration Notice */}
      {stats?.config && (
        <div className={`p-4 rounded-xl text-xs flex items-start gap-3 border ${
          stats.config.isLocalhost 
            ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' 
            : stats.config.warning
            ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
            : 'bg-slate-900/40 border-slate-800 text-slate-400'
        }`}>
          {stats.config.isLocalhost ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          ) : (
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1">
            <p className="font-semibold text-slate-200">
              Hosting Requirement & Redirect Domain:
            </p>
            <p className="leading-relaxed">
              Public tracking links require the app to be hosted at a public HTTPS URL. A localhost link is for local testing only. External Facebook users cannot reach localhost URLs.
            </p>
            <p className="text-[11px] font-mono text-slate-400 pt-0.5">
              Active Base URL: <span className="text-emerald-400 font-bold">{stats.config.baseUrl || 'Not configured'}</span>
              {stats.config.isLocalhost && ' (Local test mode)'}
            </p>
          </div>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Tracked clicks</span>
            <MousePointerClick className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-xl font-bold text-slate-100 mt-2">
            {stats?.totalEligibleClicks || 0}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">(not unique visitors)</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Products</span>
            <Package className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-xl font-bold text-slate-100 mt-2">{products.length}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Destinations defined</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Campaigns</span>
            <Layers className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-xl font-bold text-slate-100 mt-2">{allCampaigns.length}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Active marketing pushes</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Tracked Links</span>
            <Link2 className="w-4 h-4 text-sky-400" />
          </div>
          <p className="text-xl font-bold text-slate-100 mt-2">{totalLinks}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Unique URLs created</p>
        </div>
      </div>

      {/* Creation Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'overview'
              ? 'bg-slate-800 text-slate-100 border border-slate-700'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Overview & Clicks
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('product')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            activeTab === 'product'
              ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          New Product
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('campaign')}
          disabled={products.length === 0}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            activeTab === 'campaign'
              ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          New Campaign
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('link')}
          disabled={allCampaigns.length === 0}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            activeTab === 'link'
              ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          Generate Tracked Link
        </button>
      </div>

      {/* Tab: New Product */}
      {activeTab === 'product' && (
        <form onSubmit={handleCreateProduct} className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Create New Product</h4>
          {productError && (
            <p className="text-xs text-red-400 bg-red-950/20 p-2.5 rounded-lg border border-red-900/30">{productError}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Product Name</label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g. Wireless Earbuds Pro"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Destination URL (http / https only)</label>
              <input
                type="url"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="e.g. https://yourdomain.com/products/item"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
                required
              />
            </div>
          </div>
          {connectedWebsites.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[11px] text-slate-400 font-medium">Use connected website as default destination:</span>
              <div className="flex flex-wrap gap-2">
                {connectedWebsites.map((site) => (
                  <button
                    key={site.id}
                    type="button"
                    onClick={() => setProductUrl(site.origin)}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 hover:border-sky-500/40 transition-colors flex items-center gap-1.5"
                    title={`Set destination to ${site.origin}`}
                  >
                    <ExternalLink className="w-3 h-3 text-sky-400" />
                    <span>{site.name}</span>
                    <span className="text-slate-500 font-mono text-[10px]">({site.origin})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={productSubmitting}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors disabled:opacity-50"
            >
              {productSubmitting ? 'Saving...' : 'Save Product'}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Tab: New Campaign */}
      {activeTab === 'campaign' && (
        <form onSubmit={handleCreateCampaign} className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Create Campaign for Product</h4>
          {campaignError && (
            <p className="text-xs text-red-400 bg-red-950/20 p-2.5 rounded-lg border border-red-900/30">{campaignError}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Select Product</label>
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-purple-500"
                required
              >
                <option value="">-- Choose a Product --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Campaign Name</label>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="e.g. Black Friday 2026 Promo"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-purple-500"
                required
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={campaignSubmitting}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs transition-colors disabled:opacity-50"
            >
              {campaignSubmitting ? 'Creating...' : 'Create Campaign'}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Tab: Generate Tracked Link */}
      {activeTab === 'link' && (
        <form onSubmit={handleCreateLink} className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Generate Unique Tracked Link</h4>
          {linkError && (
            <p className="text-xs text-red-400 bg-red-950/20 p-2.5 rounded-lg border border-red-900/30">{linkError}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Select Campaign</label>
              <select
                value={selectedCampaignId}
                onChange={(e) => setSelectedCampaignId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                required
              >
                <option value="">-- Choose a Campaign --</option>
                {allCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.productName} &rarr; {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Optional Link Label</label>
              <input
                type="text"
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder="e.g. Facebook post 1, Bio link, Promo comment"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={linkSubmitting}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors disabled:opacity-50"
            >
              {linkSubmitting ? 'Generating...' : 'Generate Tracked Link'}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Recently Generated Link Alert */}
      {recentlyGeneratedLink && (
        <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/40 text-xs text-emerald-200 space-y-2">
          <p className="font-semibold text-emerald-100 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            Tracked Link Ready!
          </p>
          <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800">
            <span className="font-mono text-emerald-300 break-all">{recentlyGeneratedLink.trackedUrl}</span>
            <button
              type="button"
              onClick={() => handleCopy(recentlyGeneratedLink.trackedUrl, recentlyGeneratedLink.id)}
              className="px-3 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-100 border border-emerald-500/40 shrink-0 font-medium flex items-center gap-1.5 transition-colors"
            >
              {copyStatus[recentlyGeneratedLink.id] ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-300" /> Copied!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy Link
                </>
              )}
            </button>
          </div>
          <p className="text-[11px] text-emerald-400/80">
            Manually paste this link into future posts or comments. Clicks will be tracked automatically.
          </p>
        </div>
      )}

      {/* Overview & Breakdown by Product, Campaign, and Link */}
      {products.length === 0 ? (
        <div className="text-center py-10 rounded-xl bg-slate-900/30 border border-slate-800 p-6 space-y-3">
          <Package className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="font-semibold text-slate-200 text-sm">No Tracked Products Created Yet</p>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Create your first product to define its destination URL. You can then organize campaigns and generate unique tracking links to monitor clicks directly.
          </p>
          <button
            type="button"
            onClick={() => setActiveTab('product')}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-all shadow-md inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Create Product
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Performance Breakdown by Product, Campaign & Link
          </h4>

          <div className="space-y-3">
            {products.map((prod) => {
              const isExpanded = !!expandedProducts[prod.id];
              return (
                <div
                  key={prod.id}
                  className="rounded-xl bg-slate-900/40 border border-slate-800/80 overflow-hidden"
                >
                  {/* Product Header */}
                  <div
                    onClick={() => toggleProductExpand(prod.id)}
                    className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-slate-800/30 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-200">{prod.name}</span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            ({prod.campaigns?.length || 0} campaigns)
                          </span>
                        </div>
                        <a
                          href={prod.destinationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[11px] text-slate-400 hover:text-blue-400 inline-flex items-center gap-1 mt-0.5"
                        >
                          {prod.destinationUrl} <ExternalLink className="w-3 h-3 opacity-60" />
                        </a>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-sm font-bold text-emerald-400 font-mono">
                        {prod.eligibleClicks}
                      </span>
                      <span className="text-[10px] text-slate-500 block">clicks</span>
                    </div>
                  </div>

                  {/* Campaigns under this Product */}
                  {isExpanded && (
                    <div className="p-3.5 pt-0 space-y-3 border-t border-slate-800/50">
                      {prod.campaigns?.length === 0 ? (
                        <p className="text-xs text-slate-500 italic py-2 pl-6">
                          No campaigns created yet for this product.
                        </p>
                      ) : (
                        prod.campaigns.map((camp) => (
                          <div
                            key={camp.id}
                            className="ml-4 pl-3 border-l-2 border-purple-500/30 space-y-2 pt-2"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-purple-300">
                                  {camp.name}
                                </span>
                                <span className="text-[10px] text-slate-500 font-mono">
                                  ({camp.links?.length || 0} links)
                                </span>
                              </div>
                              <span className="text-xs font-bold text-slate-300 font-mono">
                                {camp.eligibleClicks} clicks
                              </span>
                            </div>

                            {/* Links under this Campaign */}
                            {camp.links?.length === 0 ? (
                              <p className="text-[11px] text-slate-500 italic">
                                No tracked links generated yet.
                              </p>
                            ) : (
                              <div className="space-y-1.5 pt-1">
                                {camp.links.map((link) => (
                                  <div
                                    key={link.id}
                                    className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                                  >
                                    <div className="space-y-0.5">
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-slate-300">
                                          {link.label || 'Direct Link'}
                                        </span>
                                        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                                          {link.eligibleClicks} clicks
                                        </span>
                                      </div>
                                      <span className="font-mono text-[11px] text-slate-400 block break-all">
                                        {link.trackedUrl}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => handleCopy(link.trackedUrl, link.id)}
                                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/80 text-[11px] font-medium flex items-center gap-1 transition-colors"
                                      >
                                        {copyStatus[link.id] ? (
                                          <>
                                            <Check className="w-3 h-3 text-emerald-400" /> Copied!
                                          </>
                                        ) : (
                                          <>
                                            <Copy className="w-3 h-3" /> Copy URL
                                          </>
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
