import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Share2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  Facebook,
  Linkedin,
  Instagram,
  Twitter,
  Plus,
  ExternalLink,
  Loader2,
  Youtube,
  Video,
  Sparkles,
  Lock,
  ArrowRight,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';

export default function SocialAccountsPage() {
  const navigate = useNavigate();
  const { completeAccountSelection, resetAccountSelection } = useAuth();
  const [authStatus, setAuthStatus] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [connectingPlatform, setConnectingPlatform] = useState(null);
  const [callbackProcessing, setCallbackProcessing] = useState(false);
  const [accountToDisconnect, setAccountToDisconnect] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const checkAuth = async (isManualTrigger = false) => {
    if (isManualTrigger) {
      setVerifying(true);
    } else {
      setLoading(true);
    }

    setError(null);
    if (!isManualTrigger) {
      // Don't wipe feedback immediately if it was just set by callback
    }

    try {
      const [authData, accountsData] = await Promise.all([
        apiService.verifyAuth(),
        apiService.getAccounts().catch(() => ({ accounts: [] })),
      ]);

      setAuthStatus(authData);
      setAccounts(accountsData?.accounts || []);

      if (isManualTrigger) {
        setFeedback('Connection re-verified successfully!');
      }
    } catch (err) {
      setError(
        err.response?.data?.error ||
        'Failed to verify Zernio API authentication status'
      );
    } finally {
      setLoading(false);
      setVerifying(false);
    }
  };

  useEffect(() => {
    // Check if returning from Zernio hosted connection redirect
    const queryParams = new URLSearchParams(window.location.search);
    const connectedParam = queryParams.get('connected');
    const profileIdParam = queryParams.get('profileId');
    const accountIdParam = queryParams.get('accountId');
    const usernameParam = queryParams.get('username');
    const platformParam = queryParams.get('platform');
    const errorParam = queryParams.get('error');

    const hasCallbackParams =
      connectedParam !== null || accountIdParam !== null || errorParam !== null;

    if (hasCallbackParams) {
      // Clean query string from browser address bar
      window.history.replaceState({}, document.title, window.location.pathname);

      if (connectedParam === 'false' || errorParam) {
        setFeedback('');
        setError(errorParam || 'Social channel authorization was canceled or declined.');
        checkAuth(false);
        return;
      }

      if (accountIdParam) {
        setCallbackProcessing(true);
        setError(null);
        setFeedback('');

        apiService
          .completeConnectCallback({
            connected: true,
            profileId: profileIdParam || undefined,
            accountId: accountIdParam,
            username: usernameParam || undefined,
            platform: platformParam || undefined,
          })
          .then(async (res) => {
            // Refresh account list from server first so state is accurate before showing success
            const accountsData = await apiService
              .getAccounts()
              .catch(() => ({ accounts: [] }));
            setAccounts(accountsData?.accounts || []);

            // Mark session onboarding complete only after backend verification & account list refresh succeed
            completeAccountSelection();

            const accName =
              res.account?.displayName ||
              usernameParam ||
              res.account?.platform ||
              'Account';
            setFeedback(
              `Successfully connected ${accName}! Returning to Dashboard...`
            );
            setError(null);

            apiService.verifyAuth().then(setAuthStatus).catch(() => {});

            setTimeout(() => {
              navigate('/');
            }, 1200);
          })
          .catch(async (err) => {
            // Never falsely show success if verification or persistence failed
            setFeedback('');
            setError(
              err.response?.data?.error ||
                'Failed to verify and register connected social account.'
            );
            // Re-fetch current accounts to display genuine state
            const accountsData = await apiService
              .getAccounts()
              .catch(() => ({ accounts: [] }));
            setAccounts(accountsData?.accounts || []);
          })
          .finally(() => {
            setCallbackProcessing(false);
            setLoading(false);
          });
        return;
      }
    }

    checkAuth(false);
  }, []);

  const handleConnect = async (platformId) => {
    setConnectingPlatform(platformId);
    setError(null);
    setFeedback('');

    try {
      const redirectUrl = `${window.location.origin}/accounts`;
      const res = await apiService.getConnectUrl(platformId, redirectUrl);

      if (res?.authUrl) {
        // Redirect browser to Zernio hosted OAuth authorization screen
        window.location.href = res.authUrl;
      } else {
        setError('No authorization URL received from server.');
        setConnectingPlatform(null);
      }
    } catch (err) {
      setError(
        err.response?.data?.error ||
        `Failed to initialize connection for ${platformId}. Please try again.`
      );
      setConnectingPlatform(null);
    }
  };

  const handleContinueWithAccount = () => {
    completeAccountSelection();
    navigate('/');
  };

  const promptDisconnect = (acc) => {
    setAccountToDisconnect(acc);
  };

  const cancelDisconnect = () => {
    if (disconnecting) return;
    setAccountToDisconnect(null);
  };

  const confirmDisconnect = async () => {
    if (!accountToDisconnect) return;
    setDisconnecting(true);
    setError(null);

    const targetAcc = accountToDisconnect;
    const accountId = targetAcc.accountId || targetAcc.id;
    const accName = targetAcc.displayName || targetAcc.accountUsername || targetAcc.platform || 'Account';

    try {
      await apiService.disconnectAccount(accountId);

      // Reload accounts from server
      const accountsData = await apiService.getAccounts().catch(() => ({ accounts: [] }));
      const remaining = accountsData?.accounts || [];
      setAccounts(remaining);

      // If user now has no connected accounts, lock other app pages & return to chooser
      if (remaining.length === 0) {
        resetAccountSelection();
      }

      setFeedback(`Successfully disconnected ${accName}. You can reconnect anytime.`);
      setAccountToDisconnect(null);
    } catch (err) {
      setError(
        err.response?.data?.error ||
        `Failed to disconnect ${accName}. Please try again.`
      );
      setAccountToDisconnect(null);
    } finally {
      setDisconnecting(false);
    }
  };

  const getPlatformIcon = (platform) => {
    switch ((platform || '').toLowerCase()) {
      case 'facebook':
        return <Facebook className="w-5 h-5 text-blue-500" />;
      case 'linkedin':
        return <Linkedin className="w-5 h-5 text-sky-500" />;
      case 'instagram':
        return <Instagram className="w-5 h-5 text-pink-500" />;
      case 'twitter':
        return <Twitter className="w-5 h-5 text-slate-200" />;
      default:
        return <Share2 className="w-5 h-5 text-blue-400" />;
    }
  };

  const supportedChannels = [
    {
      id: 'facebook',
      name: 'Facebook',
      desc: 'Pages & publishing access',
      icon: Facebook,
      iconColor: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/30',
      btnBg: 'bg-blue-600 hover:bg-blue-500',
      supported: true,
    },
    {
      id: 'instagram',
      name: 'Instagram',
      desc: 'Business & Creator profiles',
      icon: Instagram,
      iconColor: 'text-pink-500',
      bgColor: 'bg-pink-500/10',
      borderColor: 'border-pink-500/30',
      btnBg: 'bg-gradient-to-r from-pink-600 to-purple-600 hover:opacity-90',
      supported: true,
    },
    {
      id: 'linkedin',
      name: 'LinkedIn',
      desc: 'Member profile & company pages',
      icon: Linkedin,
      iconColor: 'text-sky-500',
      bgColor: 'bg-sky-500/10',
      borderColor: 'border-sky-500/30',
      btnBg: 'bg-sky-600 hover:bg-sky-500',
      supported: true,
    },
    {
      id: 'twitter',
      name: 'X / Twitter',
      desc: 'Posts, media & timeline updates',
      icon: Twitter,
      iconColor: 'text-slate-200',
      bgColor: 'bg-slate-500/10',
      borderColor: 'border-slate-500/30',
      btnBg: 'bg-slate-700 hover:bg-slate-600 text-white',
      supported: true,
    },
  ];

  const upcomingChannels = [
    {
      id: 'youtube',
      name: 'YouTube',
      desc: 'Video publishing & Shorts',
      icon: Youtube,
      iconColor: 'text-red-500/50',
    },
    {
      id: 'tiktok',
      name: 'TikTok',
      desc: 'Short-form video publishing',
      icon: Sparkles,
      iconColor: 'text-cyan-500/50',
    },
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Share2 className="w-5 h-5 text-blue-400" />
            Social Channels & Credentials
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Connect and manage your social network accounts using secure hosted authorization.
          </p>
        </div>

        <button
          onClick={() => checkAuth(true)}
          disabled={verifying || loading || callbackProcessing}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors disabled:opacity-50 focus:ring-2 focus:ring-blue-400"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`}
          />
          <span>{verifying ? 'Verifying...' : 'Re-Verify Connection'}</span>
        </button>
      </div>

      {/* Callback Processing Banner */}
      {callbackProcessing && (
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-medium flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          Verifying and linking your social account with Zernio... Please wait.
        </div>
      )}

      {/* Feedback & Success Messages */}
      {feedback && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Error Messages */}
      {error && (
        <div className="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-rose-200">Connection Error</p>
            <p className="text-xs text-rose-300/90 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Main Authentication Engine Status Card */}
      {loading ? (
        <LoadingSpinner text="Checking social connection status..." />
      ) : (
        <div className="space-y-6">
          {/* Engine Status Banner */}
          <div className="glass-panel p-5 rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`p-3 rounded-xl ${authStatus?.valid
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-rose-500/10 text-rose-400'
                  }`}
              >
                <ShieldCheck className="w-6 h-6" />
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-100">
                  {authStatus?.valid
                    ? 'Zernio API Engine Active'
                    : 'Zernio Authentication Issue'}
                </h3>
                <p className="text-xs text-slate-400">
                  {authStatus?.message || 'Zernio publishing engine ready'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {authStatus?.valid ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Authenticated
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Connection Error
                </span>
              )}
            </div>
          </div>

          {/* Connect New Channels Section */}
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-400" />
                Connect New Social Channel
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Authorize directly with the platform. You will be redirected to the official sign-in page.
              </p>
            </div>

            {/* Supported Channels Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              {supportedChannels.map((ch) => {
                const IconComponent = ch.icon;
                const isConnecting = connectingPlatform === ch.id;
                const connectedCount = accounts.filter(
                  (a) => (a.platform || '').toLowerCase() === ch.id.toLowerCase()
                ).length;

                return (
                  <div
                    key={ch.id}
                    className={`p-4 rounded-xl border ${ch.borderColor} bg-slate-900/60 flex flex-col justify-between gap-3 transition-all`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl ${ch.bgColor} border ${ch.borderColor}`}>
                          <IconComponent className={`w-5 h-5 ${ch.iconColor}`} />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-slate-200">
                            {ch.name}
                          </h4>
                          <p className="text-[11px] text-slate-400">
                            {ch.desc}
                          </p>
                        </div>
                      </div>

                      {connectedCount > 0 && (
                        <span className="text-[10px] font-semibold text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                          {connectedCount === 1 ? 'Connected' : `${connectedCount} Connected`}
                        </span>
                      )}
                    </div>

                    {connectedCount > 0 ? (
                      <div className="space-y-2 w-full">
                        <button
                          onClick={handleContinueWithAccount}
                          className="w-full py-2 px-3 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 flex items-center justify-center gap-2 transition-all shadow-sm"
                        >
                          <span>Use connected account / Continue to Dashboard</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => handleConnect(ch.id)}
                          disabled={isConnecting || callbackProcessing}
                          className="w-full py-1.5 px-3 rounded-xl text-[11px] font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                        >
                          {isConnecting ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>Connecting...</span>
                            </>
                          ) : (
                            <>
                              <span>Connect another {ch.id === 'facebook' ? 'Page' : 'Account'}</span>
                              <ExternalLink className="w-3 h-3 opacity-80" />
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleConnect(ch.id)}
                        disabled={isConnecting || callbackProcessing}
                        className={`w-full py-2 px-3 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2 transition-all shadow-sm ${ch.btnBg} disabled:opacity-50`}
                      >
                        {isConnecting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Connecting...</span>
                          </>
                        ) : (
                          <>
                            <span>Connect {ch.name}</span>
                            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Unsupported / Upcoming Channels */}
            <div className="pt-2">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Upcoming Platforms (Unconfigured)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {upcomingChannels.map((up) => {
                  const UpIcon = up.icon;
                  return (
                    <div
                      key={up.id}
                      className="p-3.5 rounded-xl border border-slate-800/80 bg-slate-900/30 flex items-center justify-between opacity-60 cursor-not-allowed"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-slate-800/50 border border-slate-700/50">
                          <UpIcon className={`w-4 h-4 ${up.iconColor}`} />
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400">
                            {up.name}
                          </h4>
                          <p className="text-[10px] text-slate-400">
                            {up.desc}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-medium text-slate-400 px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                        Coming Soon
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Connected Channels List */}
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                Connected Target Channels ({accounts.length})
              </h3>
            </div>

            {accounts && accounts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {accounts.map((acc, index) => (
                  <div
                    key={acc.id || index}
                    className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-slate-800 border border-slate-700">
                        {getPlatformIcon(acc.platform)}
                      </div>

                      <div>
                        <h4 className="text-sm font-bold text-slate-200 capitalize">
                          {acc.displayName || `${acc.platform} Account`}
                        </h4>
                        <p className="text-xs text-slate-400 font-mono">
                          ID: {acc.accountId || acc.id}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-semibold text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                        Active
                      </span>
                      <button
                        type="button"
                        onClick={() => promptDisconnect(acc)}
                        disabled={disconnecting}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold text-rose-400 hover:text-white bg-rose-500/10 hover:bg-rose-600 border border-rose-500/20 transition-all flex items-center gap-1 shrink-0"
                        title={`Disconnect ${acc.displayName || acc.platform}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Disconnect</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-slate-900/40 border border-slate-800 text-center text-slate-400 text-sm">
                No connected social channels found. Use the buttons above to connect Facebook, Instagram, LinkedIn, or X/Twitter.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Disconnect Confirmation Dialog */}
      {accountToDisconnect && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">
                  Disconnect Social Account?
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Are you sure you want to disconnect{' '}
                  <span className="font-semibold text-slate-200">
                    {accountToDisconnect.displayName || accountToDisconnect.accountUsername || accountToDisconnect.accountId}
                  </span>{' '}
                  ({accountToDisconnect.platform})?
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                Publishing & Analytics Notice
              </p>
              <p className="text-[11px] text-amber-300/80 leading-relaxed">
                Publishing and metrics collection for this account will pause until reconnected.
                All existing Facebook posts, published history, and database records remain safely preserved.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={cancelDisconnect}
                disabled={disconnecting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDisconnect}
                disabled={disconnecting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
              >
                {disconnecting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Disconnecting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Disconnect Account</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
