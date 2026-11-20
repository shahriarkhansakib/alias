export interface SafetyEvaluationResult {
  passed: boolean;
  flags: string[];
  reasons: string[];
}

export class CommunicationSafetyGuard {
  /**
   * Deterministic keyword, token, and regex patterns for financial,
   * refund, payment gateway, and legal liability commitments.
   */
  private static readonly FINANCIAL_PATTERNS = [
    /\b\d+\s*(?:bdt|taka|tk|usd|\$)\b/i,
    /(?:৳|\$)\s*\d+/i,
    /\b(?:\d+)\s*%/i,
    /\b(?:discount|price|pricing|charge|cost|rate|fee)\s+(?:of|is|will\s+be|starts?\s+at)\s+[0-9]+/i,
    /\b(?:flat\s+rate|special\s+price|exclusive\s+discount|cashback)\b/i,
  ];

  private static readonly REFUND_PATTERNS = [
    /\b(?:refund|money\s+back|return\s+your\s+money|reimburse|cancel\s+without\s+charge)\b/i,
    /\b(?:guaranteed\s+return|full\s+refund|compensation)\b/i,
  ];

  private static readonly PAYMENT_ACCOUNT_PATTERNS = [
    /\b(?:bkash|nagad|rocket|upay|cellfin)\s*(?:number|account|wallet|no\.?)?\s*[:\-]?\s*01[3-9]\d{8}\b/i,
    /\b(?:bank\s+account|routing\s+number|swift\s+code|iban|card\s+number)\b/i,
  ];

  private static readonly LEGAL_LIABILITY_PATTERNS = [
    /\b(?:we\s+guarantee|100%\s+guaranteed|legally\s+binding|we\s+promise\s+that|we\s+assume\s+liability)\b/i,
    /\b(?:contractual\s+obligation|legal\s+warranty|indemnif)/i,
  ];

  /**
   * 3-Layer Conservative Safety Evaluation
   */
  static evaluate(
    proposedText: string,
    aiMeta?: {
      confidenceScore?: number;
      isAmbiguous?: boolean;
      containsCommitment?: boolean;
      missingContext?: boolean;
    }
  ): SafetyEvaluationResult {
    const flags: string[] = [];
    const reasons: string[] = [];

    if (!proposedText || proposedText.trim().length < 5) {
      return {
        passed: false,
        flags: ["EMPTY_OR_TRIVIAL"],
        reasons: ["Proposed reply text is empty or too short."],
      };
    }

    const text = proposedText.toLowerCase();

    // Layer 1: Deterministic Policy Rules
    for (const pattern of this.FINANCIAL_PATTERNS) {
      if (pattern.test(text)) {
        flags.push("PRICING_OR_FINANCIAL_COMMITMENT");
        reasons.push("Contains explicit pricing figures, discounts, or financial commitments.");
        break;
      }
    }

    for (const pattern of this.REFUND_PATTERNS) {
      if (pattern.test(text)) {
        flags.push("REFUND_OR_CANCELLATION_COMMITMENT");
        reasons.push("Contains refund, money-back, or cancellation promises.");
        break;
      }
    }

    for (const pattern of this.PAYMENT_ACCOUNT_PATTERNS) {
      if (pattern.test(text)) {
        flags.push("PAYMENT_ACCOUNT_DETAILS");
        reasons.push("Contains mobile wallet, bank account, or routing numbers.");
        break;
      }
    }

    for (const pattern of this.LEGAL_LIABILITY_PATTERNS) {
      if (pattern.test(text)) {
        flags.push("LEGAL_OR_WARRANTY_LIABILITY");
        reasons.push("Contains formal legal guarantees, warranties, or liability promises.");
        break;
      }
    }

    // Layer 2: LLM Intent & Confidence Gate
    if (aiMeta) {
      if (typeof aiMeta.confidenceScore === "number" && aiMeta.confidenceScore < 0.85) {
        flags.push("LOW_AI_CONFIDENCE");
        reasons.push(`AI confidence score (${aiMeta.confidenceScore}) is below the required 0.85 threshold.`);
      }

      if (aiMeta.isAmbiguous) {
        flags.push("AMBIGUOUS_INQUIRY");
        reasons.push("The client inquiry was flagged as ambiguous or requiring clarification.");
      }

      if (aiMeta.containsCommitment) {
        flags.push("AI_FLAGGED_COMMITMENT");
        reasons.push("The AI detected an implicit operational or budget commitment.");
      }

      // Layer 3: Missing Context Gate
      if (aiMeta.missingContext) {
        flags.push("MISSING_FACTUAL_CONTEXT");
        reasons.push("Answering requires business facts that are not present in confirmed campaign artifacts.");
      }
    }

    return {
      passed: flags.length === 0,
      flags,
      reasons,
    };
  }
}
