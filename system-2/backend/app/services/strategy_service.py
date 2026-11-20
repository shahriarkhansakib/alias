from typing import Dict, Any, Optional, Tuple, List
from pydantic import ValidationError

from app.core.logging import logger
from app.schemas.brief import FinalAdBriefPayload
from app.schemas.strategy import (
    CreativeStrategySpec,
    ClaimValidationReport,
    ClaimAuditItem,
    CopyPolicyType,
)
from app.providers.base import LLMStrategyProvider
from app.providers.mock_providers import MockLLMStrategyProvider
from app.templates.registry import is_template_registered
from app.services.claim_validator import claim_validator_service


class StrategyService:
    """
    Orchestrates the Creative Strategy pipeline with deterministic claim validation,
    template verification, and bounded retry enforcement (max 3 attempts).
    """

    def __init__(self, default_provider: Optional[LLMStrategyProvider] = None):
        self.default_provider = default_provider or MockLLMStrategyProvider()

    async def generate_and_validate_strategy(
        self,
        brief: FinalAdBriefPayload,
        provider: Optional[LLMStrategyProvider] = None,
        max_retries: int = 3,
    ) -> Tuple[str, Optional[CreativeStrategySpec], ClaimValidationReport, int]:
        active_provider = provider or self.default_provider
        last_report: Optional[ClaimValidationReport] = None
        last_spec: Optional[CreativeStrategySpec] = None
        previous_feedback: Optional[str] = None

        for attempt in range(1, max_retries + 1):
            feedback_for_attempt = previous_feedback if attempt > 1 else None
            logger.info(
                f"Generating creative strategy: attempt {attempt}/{max_retries}, feedback: {feedback_for_attempt}"
            )

            try:
                raw_spec = await active_provider.generate_creative_strategy(
                    brief,
                    attempt=attempt,
                    feedback=feedback_for_attempt,
                )
                if isinstance(raw_spec, dict):
                    spec = CreativeStrategySpec.model_validate(raw_spec)
                else:
                    spec = raw_spec
            except (ValidationError, Exception) as e:
                clean_err = str(e)[:200]
                logger.warning(f"Strategy generation failed schema/provider check on attempt {attempt}: {clean_err}")
                last_report = ClaimValidationReport(
                    passed=False,
                    unsupported_claims=[f"Strategy output schema error: {clean_err}"],
                    summary=f"Strategy output failed schema validation: {clean_err}",
                )
                previous_feedback = f"Attempt {attempt} schema error: {clean_err}. Ensure all required fields and valid enums are provided."
                continue

            # 1. Template Registry Check
            if not is_template_registered(spec.template_id):
                err = f"Template '{spec.template_id}' is not in approved registry. Choose from: product_sale_dark, product_launch, minimal_feature."
                logger.warning(err)
                last_report = ClaimValidationReport(
                    passed=False,
                    unsupported_claims=[err],
                    summary=err,
                )
                last_spec = spec
                previous_feedback = f"Attempt {attempt} template error: {err}"
                continue

            # 2. Claim Gate Validation against Brief Ground Truth
            claim_report = claim_validator_service.validate_strategy_claims(brief, spec)
            last_report = claim_report
            last_spec = spec

            if claim_report.passed:
                logger.info(f"Creative strategy approved on attempt {attempt}.")
                return "APPROVED", spec, claim_report, attempt

            reasons = "; ".join(claim_report.unsupported_claims[:2])
            previous_feedback = f"Attempt {attempt} Claim Gate rejection: {reasons}. Ground all copy, prices, and features strictly in brief facts."
            logger.warning(
                f"Claim Gate rejected attempt {attempt}: {len(claim_report.unsupported_claims)} unsupported claims."
            )

        # Max retries exhausted
        logger.error(f"Strategy generation exhausted all {max_retries} attempts without passing validation.")
        return (
            "REJECTED",
            last_spec,
            last_report or ClaimValidationReport(passed=False, summary="All generation attempts failed validation."),
            max_retries,
        )

    def validate_existing_strategy(
        self,
        brief: FinalAdBriefPayload,
        strategy_dict: Dict[str, Any],
    ) -> Tuple[bool, Optional[CreativeStrategySpec], ClaimValidationReport, List[str]]:
        """
        Purely deterministic validation of an existing strategy payload
        without calling any AI provider.
        """
        schema_errors: List[str] = []

        try:
            spec = CreativeStrategySpec.model_validate(strategy_dict)
        except ValidationError as ve:
            for err in ve.errors():
                loc = " -> ".join(str(l) for l in err.get("loc", []))
                schema_errors.append(f"Field [{loc}]: {err.get('msg')}")

            fail_report = ClaimValidationReport(
                passed=False,
                unsupported_claims=schema_errors,
                summary=f"Strategy failed schema validation with {len(schema_errors)} error(s).",
            )
            return False, None, fail_report, schema_errors

        # Template Registry Check
        if not is_template_registered(spec.template_id):
            tmpl_err = f"Template '{spec.template_id}' is not registered."
            schema_errors.append(tmpl_err)
            fail_report = ClaimValidationReport(
                passed=False,
                unsupported_claims=[tmpl_err],
                summary=tmpl_err,
            )
            return False, spec, fail_report, schema_errors

        # Claim Gate Verification
        claim_report = claim_validator_service.validate_strategy_claims(brief, spec)
        is_valid = claim_report.passed and len(schema_errors) == 0

        return is_valid, spec, claim_report, schema_errors


strategy_service = StrategyService()
