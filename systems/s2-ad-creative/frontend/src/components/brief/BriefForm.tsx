'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  ShoppingBag,
  Building,
  Target,
  FileCheck,
  Image as ImageIcon,
  Save,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  validateAssetUrl,
  getDemoBrief,
  saveBrief,
} from '../../lib/api';
import {
  ValidationReport,
  AssetValidationResponse,
  BriefPayload,
  SaveBriefResponse,
} from '../../lib/types';
import { ColorPicker } from '../common/ColorPicker';

interface BriefFormProps {
  onValidated: (
    briefReport?: ValidationReport | null,
    assetReport?: AssetValidationResponse | null
  ) => void;
  onSavedSuccess?: (savedData: SaveBriefResponse) => void;
  onPayloadChange?: (payload: BriefPayload, briefId?: string) => void;
  onLoadDemoAndRun?: (savedData: SaveBriefResponse) => Promise<void> | void;
  savedBriefId?: string;
  initialPayload?: BriefPayload | null;
  onProceedToStrategy?: () => void;
}

export const BriefForm: React.FC<BriefFormProps> = ({
  onValidated,
  onSavedSuccess,
  onPayloadChange,
  savedBriefId,
  initialPayload,
  onProceedToStrategy,
}) => {

  // Form State
  const [productName, setProductName] = useState('SmartFit X1');
  const [category, setCategory] = useState('Smart Wearables');
  const [sku, setSku] = useState('SMARTFIT-X1-BLK');
  const [price, setPrice] = useState('4999');
  const [originalPrice, setOriginalPrice] = useState('6499');
  const [currency, setCurrency] = useState('BDT');
  const [discountPercent, setDiscountPercent] = useState('23');
  const [promoCode, setPromoCode] = useState('FIT23');
  const [features, setFeatures] = useState<string[]>([
    '7-day battery life on a single charge',
    'Continuous heart-rate & SpO2 tracking',
    'Advanced sleep stages monitoring',
    '5 ATM water resistance up to 50 meters',
  ]);
  const [newFeature, setNewFeature] = useState('');

  // Brand State
  const [brandName, setBrandName] = useState('SmartFit');
  const [logoUrl, setLogoUrl] = useState('');
  const [colors, setColors] = useState<string[]>(['#2563EB', '#111827', '#10B981']);
  const [fontFamily, setFontFamily] = useState('Inter');

  // Campaign State
  const [campaignName, setCampaignName] = useState('SmartFit X1 Launch Bangladesh');
  const [objective, setObjective] = useState('product_sales');
  const [platforms, setPlatforms] = useState<string[]>(['instagram', 'facebook', 'linkedin']);
  const [targetAudience, setTargetAudience] = useState(
    'Urban fitness enthusiasts and professionals aged 22-40.'
  );

  // Claims & Copy
  const [approvedClaims, setApprovedClaims] = useState<string[]>([
    '7-day battery life',
    'Heart-rate tracking with optical sensor',
    'Sleep tracking analysis',
  ]);
  const [newClaim, setNewClaim] = useState('');
  const [headline, setHeadline] = useState('Track Every Move. Elevate Every Day.');
  const [subheadline, setSubheadline] = useState('7-day battery life with real-time biometric fitness monitoring.');
  const [cta, setCta] = useState('Shop Now');

  // Asset State
  const [imageUrl, setImageUrl] = useState('http://127.0.0.1:8000/api/v1/storage/demo/smartfit_x1.png');
  const [requireTransparency, setRequireTransparency] = useState(true);

  // Status
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [validatingAsset, setValidatingAsset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Helpers
  const togglePlatform = (p: string) => {
    if (platforms.includes(p)) {
      if (platforms.length > 1) {
        setPlatforms(platforms.filter((item) => item !== p));
      }
    } else {
      setPlatforms([...platforms, p]);
    }
  };

  const addFeature = () => {
    if (newFeature.trim()) {
      setFeatures([...features, newFeature.trim()]);
      setNewFeature('');
    }
  };

  const removeFeature = (idx: number) => {
    setFeatures(features.filter((_, i) => i !== idx));
  };

  const addClaim = () => {
    if (newClaim.trim()) {
      setApprovedClaims([...approvedClaims, newClaim.trim()]);
      setNewClaim('');
    }
  };

  const removeClaim = (idx: number) => {
    setApprovedClaims(approvedClaims.filter((_, i) => i !== idx));
  };

  const constructPayload = () => {
    const trimmedBrandName = brandName.trim();
    const trimmedProductName = productName.trim();
    const parsedPrice = parseFloat(price);
    const parsedOriginalPrice = originalPrice.trim() ? parseFloat(originalPrice) : undefined;
    const parsedDiscount = discountPercent.trim() ? parseFloat(discountPercent) : undefined;

    return {
      brand: {
        name: trimmedBrandName,
        logo_url: logoUrl.trim() || undefined,
        colors: colors.length > 0 ? colors : undefined,
        font_family: fontFamily.trim() || undefined,
      },
      product: {
        name: trimmedProductName,
        category: category.trim() || undefined,
        sku: sku.trim() || undefined,
        offer: {
          price: isNaN(parsedPrice) ? 0 : parsedPrice,
          original_price: parsedOriginalPrice !== undefined && !isNaN(parsedOriginalPrice) ? parsedOriginalPrice : undefined,
          currency: currency.trim() || 'USD',
          discount_percent: parsedDiscount !== undefined && !isNaN(parsedDiscount) ? parsedDiscount : undefined,
          promo_code: promoCode.trim() || undefined,
        },
        features: features,
      },
      images: [
        {
          url: imageUrl.trim(),
          asset_type: 'primary_product',
          description: `${trimmedProductName || 'Product'} primary product cutout`,
        },
      ],
      campaign: {
        name: campaignName.trim() || undefined,
        objective: objective,
        platforms: platforms.length > 0 ? platforms : ['instagram'],
        target_audience: targetAudience.trim() || undefined,
      },
      approved_claims: approvedClaims,
      copy: {
        headline: headline.trim() || undefined,
        subheadline: subheadline.trim() || undefined,
        cta: cta.trim() || undefined,
      },
    };
  };

  // Actions
  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    setSaveSuccessMsg(null);
    const { data } = await getDemoBrief();
    if (data) {
      setBrandName(data.brand?.name || '');
      setLogoUrl(data.brand?.logo_url || '');
      setColors(data.brand?.colors || []);
      setFontFamily(data.brand?.font_family || 'Inter');

      setProductName(data.product?.name || '');
      setCategory(data.product?.category || '');
      setSku(data.product?.sku || '');
      setPrice(String(data.product?.offer?.price || '4999'));
      setOriginalPrice(String(data.product?.offer?.original_price || '6499'));
      setCurrency(data.product?.offer?.currency || 'BDT');
      setDiscountPercent(String(data.product?.offer?.discount_percent || '23'));
      setPromoCode(data.product?.offer?.promo_code || 'FIT23');
      setFeatures(data.product?.features || []);

      if (data.images && data.images[0]) {
        setImageUrl(data.images[0].url);
      }

      setCampaignName(data.campaign?.name || '');
      setObjective(data.campaign?.objective || 'product_sales');
      setPlatforms(data.campaign?.platforms || ['instagram', 'facebook', 'linkedin']);
      setTargetAudience(data.campaign?.target_audience || '');

      setApprovedClaims(data.approved_claims || []);
      setHeadline(data.copy?.headline || '');
      setSubheadline(data.copy?.subheadline || '');
      if (onPayloadChange) {
        onPayloadChange(data);
      }

      // Automatically validate & save demo brief to backend so downstream steps are unlocked
      const saveRes = await saveBrief(data);
      if (saveRes.data && !saveRes.error) {
        setSaveSuccessMsg(`SmartFit X1 Demo loaded & saved! (ID: ${saveRes.data.id})`);
        onValidated(
          saveRes.data.brief_report,
          saveRes.data.asset_report ? { is_valid: true, status: 'PASS', report: saveRes.data.asset_report } : null
        );
        if (typeof window !== 'undefined') {
          localStorage.setItem('alias_studio_brief_id', saveRes.data.id);
          localStorage.removeItem('alias_studio_job_id');
        }
        setIsDirty(false);
        if (onPayloadChange) onPayloadChange(data, saveRes.data.id);
        if (onSavedSuccess) onSavedSuccess(saveRes.data);
      } else {
        setValidationError(saveRes.error || 'Failed to save demo brief.');
      }
    }
    setLoadingDemo(false);
  };

  const handleSelectIPhonePreset = async () => {
    setLoadingDemo(true);
    setValidationError(null);
    setSaveSuccessMsg(null);

    const targetUrl = 'http://127.0.0.1:8000/api/v1/storage/demo/iphone.png';
    const targetProduct = 'iPhone 16 Pro';
    const targetCategory = 'Smartphones';
    const targetSku = 'IPHONE-16-PRO-256-TI';
    const targetPrice = '999';
    const targetOriginalPrice = '1199';
    const targetCurrency = 'USD';
    const targetDiscount = '16';
    const targetPromo = 'TITANIUM16';
    const targetBrand = 'Apple';
    const targetColors = ['#1D1D1F', '#F5F5F7', '#86868B', '#5E5CE6'];
    const targetFeatures = [
      'A18 Pro chip with 6-core GPU',
      'Grade 5 Titanium design with textured matte glass back',
      'Pro camera system with 48MP Fusion and 5x Telephoto',
      'Up to 27 hours video playback',
    ];
    const targetCampaign = 'iPhone 16 Pro Global Launch';
    const targetAudience = 'Tech innovators, mobile creators, and premium smartphone users.';
    const targetClaims = [
      'A18 Pro chip performance',
      '48MP Fusion camera system',
      'Grade 5 Titanium design',
    ];
    const targetHeadline = 'Pro Beyond Imagination.';
    const targetSubheadline = 'Powered by the groundbreaking A18 Pro chip and aerospace-grade Titanium.';
    const targetCta = 'Order Now';

    setProductName(targetProduct);
    setCategory(targetCategory);
    setSku(targetSku);
    setPrice(targetPrice);
    setOriginalPrice(targetOriginalPrice);
    setCurrency(targetCurrency);
    setDiscountPercent(targetDiscount);
    setPromoCode(targetPromo);
    setBrandName(targetBrand);
    setColors(targetColors);
    setFeatures(targetFeatures);
    setCampaignName(targetCampaign);
    setTargetAudience(targetAudience);
    setApprovedClaims(targetClaims);
    setHeadline(targetHeadline);
    setSubheadline(targetSubheadline);
    setCta(targetCta);
    setImageUrl(targetUrl);
    setRequireTransparency(true);
    setIsDirty(false);

    const payload: BriefPayload = {
      brand: {
        name: targetBrand,
        colors: targetColors,
        font_family: 'Inter',
      },
      product: {
        name: targetProduct,
        category: targetCategory,
        sku: targetSku,
        offer: {
          price: 999,
          original_price: 1199,
          currency: 'USD',
          discount_percent: 16,
          promo_code: targetPromo,
        },
        features: targetFeatures,
      },
      images: [
        {
          url: targetUrl,
          asset_type: 'primary_product',
          description: 'iPhone 16 Pro Cutout',
        },
      ],
      campaign: {
        name: targetCampaign,
        objective: 'product_sales',
        platforms: platforms.length > 0 ? platforms : ['instagram'],
        target_audience: targetAudience,
      },
      approved_claims: targetClaims,
      copy: {
        headline: targetHeadline,
        subheadline: targetSubheadline,
        cta: targetCta,
      },
    };

    if (onPayloadChange) {
      onPayloadChange(payload);
    }

    const saveRes = await saveBrief(payload, true);
    if (saveRes.data && !saveRes.error) {
      setSaveSuccessMsg(`iPhone 16 Pro demo loaded & saved! (ID: ${saveRes.data.id})`);
      onValidated(
        saveRes.data.brief_report,
        saveRes.data.asset_report
          ? {
              is_valid: true,
              status: 'PASS',
              report: saveRes.data.asset_report,
              asset_metadata: saveRes.data.asset_result?.asset_metadata,
            }
          : null
      );
      if (typeof window !== 'undefined') {
        localStorage.setItem('alias_studio_brief_id', saveRes.data.id);
        localStorage.removeItem('alias_studio_job_id');
      }
      if (onPayloadChange) onPayloadChange(payload, saveRes.data.id);
      if (onSavedSuccess) onSavedSuccess(saveRes.data);
    } else {
      setValidationError(saveRes.error || 'Failed to save iPhone 16 Pro brief.');
    }
    setLoadingDemo(false);
  };

  const handleSelectGreenPreset = async () => {
    setLoadingDemo(true);
    setValidationError(null);
    setSaveSuccessMsg(null);

    const targetUrl = 'http://127.0.0.1:8000/api/v1/storage/demo/green.png';
    const targetProduct = 'Monstera Watercolor Wall Art';
    const targetCategory = 'Home & Living';
    const targetSku = 'BOTANICAL-LEAF-01';
    const targetPrice = '29';
    const targetOriginalPrice = '49';
    const targetCurrency = 'USD';
    const targetDiscount = '40';
    const targetPromo = 'NATURE40';
    const targetBrand = 'Botanica Decor';
    const targetColors = ['#166534', '#15803D', '#DCFCE7', '#1E293B'];
    const targetFeatures = [
      'Hand-painted watercolor botanical aesthetic',
      'High resolution corner decor composition',
      'Vibrant organic green palette',
      'Multi-surface decorative print layout',
    ];
    const targetCampaign = 'Green Living Interior Launch';
    const targetAudience = 'Interior design enthusiasts, plant lovers, and modern home decorators.';
    const targetClaims = [
      'Hand-painted watercolor botanical aesthetic',
      'High resolution corner decor composition',
      'Vibrant organic green palette',
    ];
    const targetHeadline = 'Bring Nature Into Your Living Space.';
    const targetSubheadline = 'Organic hand-crafted botanical corner decorations for modern interiors.';
    const targetCta = 'Explore Collection';

    setProductName(targetProduct);
    setCategory(targetCategory);
    setSku(targetSku);
    setPrice(targetPrice);
    setOriginalPrice(targetOriginalPrice);
    setCurrency(targetCurrency);
    setDiscountPercent(targetDiscount);
    setPromoCode(targetPromo);
    setBrandName(targetBrand);
    setColors(targetColors);
    setFeatures(targetFeatures);
    setCampaignName(targetCampaign);
    setTargetAudience(targetAudience);
    setApprovedClaims(targetClaims);
    setHeadline(targetHeadline);
    setSubheadline(targetSubheadline);
    setCta(targetCta);
    setImageUrl(targetUrl);
    setRequireTransparency(false);
    setIsDirty(false);

    const payload: BriefPayload = {
      brand: {
        name: targetBrand,
        colors: targetColors,
        font_family: 'Inter',
      },
      product: {
        name: targetProduct,
        category: targetCategory,
        sku: targetSku,
        offer: {
          price: 29,
          original_price: 49,
          currency: 'USD',
          discount_percent: 40,
          promo_code: targetPromo,
        },
        features: targetFeatures,
      },
      images: [
        {
          url: targetUrl,
          asset_type: 'primary_product',
          description: 'Green Leaves Decor',
        },
      ],
      campaign: {
        name: targetCampaign,
        objective: 'product_sales',
        platforms: platforms.length > 0 ? platforms : ['instagram'],
        target_audience: targetAudience,
      },
      approved_claims: targetClaims,
      copy: {
        headline: targetHeadline,
        subheadline: targetSubheadline,
        cta: targetCta,
      },
    };

    if (onPayloadChange) {
      onPayloadChange(payload);
    }

    const saveRes = await saveBrief(payload, false);
    if (saveRes.data && !saveRes.error) {
      setSaveSuccessMsg(`Monstera Wall Art demo loaded & saved! (ID: ${saveRes.data.id})`);
      onValidated(
        saveRes.data.brief_report,
        saveRes.data.asset_report
          ? {
              is_valid: true,
              status: 'PASS',
              report: saveRes.data.asset_report,
              asset_metadata: saveRes.data.asset_result?.asset_metadata,
            }
          : null
      );
      if (typeof window !== 'undefined') {
        localStorage.setItem('alias_studio_brief_id', saveRes.data.id);
        localStorage.removeItem('alias_studio_job_id');
      }
      if (onPayloadChange) onPayloadChange(payload, saveRes.data.id);
      if (onSavedSuccess) onSavedSuccess(saveRes.data);
    } else {
      setValidationError(saveRes.error || 'Failed to save Monstera Wall Art brief.');
    }
    setLoadingDemo(false);
  };

  // Hydrate initialPayload if provided
  const [prevInitialPayload, setPrevInitialPayload] = useState(initialPayload);
  if (initialPayload !== prevInitialPayload) {
    setPrevInitialPayload(initialPayload);
    if (initialPayload) {
      if (initialPayload.product?.name) setProductName(initialPayload.product.name);
      if (initialPayload.product?.category) setCategory(initialPayload.product.category);
      if (initialPayload.product?.sku) setSku(initialPayload.product.sku);
      if (initialPayload.product?.offer?.price !== undefined) setPrice(String(initialPayload.product.offer.price));
      if (initialPayload.product?.offer?.original_price !== undefined) setOriginalPrice(String(initialPayload.product.offer.original_price));
      if (initialPayload.product?.offer?.currency) setCurrency(initialPayload.product.offer.currency);
      if (initialPayload.product?.offer?.discount_percent !== undefined) setDiscountPercent(String(initialPayload.product.offer.discount_percent));
      if (initialPayload.product?.offer?.promo_code) setPromoCode(initialPayload.product.offer.promo_code);
      if (initialPayload.product?.features) setFeatures(initialPayload.product.features);
      if (initialPayload.brand?.name) setBrandName(initialPayload.brand.name);
      if (initialPayload.brand?.logo_url) setLogoUrl(initialPayload.brand.logo_url);
      if (initialPayload.brand?.colors) setColors(initialPayload.brand.colors);
      if (initialPayload.brand?.font_family) setFontFamily(initialPayload.brand.font_family);
      if (initialPayload.campaign?.name) setCampaignName(initialPayload.campaign.name);
      if (initialPayload.campaign?.objective) setObjective(initialPayload.campaign.objective);
      if (initialPayload.campaign?.platforms) setPlatforms(initialPayload.campaign.platforms);
      if (initialPayload.campaign?.target_audience) setTargetAudience(initialPayload.campaign.target_audience);
      if (initialPayload.approved_claims) setApprovedClaims(initialPayload.approved_claims);
      if (initialPayload.copy?.headline) setHeadline(initialPayload.copy.headline);
      if (initialPayload.copy?.subheadline) setSubheadline(initialPayload.copy.subheadline);
      if (initialPayload.copy?.cta) setCta(initialPayload.copy.cta);
      if (initialPayload.images?.[0]?.url) setImageUrl(initialPayload.images[0].url);
    }
  }

  React.useEffect(() => {
    if (onPayloadChange && !savedBriefId) {
      onPayloadChange(constructPayload());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleValidateAsset = async () => {
    setValidatingAsset(true);
    setSaveSuccessMsg(null);
    setValidationError(null);
    const trimmedUrl = imageUrl.trim();
    if (!trimmedUrl) {
      setValidationError('Please provide a valid image URL before running Asset Gate.');
      setValidatingAsset(false);
      return;
    }
    const res = await validateAssetUrl(trimmedUrl, requireTransparency);
    if (res.data && (res.data.report || 'summary' in res.data)) {
      onValidated(undefined, res.data);
      if (onPayloadChange) {
        onPayloadChange(constructPayload(), savedBriefId);
      }
    } else if (res.error) {
      setValidationError(res.error);
    }
    setValidatingAsset(false);
  };

  const handleSaveAndValidateBrief = async () => {
    setSaving(true);
    setSaveSuccessMsg(null);
    setValidationError(null);
    const payload = constructPayload();
    if (onPayloadChange) {
      onPayloadChange(payload);
    }
    const res = await saveBrief(payload, requireTransparency);
    if (res.data && !res.error) {
      setIsDirty(false);
      setSaveSuccessMsg(`Ad Brief successfully validated & saved! (ID: ${res.data.id})`);
      onValidated(
        res.data.brief_report,
        res.data.asset_report
          ? {
              is_valid: true,
              status: 'PASS',
              report: res.data.asset_report,
              asset_metadata: res.data.asset_result?.asset_metadata,
            }
          : null
      );
      if (typeof window !== 'undefined') {
        localStorage.setItem('alias_studio_brief_id', res.data.id);
        localStorage.removeItem('alias_studio_job_id');
      }
      if (onPayloadChange) onPayloadChange(payload, res.data.id);
      if (onSavedSuccess) onSavedSuccess(res.data);
    } else {
      const detailObj = typeof res.data?.detail === 'object' ? res.data?.detail : undefined;
      const errMsg = res.error || detailObj?.message || (typeof res.data?.detail === 'string' ? res.data.detail : 'Ad brief rejected by validation gate.');
      setValidationError(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));

      const rep = detailObj?.report;
      const isAssetGate =
        detailObj?.gate_name === 'Asset Gate' ||
        rep?.gate_name === 'Asset Gate' ||
        (rep?.errors && rep.errors.some((e: string) => /alpha|transparency|format|resolution|image/i.test(e)));

      if (isAssetGate && rep) {
        onValidated(undefined, { is_valid: false, status: 'FAIL', report: rep });
      } else {
        onValidated(rep || null, undefined);
      }
    }
    setSaving(false);
  };

  const handleProceedToStrategy = async () => {
    const payload = constructPayload();
    const imageChanged = initialPayload && initialPayload.images?.[0]?.url !== imageUrl.trim();
    if (!savedBriefId || isDirty || imageChanged) {
      await handleSaveAndValidateBrief();
    } else if (onPayloadChange) {
      onPayloadChange(payload, savedBriefId);
    }
    if (onProceedToStrategy) {
      onProceedToStrategy();
    }
  };


  return (
    <div className="space-y-6">
      {/* Top Banner with Load Demo button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-white">Ad Brief Ingestion & Gate Studio</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Phase 2: Strict schema validation, offer bounds, and genuine asset inspection.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSelectIPhonePreset}
            disabled={loadingDemo}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition-all shrink-0 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <span>📱 iPhone 16 Demo</span>
          </button>
          <button
            type="button"
            onClick={handleSelectGreenPreset}
            disabled={loadingDemo}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-all shrink-0 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <span>🌿 Green Plant Demo</span>
          </button>
          <button
            type="button"
            onClick={handleLoadDemo}
            disabled={loadingDemo}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all shrink-0 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
            <span>SmartFit Watch</span>
          </button>
        </div>
      </div>

      {saveSuccessMsg && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center space-x-2 font-medium">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {validationError && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2 font-medium">
          <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* Form Grid */}
      <div className="space-y-6">
        {/* 1. Product & Offer Information */}
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
            <ShoppingBag className="h-4 w-4 text-indigo-400" />
            <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
              1. Product & Offer Details (Required)
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Product Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500 font-sans"
                placeholder="e.g. SmartFit X1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                placeholder="e.g. Smart Wearables"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">SKU / Model</label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                placeholder="e.g. SMARTFIT-X1"
              />
            </div>
          </div>

          {/* Pricing Row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Selling Price <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-emerald-400 font-mono focus:outline-none focus:border-indigo-500 font-bold"
                placeholder="4999"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Original Price</label>
              <input
                type="number"
                value={originalPrice}
                onChange={(e) => setOriginalPrice(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-400 font-mono focus:outline-none focus:border-indigo-500 line-through"
                placeholder="6499"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Currency</label>
              <input
                type="text"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                placeholder="BDT"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Discount %</label>
              <input
                type="number"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-amber-400 font-mono focus:outline-none focus:border-indigo-500 font-semibold"
                placeholder="23"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Promo Code</label>
              <input
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-indigo-300 font-mono focus:outline-none focus:border-indigo-500 uppercase"
                placeholder="FIT23"
              />
            </div>
          </div>

          {/* Features Tagging */}
          <div className="pt-2 space-y-2">
            <label className="text-xs font-medium text-slate-400 block">Product Features (Ground Truth)</label>
            <div className="flex flex-wrap gap-2">
              {features.map((f, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 text-xs border border-slate-700/60"
                >
                  <span>{f}</span>
                  <button
                    type="button"
                    onClick={() => removeFeature(idx)}
                    className="hover:text-rose-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex space-x-2 pt-1">
              <input
                type="text"
                value={newFeature}
                onChange={(e) => setNewFeature(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())}
                placeholder="Add a factual feature (e.g. 7-day battery life)"
                className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={addFeature}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* 2. Product Image & Asset Gate */}
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <ImageIcon className="h-4 w-4 text-indigo-400" />
              <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                2. Product Image Asset & Asset Gate (Required)
              </h4>
            </div>
            <label className="flex items-center space-x-2 text-xs text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={requireTransparency}
                onChange={(e) => {
                  const val = e.target.checked;
                  setRequireTransparency(val);
                  setValidationError(null);
                  const trimmed = imageUrl.trim();
                  if (trimmed) {
                    setValidatingAsset(true);
                    validateAssetUrl(trimmed, val).then((res) => {
                      if (res.data && (res.data.report || 'summary' in res.data)) {
                        onValidated(undefined, res.data);
                        if (onPayloadChange) {
                          onPayloadChange(constructPayload(), savedBriefId);
                        }
                      } else if (res.error) {
                        setValidationError(res.error);
                      }
                      setValidatingAsset(false);
                    });
                  }
                }}
                className="rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-0"
              />
              <span>Require Transparent Cutout</span>
            </label>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => {
                let val = e.target.value;
                // Auto-expand short relative demo paths for developer convenience
                if (val.trim() === 'iphone' || val.trim() === 'iphone.png' || val.trim() === 'demo/iphone.png') {
                  val = 'http://127.0.0.1:8000/api/v1/storage/demo/iphone.png';
                } else if (val.trim() === 'green' || val.trim() === 'green.png' || val.trim() === 'demo/green.png') {
                  val = 'http://127.0.0.1:8000/api/v1/storage/demo/green.png';
                } else if (val.trim() === 'watch' || val.trim() === 'smartfit' || val.trim() === 'smartfit_x1.png' || val.trim() === 'demo/smartfit_x1.png') {
                  val = 'http://127.0.0.1:8000/api/v1/storage/demo/smartfit_x1.png';
                }
                setImageUrl(val);
                setIsDirty(true);
                setValidationError(null);
                setSaveSuccessMsg(null);
                if (onPayloadChange) {
                  onPayloadChange({
                    ...constructPayload(),
                    images: [{ url: val.trim(), asset_type: 'primary_product', description: `${productName.trim() || 'Product'} primary product cutout` }]
                  });
                }
              }}
              className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
              placeholder="https://.../product_cutout.png or demo/iphone.png"
            />
            <button
              type="button"
              onClick={handleValidateAsset}
              disabled={validatingAsset || !imageUrl}
              className="px-4 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition-all shrink-0 disabled:opacity-50 cursor-pointer"
            >
              {validatingAsset ? 'Inspecting...' : 'Run Asset Gate'}
            </button>
          </div>

          {/* Quick Demo Asset Selector Pills */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="text-[11px] text-slate-500 font-medium">Quick Assets:</span>
            <button
              type="button"
              onClick={handleSelectIPhonePreset}
              disabled={loadingDemo}
              className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 text-[11px] transition-all cursor-pointer disabled:opacity-50"
            >
              📱 iPhone Cutout (Transparent)
            </button>
            <button
              type="button"
              onClick={handleSelectGreenPreset}
              disabled={loadingDemo}
              className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 border border-slate-700/80 text-[11px] transition-all cursor-pointer disabled:opacity-50"
            >
              🌿 Green Leaves (Opaque Background)
            </button>
            <button
              type="button"
              onClick={handleLoadDemo}
              disabled={loadingDemo}
              className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-indigo-200 border border-slate-700/80 text-[11px] transition-all cursor-pointer disabled:opacity-50"
            >
              ⌚ SmartFit X1 Watch (Default)
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            The Asset Gate downloads the image, checks file signatures (PNG/WebP), inspects resolution (&gt;=400px),
            calculates alpha transparency, and enforces strict SSRF protections against internal networks.
          </p>
        </div>

        {/* 3. Brand Information */}
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
            <Building className="h-4 w-4 text-indigo-400" />
            <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
              3. Brand Identity (Required Name, Optional Assets)
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Brand Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                placeholder="SmartFit"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Logo URL (Optional)</label>
              <input
                type="text"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                placeholder="https://.../logo.png"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Font Family</label>
              <input
                type="text"
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                placeholder="Inter"
              />
            </div>
          </div>

          {/* Color Palette Chips */}
          <div className="pt-2 space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-300 block">Brand Palette Definition</label>
              <p className="text-[11px] text-slate-500">
                Authoritative brand colors will be used across backgrounds, typography, and CTA buttons.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ColorPicker
                label="Primary Brand Color"
                value={colors[0] || '#2563EB'}
                onChange={(c) => {
                  const updated = [...colors];
                  updated[0] = c;
                  setColors(updated);
                }}
                brandColors={colors}
              />
              <ColorPicker
                label="Secondary / Dark Tone"
                value={colors[1] || '#111827'}
                onChange={(c) => {
                  const updated = [...colors];
                  updated[1] = c;
                  setColors(updated);
                }}
                brandColors={colors}
              />
              <ColorPicker
                label="Accent / Highlight"
                value={colors[2] || '#10B981'}
                onChange={(c) => {
                  const updated = [...colors];
                  updated[2] = c;
                  setColors(updated);
                }}
                brandColors={colors}
              />
            </div>
          </div>
        </div>

        {/* 4. Campaign Targeting & Platforms */}
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
            <Target className="h-4 w-4 text-indigo-400" />
            <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
              4. Campaign Objective & Platforms (Required)
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Campaign Name</label>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                placeholder="Q4 Fitness Push"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Advertising Objective</label>
              <select
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="product_sales">Product Sales</option>
                <option value="brand_awareness">Brand Awareness</option>
                <option value="lead_generation">Lead Generation</option>
                <option value="engagement">Engagement</option>
                <option value="traffic">Traffic</option>
              </select>
            </div>
          </div>

          {/* Platform Pills */}
          <div className="space-y-2 pt-1">
            <label className="text-xs font-medium text-slate-400 block">
              Target Platforms <span className="text-rose-400">*</span>
            </label>
            <div className="flex items-center gap-2">
              {[
                { id: 'instagram', label: 'Instagram (4:5)' },
                { id: 'facebook', label: 'Facebook (1:1)' },
                { id: 'linkedin', label: 'LinkedIn (1.91:1)' },
              ].map((p) => {
                const selected = platforms.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlatform(p.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      selected
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1">Target Audience</label>
            <input
              type="text"
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
              placeholder="e.g. Active professionals looking for daily fitness tracking"
            />
          </div>
        </div>

        {/* 5. Approved Claims & Copy Overrides */}
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
            <FileCheck className="h-4 w-4 text-indigo-400" />
            <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
              5. Approved Claims & Copy Directives
            </h4>
          </div>

          {/* Approved Claims */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-400 block">
              Approved Claims (The AI strategist cannot invent claims outside these)
            </label>
            <div className="flex flex-wrap gap-2">
              {approvedClaims.map((claim, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-800 text-slate-200 text-xs border border-slate-700/60"
                >
                  <span>{claim}</span>
                  <button type="button" onClick={() => removeClaim(idx)} className="hover:text-rose-400">
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex space-x-2 pt-1">
              <input
                type="text"
                value={newClaim}
                onChange={(e) => setNewClaim(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addClaim())}
                placeholder="Add approved claim (e.g. Water resistant to 50 meters)"
                className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={addClaim}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
              >
                Add Claim
              </button>
            </div>
          </div>

          {/* Copy Overrides */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Headline Override (Optional)</label>
              <input
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                placeholder="e.g. Track Every Move."
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Subheadline Override (Optional)</label>
              <input
                type="text"
                value={subheadline}
                onChange={(e) => setSubheadline(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                placeholder="e.g. 7-day battery life."
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Call-To-Action (CTA)</label>
              <input
                type="text"
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                placeholder="e.g. Shop Now"
              />
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="pt-2">
          {savedBriefId && !isDirty ? (
            /* Completed Stage UI (Rule 8) */
            <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30">
              <div className="flex items-center space-x-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                <div>
                  <span className="text-xs font-semibold text-white block">✓ Brief Validated & Saved ({productName})</span>
                  <span className="text-[11px] font-mono text-emerald-400/80">ID: {savedBriefId}</span>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={handleSaveAndValidateBrief}
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-all cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Updating...' : 'Update Brief'}
                </button>
                {onProceedToStrategy && (
                  <button
                    type="button"
                    onClick={handleProceedToStrategy}
                    className="inline-flex items-center space-x-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
                  >
                    <span>Proceed to Strategy (Step 2) →</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Authoritative Save & Validate Brief Primary Action */
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-xs text-amber-300 font-medium">
                {isDirty ? '⚠️ Unsaved brief changes. Save to update downstream pipeline with active product.' : 'Ready to validate and save.'}
              </div>
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={handleSaveAndValidateBrief}
                  disabled={saving || loadingDemo}
                  className="inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  <span>{saving ? 'Validating & Saving Brief...' : 'Save & Validate Brief'}</span>
                </button>
                {onProceedToStrategy && (
                  <button
                    type="button"
                    onClick={handleProceedToStrategy}
                    disabled={saving || loadingDemo}
                    className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/25 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <span>Save & Proceed to Strategy →</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
