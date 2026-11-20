import re
from typing import Dict, Any, List, Set, Tuple, Optional
from app.schemas.brief import FinalAdBriefPayload
from app.schemas.strategy import (
    CreativeStrategySpec,
    ClaimValidationReport,
    ClaimAuditItem,
    CopyPolicyType,
)

# Regex patterns for quantitative specifications
DAYS_REGEX = re.compile(r"\b(\d+)\s*(?:-day|day|days)\b", re.IGNORECASE)
PERCENT_REGEX = re.compile(r"\b(\d+(?:\.\d+)?)\s*%", re.IGNORECASE)
WATER_DEPTH_REGEX = re.compile(r"\b(\d+)\s*(?:m|meter|meters|atm)\b", re.IGNORECASE)

# Improved Monetary Detection Regex
# 1. Explicit currency code or symbol attached: "$4999", "4999 BDT", "৳ 4,999", "USD 4999"
MONETARY_EXPLICIT_REGEX = re.compile(
    r"(?:[$৳€£]|USD|BDT|EUR|INR|Tk)\s*(\d+(?:,\d{3})*(?:\.\d+)?)\b|\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:[$৳€£]|USD|BDT|EUR|INR|Tk)",
    re.IGNORECASE,
)
# 2. Contextual price words: "price: 4999", "for only 4999", "pay 4999"
MONETARY_CONTEXTUAL_REGEX = re.compile(
    r"\b(?:price(?:\s*is|\s*:)?|for\s*only|only|cost(?:s)?|pay|for\s*just|at\s*only)\s+[$৳€£]?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\b",
    re.IGNORECASE,
)

# Non-monetary patterns to avoid false-positive price flags
YEAR_REGEX = re.compile(r"\b(19\d\d|20\d\d)\b", re.IGNORECASE)
VERSION_REGEX = re.compile(r"\b(?:version|v|ver\.?)\s*(\d+(?:\.\d+)?)\b", re.IGNORECASE)
MODEL_ALPHANUM_REGEX = re.compile(r"\b[A-Za-z]+[-_]?(\d+)\b", re.IGNORECASE)

# Forbidden claim categories unless explicitly grounded in approved claims or features
PROHIBITED_CATEGORIES = {
    "UNSUPPORTED_CERTIFICATION": [
        "fda approved",
        "fda certified",
        "ce certified",
        "iso certified",
        "nasa certified",
        "clinically proven",
        "doctor recommended",
        "medically certified",
        "certified medical",
        "medical grade",
        "military certified",
    ],
    "UNSUPPORTED_AWARD": [
        "award-winning",
        "award winning",
        "voted #1",
        "best in class",
        "#1 rated",
        "rated #1",
        "top rated",
        "winner of",
    ],
    "UNSUPPORTED_GUARANTEE": [
        "money back guarantee",
        "money-back guarantee",
        "100% guaranteed",
        "lifetime warranty",
        "unconditional warranty",
        "lifetime unconditional warranty",
        "risk free",
        "risk-free",
        "unconditional guarantee",
    ],
    "UNSUPPORTED_MEDICAL_CLAIM": [
        "cures",
        "cure",
        "prevents heart attack",
        "prevents disease",
        "treats disease",
        "medical diagnosis",
        "detects cancer",
        "eliminates pain",
    ],
    "UNSUPPORTED_STATISTIC": [
        "10,000+ customers",
        "50,000 runners",
        "50,000+ runners",
        "100,000+ users",
        "million users",
        "1m+ users",
        "5-star rated",
        "5 stars across",
        "trusted by",
    ],
    "UNSUPPORTED_COMPARISON": [
        "better than apple",
        "beats garmin",
        "cheaper than samsung",
        "fastest on the market",
        "outperforms",
        "faster than leading competitor",
        "outperforms all",
        "superior to competitor",
    ],
}

# Qualitative Factual Assertion Patterns
# Statements asserting physical materials, technological components, durability, or compatibility
FEATURE_ASSERTION_PATTERNS = [
    re.compile(
        r"\b(aerospace-grade|titanium|carbon\s*fiber|aluminum|sapphire(?:\s*crystal)?|ceramic|gorilla\s*glass|stainless\s*steel)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(solar\s*charging(?:\s*technology)?|satellite(?:\s*calling|\s*networks?)?|cellular|military-grade\s*sensors?|laser|dual-frequency|ecg|blood\s*oxygen|radar|sonar|emergency\s*satellite)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(mil-std|drop-proof|military-grade\s*drop|shatter-proof|indestructible|bulletproof|sub-millimeter(?:\s*precision)?|zero-latency|100%\s*waterproof)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(compatible\s*with\s*(?:all\s+devices|all\s+networks|all\s+satellite\s+networks|satellite|android|ios|apple|samsung))\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:built\s*with|crafted\s*from|made\s*of|engineered\s*with|powered\s*by|equipped\s*with|features|featuring|includes|embedded\s*with)\s+([a-zA-Z0-9\-\s]{3,30})",
        re.IGNORECASE,
    ),
]


class ClaimValidatorService:
    """
    Authoritative deterministic validator that enforces the Final Ad Brief
    as the sole source of truth. Programmatically detects hallucinations,
    invented discounts/prices, false specifications, and prohibited claims.
    """

    def validate_strategy_claims(
        self,
        brief: FinalAdBriefPayload,
        strategy: CreativeStrategySpec,
    ) -> ClaimValidationReport:
        unsupported_claims: List[str] = []
        supported_facts: List[str] = []
        creative_flourishes: List[str] = []
        claims_audit: List[ClaimAuditItem] = []

        # 1. Build authoritative ground-truth corpus from the brief
        ground_truth_text = self._build_ground_truth_corpus(brief)
        ground_truth_lower = ground_truth_text.lower()

        # Extract brief pricing and discounts
        brief_price = brief.product.offer.price
        brief_orig_price = brief.product.offer.original_price
        brief_discount = brief.product.offer.discount_percent

        # 2. Evaluate Copy Segments (headline, subheadline, offer_mention, cta)
        copy_segments: List[Tuple[str, str, CopyPolicyType]] = [
            ("Headline", strategy.copy_spec.headline, strategy.copy_spec.headline_policy),
            ("Subheadline", strategy.copy_spec.subheadline, strategy.copy_spec.subheadline_policy),
            ("CTA", strategy.copy_spec.cta, strategy.copy_spec.cta_policy),
        ]
        if strategy.copy_spec.offer_mention:
            copy_segments.append(
                ("Offer Mention", strategy.copy_spec.offer_mention, CopyPolicyType.FACTUAL)
            )

        full_copy_text = " ".join([seg[1] for seg in copy_segments if seg[1]])
        full_copy_lower = full_copy_text.lower()

        # 3. Check Prohibited / Unsubstantiated Claim Categories
        for cat_name, phrases in PROHIBITED_CATEGORIES.items():
            for phrase in phrases:
                if phrase in full_copy_lower and phrase not in ground_truth_lower:
                    err_msg = f"Hallucinated claim detected ({cat_name}): '{phrase}' is not supported by the brief."
                    unsupported_claims.append(err_msg)
                    claims_audit.append(
                        ClaimAuditItem(
                            text_segment=phrase,
                            classification=CopyPolicyType.AI_GENERATED_CREATIVE,
                            is_supported=False,
                            reason=err_msg,
                        )
                    )

        # 4. Check Quantitative Battery Days
        copy_battery_days = DAYS_REGEX.findall(full_copy_text)
        brief_battery_days = set(DAYS_REGEX.findall(ground_truth_text))
        for num_str in copy_battery_days:
            if num_str not in brief_battery_days:
                err_msg = (
                    f"Hallucinated specification: Strategy mentions '{num_str}-day', "
                    f"but brief only supports {sorted(list(brief_battery_days))} days."
                )
                unsupported_claims.append(err_msg)
                claims_audit.append(
                    ClaimAuditItem(
                        text_segment=f"{num_str}-day",
                        classification=CopyPolicyType.FACTUAL,
                        is_supported=False,
                        reason=err_msg,
                    )
                )

        # 5. Check Water Depth / ATM
        copy_water_specs = WATER_DEPTH_REGEX.findall(full_copy_text)
        brief_water_specs = set(WATER_DEPTH_REGEX.findall(ground_truth_text))
        for spec in copy_water_specs:
            if spec not in brief_water_specs:
                err_msg = (
                    f"Hallucinated water resistance: Strategy mentions '{spec}', "
                    f"which is not found in brief features: {sorted(list(brief_water_specs))}."
                )
                unsupported_claims.append(err_msg)
                claims_audit.append(
                    ClaimAuditItem(
                        text_segment=spec,
                        classification=CopyPolicyType.FACTUAL,
                        is_supported=False,
                        reason=err_msg,
                    )
                )

        # 6. Check Numeric Prices (Improved Regex & False-Positive Immunity)
        price_check_passed = True
        extracted_prices = self._extract_monetary_values(full_copy_text)

        valid_prices = [brief_price]
        if brief_orig_price is not None:
            valid_prices.append(brief_orig_price)

        for price_val in extracted_prices:
            if not any(abs(price_val - vp) < 0.01 for vp in valid_prices):
                price_check_passed = False
                err_msg = (
                    f"Price mismatch: Strategy mentions price '{price_val}', "
                    f"which conflicts with brief selling price ({brief_price}) "
                    f"or original price ({brief_orig_price})."
                )
                unsupported_claims.append(err_msg)
                claims_audit.append(
                    ClaimAuditItem(
                        text_segment=str(price_val),
                        classification=CopyPolicyType.FACTUAL,
                        is_supported=False,
                        reason=err_msg,
                    )
                )

        # 7. Check Discount Percentages
        discount_check_passed = True
        discount_matches = PERCENT_REGEX.findall(full_copy_text)
        for disc_str in discount_matches:
            try:
                disc_num = float(disc_str)
                valid_discounts = []
                if brief_discount is not None:
                    valid_discounts.append(brief_discount)
                if brief_orig_price and brief_price:
                    calc_discount = round(((brief_orig_price - brief_price) / brief_orig_price) * 100, 1)
                    valid_discounts.append(calc_discount)

                if not any(abs(disc_num - vd) < 1.0 for vd in valid_discounts):
                    discount_check_passed = False
                    err_msg = (
                        f"Discount mismatch: Strategy mentions '{disc_num}%', "
                        f"which conflicts with brief discount ({brief_discount}%)."
                    )
                    unsupported_claims.append(err_msg)
                    claims_audit.append(
                        ClaimAuditItem(
                            text_segment=f"{disc_num}%",
                            classification=CopyPolicyType.FACTUAL,
                            is_supported=False,
                            reason=err_msg,
                        )
                    )
            except ValueError:
                pass

        # 8. Conservative Copy Policy & Qualitative Feature Assertion Auditing
        for label, text, policy in copy_segments:
            if not text:
                continue

            text_lower = text.lower()
            is_offer_segment = (label == "Offer Mention")

            # Check if text segment directly reflects brief claims or features
            is_brief_fact = self._is_grounded_in_brief(text_lower, brief, is_offer=is_offer_segment)
            is_user_copy = self._is_user_brief_copy(text, brief)

            if policy == CopyPolicyType.USER_PROVIDED:
                if is_user_copy:
                    claims_audit.append(
                        ClaimAuditItem(
                            text_segment=f"{label}: {text}",
                            classification=CopyPolicyType.USER_PROVIDED,
                            is_supported=True,
                            source_reference="User Brief Copy",
                        )
                    )
                    supported_facts.append(f"{label} (User Provided): {text}")
                else:
                    err_msg = f"User copy policy violation: '{text}' was marked as USER_PROVIDED but does not exist in the submitted brief."
                    unsupported_claims.append(err_msg)
                    claims_audit.append(
                        ClaimAuditItem(
                            text_segment=f"{label}: {text}",
                            classification=CopyPolicyType.USER_PROVIDED,
                            is_supported=False,
                            reason=err_msg,
                        )
                    )

            elif policy == CopyPolicyType.FACTUAL:
                if is_brief_fact or is_user_copy:
                    ref_source = "Brief Product Offer" if is_offer_segment else "Approved Brief Claims"
                    claims_audit.append(
                        ClaimAuditItem(
                            text_segment=f"{label}: {text}",
                            classification=CopyPolicyType.FACTUAL,
                            is_supported=True,
                            source_reference=ref_source,
                        )
                    )
                    supported_facts.append(f"{label} (Factual): {text}")
                else:
                    err_msg = f"Factual policy violation: '{text}' was marked as FACTUAL but does not match any approved brief claim or feature."
                    unsupported_claims.append(err_msg)
                    claims_audit.append(
                        ClaimAuditItem(
                            text_segment=f"{label}: {text}",
                            classification=CopyPolicyType.FACTUAL,
                            is_supported=False,
                            reason=err_msg,
                        )
                    )

            elif policy == CopyPolicyType.AI_GENERATED_CREATIVE:
                # Creative copy must remain non-factual language.
                # Check for invented qualitative feature, material, technology, durability, or compatibility assertions
                detected_assertion = self._detect_unsupported_factual_assertion(text, ground_truth_lower)
                if detected_assertion:
                    err_msg = (
                        f"AI Creative Copy violation: '{label}' introduces an ungrounded factual assertion: "
                        f"'{detected_assertion}'. AI creative copy must remain non-factual creative language."
                    )
                    unsupported_claims.append(err_msg)
                    claims_audit.append(
                        ClaimAuditItem(
                            text_segment=f"{label}: {text}",
                            classification=CopyPolicyType.AI_GENERATED_CREATIVE,
                            is_supported=False,
                            reason=err_msg,
                        )
                    )
                else:
                    claims_audit.append(
                        ClaimAuditItem(
                            text_segment=f"{label}: {text}",
                            classification=CopyPolicyType.AI_GENERATED_CREATIVE,
                            is_supported=True,
                            source_reference="Creative Art Direction",
                        )
                    )
                    creative_flourishes.append(f"{label} (Creative): {text}")

        # Final Verdict
        passed = len(unsupported_claims) == 0 and price_check_passed and discount_check_passed

        summary = (
            "Claim Gate passed: All facts, prices, and specifications are fully supported by the brief."
            if passed
            else f"Claim Gate rejected strategy with {len(unsupported_claims)} unsupported or conflicting claim(s)."
        )

        return ClaimValidationReport(
            passed=passed,
            supported_facts=supported_facts,
            creative_flourishes=creative_flourishes,
            unsupported_claims=unsupported_claims,
            price_check_passed=price_check_passed,
            discount_check_passed=discount_check_passed,
            claims_audit=claims_audit,
            summary=summary,
        )

    def _extract_monetary_values(self, text: str) -> List[float]:
        """
        Extracts genuine monetary values while filtering out years, version numbers,
        model numbers (like X1), and metric quantities.
        """
        found_prices: List[float] = []

        # 1. Explicit currency symbols/codes: "$4999", "4999 BDT"
        for match in MONETARY_EXPLICIT_REGEX.finditer(text):
            val_str = (match.group(1) or match.group(2)).replace(",", "")
            try:
                num = float(val_str)
                found_prices.append(num)
            except ValueError:
                pass

        # 2. Contextual monetary triggers: "only 4999", "price: 4999"
        for match in MONETARY_CONTEXTUAL_REGEX.finditer(text):
            val_str = match.group(1).replace(",", "")
            try:
                num = float(val_str)
                start_idx = match.start(1)
                end_idx = match.end(1)
                sub_around = text[max(0, start_idx - 10) : min(len(text), end_idx + 15)].lower()
                if "edition" in sub_around or "series" in sub_around or "model" in sub_around:
                    continue
                if num not in found_prices:
                    found_prices.append(num)
            except ValueError:
                pass

        return found_prices

    def _detect_unsupported_factual_assertion(self, text: str, ground_truth_lower: str) -> Optional[str]:
        """
        Detects if a statement contains an assertive factual claim (materials, technologies,
        capabilities, durability, compatibility) that is not supported by the brief.
        """
        text_lower = text.lower()

        for pattern in FEATURE_ASSERTION_PATTERNS:
            match = pattern.search(text_lower)
            if match:
                matched_phrase = match.group(0).strip()
                if matched_phrase not in ground_truth_lower:
                    if match.groups() and match.group(1):
                        entity = match.group(1).strip()
                        if entity not in ground_truth_lower:
                            return matched_phrase
                    else:
                        return matched_phrase

        return None

    def _is_grounded_in_brief(self, text_lower: str, brief: FinalAdBriefPayload, is_offer: bool = False) -> bool:
        """
        Checks if text segment is grounded in brief features, claims, product info, or offer.
        """
        clean_text = text_lower.replace(",", "")
        brief_p = str(int(brief.product.offer.price))
        brief_p_comma = f"{int(brief.product.offer.price):,}"

        if is_offer:
            if brief_p in clean_text or brief_p_comma in text_lower:
                return True
            if brief.product.offer.discount_percent and f"{int(brief.product.offer.discount_percent)}%" in text_lower:
                return True
            if brief.product.offer.original_price:
                orig_p = str(int(brief.product.offer.original_price))
                orig_p_comma = f"{int(brief.product.offer.original_price):,}"
                if orig_p in clean_text or orig_p_comma in text_lower:
                    return True
            return False

        all_brief_claims = [c.lower() for c in brief.approved_claims + brief.product.features]
        for claim in all_brief_claims:
            if claim in text_lower or text_lower in claim:
                return True

        if brief.product.name.lower() in text_lower or brief.brand.name.lower() in text_lower:
            return True

        if brief_p in clean_text or brief_p_comma in text_lower:
            return True

        return False



    def _is_user_brief_copy(self, text: str, brief: FinalAdBriefPayload) -> bool:
        if not brief.ad_copy:
            return False
        return bool(
            (brief.ad_copy.headline and brief.ad_copy.headline in text) or
            (brief.ad_copy.subheadline and brief.ad_copy.subheadline in text) or
            (brief.ad_copy.cta and brief.ad_copy.cta in text)
        )

    def _build_ground_truth_corpus(self, brief: FinalAdBriefPayload) -> str:
        parts = [
            brief.brand.name,
            brief.product.name,
            brief.product.category or "",
            brief.product.sku or "",
            str(brief.product.offer.price),
            str(brief.product.offer.original_price or ""),
            str(brief.product.offer.discount_percent or ""),
            brief.product.offer.promo_code or "",
            brief.campaign.target_audience or "",
        ]
        parts.extend(brief.product.features)
        parts.extend(brief.approved_claims)
        if brief.ad_copy:
            if brief.ad_copy.headline:
                parts.append(brief.ad_copy.headline)
            if brief.ad_copy.subheadline:
                parts.append(brief.ad_copy.subheadline)
            if brief.ad_copy.cta:
                parts.append(brief.ad_copy.cta)
        return " ".join([p for p in parts if p])


claim_validator_service = ClaimValidatorService()
