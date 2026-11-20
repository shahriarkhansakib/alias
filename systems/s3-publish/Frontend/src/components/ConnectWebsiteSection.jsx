import React, { useState, useEffect } from 'react';
import { 
  Globe, 
  Code2, 
  Copy, 
  Check, 
  AlertTriangle, 
  Info, 
  RefreshCw, 
  Plus, 
  Eye, 
  MousePointerClick, 
  ExternalLink,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { apiService } from '../services/api';

export default function ConnectWebsiteSection() {
  const [stats, setStats] = useState(null);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Form state for registering new website
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [siteName, setSiteName] = useState('');
  const [siteOrigin, setSiteOrigin] = useState('');
  const [registering, setRegistering] = useState(false);
  const [formError, setFormError] = useState('');

  // Copy feedback state
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [copiedAttrMap, setCopiedAttrMap] = useState({});

  const loadData = async (isRefresh = false, targetWebsiteId = null) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    const activeId = targetWebsiteId !== null ? targetWebsiteId : selectedWebsiteId;

    try {
      const res = await apiService.getWebsiteTrackingStats(activeId || null);
      if (res && res.success) {
        setStats(res);
        if (!res.website) {
          setShowRegisterForm(true);
        } else {
          setShowRegisterForm(false);
          if (!selectedWebsiteId || targetWebsiteId) {
            setSelectedWebsiteId(res.website.id);
          }
        }
      }
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to load website tracking details.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRegisterWebsite = async (e) => {
    e.preventDefault();
    if (!siteName.trim() || !siteOrigin.trim()) {
      setFormError('Website name and exact origin URL are required.');
      return;
    }
    setRegistering(true);
    setFormError('');

    try {
      await apiService.registerTrackingWebsite({
        name: siteName.trim(),
        origin: siteOrigin.trim(),
      });
      setSiteName('');
      setSiteOrigin('');
      await loadData(true);
    } catch (err) {
      setFormError(err?.response?.data?.error || err.message || 'Failed to register website.');
    } finally {
      setRegistering(false);
    }
  };

  const handleCopySnippet = () => {
    if (!stats?.snippet) return;
    navigator.clipboard.writeText(stats.snippet).then(() => {
      setSnippetCopied(true);
      setTimeout(() => setSnippetCopied(false), 2000);
    });
  };

  const handleCopyAttribute = (attr, productId) => {
    navigator.clipboard.writeText(attr).then(() => {
      setCopiedAttrMap((prev) => ({ ...prev, [productId]: true }));
      setTimeout(() => {
        setCopiedAttrMap((prev) => ({ ...prev, [productId]: false }));
      }, 2000);
    });
  };

  const website = stats?.website;
  const products = stats?.products || [];

  return (
    <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Globe className="w-4 h-4 text-sky-400" />
              Connect Website & On-Site Activity
            </h3>
            <span className="text-[11px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded-full">
              First-Party Website Events
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Connect your storefront or landing page to record page views and marked product clicks directly from your website HTML.
            Metric label: <span className="font-semibold text-slate-300">Events & clicks (not unique visitors)</span>.
            Privacy-first, no personal data or cookies stored.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {stats?.websites && stats.websites.length > 1 && !showRegisterForm && (
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs">
              <label htmlFor="website-switcher" className="text-slate-400 text-[11px] font-medium shrink-0">
                Site:
              </label>
              <select
                id="website-switcher"
                value={selectedWebsiteId || website?.id || ''}
                onChange={(e) => {
                  const newId = e.target.value;
                  setSelectedWebsiteId(newId);
                  loadData(false, newId);
                }}
                className="bg-transparent text-slate-200 text-xs font-medium focus:outline-none cursor-pointer"
              >
                {stats.websites.map((w) => (
                  <option key={w.id} value={w.id} className="bg-slate-900 text-slate-200">
                    {w.name} ({w.origin})
                  </option>
                ))}
              </select>
            </div>
          )}
          {website && !showRegisterForm && (
            <button
              type="button"
              onClick={() => setShowRegisterForm(true)}
              className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Connect Another Site</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={refreshing || loading}
            aria-label="Refresh website activity data"
            className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Localhost & Hosting Warning Banner */}
      {stats?.isLocalhost ? (
        <div className="p-4 rounded-xl text-xs flex items-start gap-3 border bg-amber-500/10 border-amber-500/20 text-amber-300">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-slate-200">
              Localhost Environment Notice:
            </p>
            <p className="leading-relaxed">
              The backend is currently running on localhost. External HTTPS websites (such as a Vercel deployment) cannot reliably dispatch tracking events to a localhost backend due to browser mixed-content and cross-network restrictions.
            </p>
            <p className="text-[11px] text-amber-300/80">
              For live production tracking across real visitors, configure <code className="text-slate-200 bg-slate-900/80 px-1 py-0.5 rounded">PUBLIC_TRACKING_BASE_URL</code> to a public HTTPS domain.
            </p>
          </div>
        </div>
      ) : stats?.warning ? (
        <div className="p-4 rounded-xl text-xs flex items-start gap-3 border bg-slate-900/40 border-slate-800 text-slate-400">
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p>{stats.warning}</p>
        </div>
      ) : null}

      {/* Register Website Form (when no website or adding another) */}
      {showRegisterForm && (
        <form onSubmit={handleRegisterWebsite} className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Register Website Origin</h4>
            {website && (
              <button
                type="button"
                onClick={() => setShowRegisterForm(false)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Back to Active Site
              </button>
            )}
          </div>

          {formError && (
            <p className="text-xs text-red-400 bg-red-950/20 p-2.5 rounded-lg border border-red-900/30">{formError}</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Website Name</label>
              <input
                type="text"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="e.g. My E-Commerce Store"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-sky-500"
                required
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Exact Website Origin (http or https)</label>
              <input
                type="url"
                value={siteOrigin}
                onChange={(e) => setSiteOrigin(e.target.value)}
                placeholder="e.g. https://yourdomain.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-sky-500"
                required
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Note: Enter the exact root protocol and domain (e.g. <code className="text-slate-300">https://yourdomain.com</code>). Origin validation acts as a browser CORS allowlist; it does not authenticate or prove website ownership, and events are not tamper-proof.
          </p>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={registering}
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors disabled:opacity-50"
            >
              {registering ? 'Connecting...' : 'Connect Website & Generate Snippet'}
            </button>
            {website && (
              <button
                type="button"
                onClick={() => setShowRegisterForm(false)}
                className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {/* Connected Website Dashboard View */}
      {website && (
        <div className="space-y-6">
          {/* Status & Snippet Box */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-sm font-semibold text-slate-200">{website.name}</span>
                <a
                  href={website.origin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-xs font-medium transition-colors"
                >
                  <span>Open Connected Website</span>
                  <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                </a>
              </div>

              <div>
                {stats.installationPending ? (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Website Registered (Tracking Inactive)</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Tracking Active & Receiving Events</span>
                  </div>
                )}
              </div>
            </div>

            {/* Clear distinction notice */}
            {stats.installationPending && (
              <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-900/30 text-[11px] text-amber-300/90 leading-relaxed">
                <span className="font-semibold text-amber-200">Tracking Status: Inactive. </span>
                Your website origin is registered on your account, but on-site tracking is not yet active. Tracking activates only after you install the script snippet below into your website HTML and deploy it, and your backend is publicly reachable over HTTPS.
              </div>
            )}

            {/* Embed Snippet */}
            <div className="space-y-1.5 pt-1">
              <span className="text-xs text-slate-400 font-medium">Step 1: Install Tracker Snippet in Website HTML</span>
              <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-950/80 border border-slate-800">
                <code className="text-xs font-mono text-sky-300 break-all">{stats.snippet}</code>
                <button
                  type="button"
                  onClick={handleCopySnippet}
                  className="px-3 py-1.5 rounded bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 border border-sky-500/30 text-xs font-medium flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  {snippetCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copy Snippet
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Paste this script tag inside your website's <code className="text-slate-400">&lt;head&gt;</code> tag and deploy the site. The script is lightweight (~1KB), non-blocking, and never interferes with page navigation.
              </p>
            </div>
          </div>

          {/* Data Integrity & Honesty Advisory Notice */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs text-slate-400 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-slate-300">Data Integrity Notice</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Browser-reported events are approximate and can be spoofed or blocked by ad-blockers. They represent client-side page load and click triggers, <strong>not unique visitors, verified market demand, or confirmed purchases</strong>.
              </p>
            </div>
          </div>

          {/* Activity KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Total Page Views</span>
                <Eye className="w-4 h-4 text-sky-400" />
              </div>
              <p className="text-2xl font-bold text-slate-100 mt-2 font-mono">
                {stats.totalPageViews}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">Page view events (not unique visitors)</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Total Product Clicks</span>
                <MousePointerClick className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-2xl font-bold text-slate-100 mt-2 font-mono">
                {stats.totalProductClicks}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">Explicit product click events (not unique visitors)</p>
            </div>
          </div>

          {/* Product Tagging Helper Table */}
          <div className="space-y-3 pt-2">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Step 2: Tag Product Elements on Your Website
              </h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Add the corresponding HTML attribute to any button, card, or link on your website to track clicks for that specific product.
              </p>
            </div>

            {products.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800 text-xs text-slate-400 italic">
                No products found. Create a product in the Campaign Link Tracking section above to generate product tracking attributes.
              </div>
            ) : (
              <div className="space-y-2">
                {products.map((prod) => (
                  <div
                    key={prod.id}
                    className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-200">{prod.name}</span>
                        <span className="font-mono text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                          {prod.productClicks} clicks
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 font-mono block mt-0.5">
                        Target: {prod.destinationUrl}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <code className="text-[11px] font-mono text-emerald-300 bg-slate-950/80 px-2.5 py-1 rounded border border-slate-800 select-all">
                        {prod.trackAttribute}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopyAttribute(prod.trackAttribute, prod.id)}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/80 text-[11px] font-medium flex items-center gap-1 shrink-0 transition-colors"
                      >
                        {copiedAttrMap[prod.id] ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Copy Attr
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
