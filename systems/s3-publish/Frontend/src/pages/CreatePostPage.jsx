import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  PenSquare, 
  Send, 
  Image as ImageIcon, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  Facebook,
  Linkedin,
  Instagram,
  Twitter
} from 'lucide-react';
import { apiService } from '../services/api';
import StatusBadge from '../components/StatusBadge';

export default function CreatePostPage() {
  const navigate = useNavigate();

  const [caption, setCaption] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [platform, setPlatform] = useState('facebook');
  const [accountId, setAccountId] = useState('');
  const [publishNow, setPublishNow] = useState(true);
  const [scheduledFor, setScheduledFor] = useState('');
  const [timezone, setTimezone] = useState('Asia/Dhaka');

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [userAccounts, setUserAccounts] = useState([]);

  React.useEffect(() => {
    apiService.getAccounts()
      .then((res) => {
        const accs = res?.accounts || [];
        setUserAccounts(accs);
        const matched = accs.find((a) => (a.platform || '').toLowerCase() === platform.toLowerCase());
        if (matched) {
          setAccountId(matched.accountId || matched.id);
        }
      })
      .catch(() => setUserAccounts([]));
  }, []);

  const platformsList = [
    { id: 'facebook', name: 'Facebook', icon: Facebook, defaultAcc: '', color: 'text-blue-500' },
    { id: 'linkedin', name: 'LinkedIn', icon: Linkedin, defaultAcc: '', color: 'text-sky-500' },
    { id: 'instagram', name: 'Instagram', icon: Instagram, defaultAcc: '', color: 'text-pink-500' },
    { id: 'twitter', name: 'X / Twitter', icon: Twitter, defaultAcc: '', color: 'text-slate-200' },
  ];

  const handlePlatformSelect = (selectedId) => {
    setPlatform(selectedId);
    const matched = userAccounts.find((a) => (a.platform || '').toLowerCase() === selectedId.toLowerCase());
    if (matched) {
      setAccountId(matched.accountId || matched.id);
    } else {
      setAccountId('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return; // Prevent accidental double submission

    setErrorMessage('');
    setResult(null);

    // Form validation
    if (!imageUrl && (!caption || !caption.trim())) {
      setErrorMessage('Caption text is required for text posts.');
      return;
    }

    if (!publishNow && !scheduledFor) {
      setErrorMessage('Please specify a scheduled date and time for delayed publishing.');
      return;
    }

    if (!accountId.trim()) {
      setErrorMessage('Account ID is required. Enter your connected account ID or connect an account in Social Accounts.');
      return;
    }

    if (imageUrl) {
      try {
        new URL(imageUrl);
      } catch (_e) {
        setErrorMessage('Invalid Image URL format. Must be a valid HTTP/HTTPS URL.');
        return;
      }
    }

    setSubmitting(true);

    let formattedScheduledFor = undefined;
    if (!publishNow && scheduledFor) {
      try {
        const dateObj = new Date(scheduledFor);
        if (!isNaN(dateObj.getTime())) {
          formattedScheduledFor = dateObj.toISOString();
        } else {
          formattedScheduledFor = scheduledFor;
        }
      } catch (_e) {
        formattedScheduledFor = scheduledFor;
      }
    }

    const payload = {
      caption: caption.trim() || undefined,
      imageUrl: imageUrl && imageUrl.trim() ? imageUrl.trim() : undefined,
      platforms: [
        {
          platform,
          accountId: accountId.trim(),
        },
      ],
      publishNow,
      scheduledFor: formattedScheduledFor,
      scheduledAt: formattedScheduledFor,
      timezone: !publishNow ? timezone : undefined,
    };

    try {
      const response = await apiService.publishPost(payload);
      setResult(response);
      if (response.success || response.status === 'published' || response.status === 'scheduled') {
        setCaption('');
        setImageUrl('');
      } else {
        setErrorMessage(response.error || 'Publishing completed with warnings.');
      }
    } catch (err) {
      const serverErr =
        err.response?.data?.error ||
        err.response?.data?.message ||
        (Array.isArray(err.response?.data?.platforms) && err.response.data.platforms[0]?.error) ||
        err.message ||
        'An error occurred while communicating with the Backend server.';
      setErrorMessage(serverErr);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <PenSquare className="w-5 h-5 text-blue-400" />
            Social Content Publisher
          </h1>
          <p className="text-xs text-slate-400 mt-1">Compose and dispatch multi-platform content via Zernio Engine.</p>
        </div>
      </div>

      {/* Success Banner */}
      {result && (result.success || result.status === 'published' || result.status === 'scheduled') && (
        <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            {result.status === 'scheduled'
              ? 'Post Successfully Scheduled!'
              : 'Post Confirmed & Published by Backend Engine!'}
          </div>
          <div className="text-xs space-y-1 text-slate-300 pl-7">
            <p><strong className="text-slate-100">Internal Post ID:</strong> <code className="bg-slate-900 px-2 py-0.5 rounded text-blue-400 font-mono">{result.postId}</code></p>
            <p><strong className="text-slate-100">Status:</strong> <StatusBadge status={result.status} /></p>
            {result.status === 'scheduled' && (
              <p>
                <strong className="text-slate-100">Scheduled Time:</strong>{' '}
                <span className="text-amber-300 font-mono">
                  {scheduledFor ? new Date(scheduledFor).toLocaleString() : 'As requested'} ({timezone})
                </span>
              </p>
            )}
            {result.platforms?.[0]?.platformPostUrl && (
              <p>
                <strong className="text-slate-100">Live Post URL:</strong>{' '}
                <a href={result.platforms[0].platformPostUrl} target="_blank" rel="noopener noreferrer" className="underline text-blue-400 hover:text-blue-300">
                  {result.platforms[0].platformPostUrl}
                </a>
              </p>
            )}
          </div>
          <div className="pt-2 pl-7 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => navigate(`/posts/${result.postId}`)}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all shadow focus:ring-2 focus:ring-emerald-400"
            >
              View Analytics Details
            </button>
            <button
              type="button"
              onClick={() => navigate('/posts')}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all focus:ring-2 focus:ring-slate-400"
            >
              Go to All Posts
            </button>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-rose-200">Publishing Failed</p>
            <p className="text-xs text-rose-300/90 mt-0.5">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Form Container */}
      <form onSubmit={handleSubmit} className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-6">
        {/* Platform Picker */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
            Target Platform
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {platformsList.map((p) => {
              const Icon = p.icon;
              const isSelected = platform === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => handlePlatformSelect(p.id)}
                  className={`p-3.5 rounded-xl border flex flex-col items-center gap-2 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isSelected
                      ? 'bg-blue-600/15 border-blue-500 text-slate-100 shadow-md shadow-blue-500/10'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${p.color}`} />
                  <span className="text-xs font-semibold">{p.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Account ID Input / Selector */}
        <div>
          <label htmlFor="accountIdInput" className="block text-xs font-medium text-slate-400 mb-1">
            Platform Account ID
          </label>
          {userAccounts.filter((a) => (a.platform || '').toLowerCase() === platform.toLowerCase()).length > 0 ? (
            <select
              id="accountIdInput"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-blue-500 font-mono transition-colors"
            >
              {userAccounts
                .filter((a) => (a.platform || '').toLowerCase() === platform.toLowerCase())
                .map((a) => (
                  <option key={a.id || a.accountId} value={a.accountId || a.id}>
                    {a.displayName ? `${a.displayName} (${a.accountId || a.id})` : (a.accountId || a.id)}
                  </option>
                ))}
            </select>
          ) : (
            <input
              id="accountIdInput"
              type="text"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="No connected account found for this platform"
              className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-blue-500 font-mono transition-colors"
            />
          )}
          <p className="mt-1 text-[11px] text-slate-500">
            {userAccounts.filter((a) => (a.platform || '').toLowerCase() === platform.toLowerCase()).length > 0
              ? 'Using your connected account for this platform.'
              : 'No connected account for this platform. Connect an account in Social Channels.'}
          </p>
        </div>

        {/* Caption / Content Area */}
        <div>
          <label htmlFor="captionInput" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
            Post Content / Caption
          </label>
          <textarea
            id="captionInput"
            rows={5}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Write your social marketing copy here..."
            className="w-full p-4 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-blue-500 transition-colors resize-none placeholder:text-slate-600"
          />
        </div>

        {/* Media URL Input */}
        <div>
          <label htmlFor="imageUrlInput" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
            Media Image URL <span className="text-slate-500 text-[11px] font-normal">(Optional)</span>
          </label>
          <input
            id="imageUrlInput"
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://example.com/marketing-banner.png"
            className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Schedule Mode & Parameters */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-semibold text-slate-200">Publishing Timing</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setPublishNow(true)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all focus:outline-none ${
                  publishNow ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Publish Now
              </button>
              <button
                type="button"
                onClick={() => setPublishNow(false)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all focus:outline-none ${
                  !publishNow ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Schedule Post
              </button>
            </div>
          </div>

          {!publishNow && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
              <div>
                <label htmlFor="scheduledForInput" className="block text-xs text-slate-400 mb-1">Scheduled Date & Time</label>
                <input
                  id="scheduledForInput"
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label htmlFor="timezoneInput" className="block text-xs text-slate-400 mb-1">Timezone</label>
                <input
                  id="timezoneInput"
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="Asia/Dhaka or UTC"
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Submit Action */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-blue-400"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Publishing to Zernio...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>{publishNow ? 'Publish Post Now' : 'Schedule Content'}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
