import { describe, it, expect, beforeEach, vi } from "vitest";
import { Repository } from "@/lib/db/repo";

describe("Artifact-1: Client Campaign Brief Generation & Admin Review System", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Scenario 1: Normal Conversation -> AI extracts info, Artifact-1 is generated in READY_FOR_REVIEW
  it("Scenario 1: Normal Conversation - extracts info, populates 8 sections with provenance, and marks READY_FOR_REVIEW", async () => {
    const campId = "scenario_1_normal_conv_101";
    const intakeUpdates = {
      client: {
        company_name: "Qrew",
        industry: "B2B SaaS",
        website: "https://qrew.app",
        business_description: "Agency and team management software",
      },
      product_service: {
        name: "Workflow Suite",
        type: "B2B Software",
        price: 15000,
        description: "All-in-one agency operations platform",
      },
      campaign: {
        objective: "Lead Generation",
        desired_result: "Book 50 qualified software demos",
      },
      target_audience: {
        age_range: "25-45",
        location: "Dhaka, Bangladesh",
        description: "Founders, operations managers, and agency owners",
      },
      budget: {
        amount: 75000,
        currency: "BDT",
        type: "range",
      },
      timeline: {
        duration: "1 Month",
      },
    };

    const artifact = await Repository.upsertArtifact1(campId, intakeUpdates, undefined, {
      source: "client_stated",
    });

    expect(artifact).toBeDefined();
    expect(artifact.status).toBe("READY_FOR_REVIEW");
    expect(artifact.version).toBe(1);

    // Verify 8 Sections & Field Provenance
    expect(artifact.sections).toBeDefined();
    expect(artifact.sections.business_profile.company_name.value).toBe("Qrew");
    expect(artifact.sections.business_profile.company_name.source).toBe("client_stated");
    expect(artifact.sections.business_profile.company_name.confidence).toBe(1.0);

    expect(artifact.sections.product_offering.name.value).toBe("Workflow Suite");
    expect(artifact.sections.product_offering.pricing.value).toBe(15000);

    expect(artifact.sections.campaign_objectives.primary_objective.value).toBe("Lead Generation");
    expect(artifact.sections.target_audience.location.value).toBe("Dhaka, Bangladesh");
    expect(artifact.sections.budget_allocation.total_budget.value).toBe(75000);
    expect(artifact.sections.execution_timeline.duration.value).toBe("1 Month");

    // Legacy fields preserved for backward compatibility
    expect(artifact.client.company_name).toBe("Qrew");
    expect(artifact.product_service.name).toBe("Workflow Suite");
    expect(artifact.budget.amount).toBe(75000);
  });

  // Scenario 2: Missing Information -> displays "Not Provided" and does not invent values
  it("Scenario 2: Missing Information - keeps unprovided fields empty/null without inventing values", async () => {
    const campId = "scenario_2_missing_info_102";
    const partialUpdates = {
      client: {
        company_name: "TechFlow",
        industry: "Custom Software",
      },
      product_service: {
        name: "Inventory Tool",
      },
      campaign: {
        objective: "Direct Orders",
      },
    };

    const artifact = await Repository.upsertArtifact1(campId, partialUpdates, undefined, {
      source: "client_stated",
    });

    expect(artifact.sections.business_profile.website.value).toBe("");
    expect(artifact.sections.product_offering.pricing.value).toBeNull();
    expect(artifact.sections.budget_allocation.total_budget.value).toBeNull();
    expect(artifact.sections.execution_timeline.duration.value).toBe("");

    // Missing core requirements keeps it in DRAFT
    expect(artifact.status).toBe("DRAFT");
  });

  // Scenario 3: Client Correction -> updates field and retains audit history
  it("Scenario 3: Client Correction - updates previous value and stores revision", async () => {
    const campId = "scenario_3_client_corr_103";
    // Initial statement
    await Repository.upsertArtifact1(
      campId,
      {
        client: { company_name: "TechFlow" },
        budget: { amount: 30000, currency: "BDT", type: "exact" },
      },
      undefined,
      { source: "client_stated" }
    );

    let art = await Repository.getArtifact1(campId);
    expect(art.sections.budget_allocation.total_budget.value).toBe(30000);

    // Client corrects budget
    await Repository.upsertArtifact1(
      campId,
      {
        budget: { amount: 50000, currency: "BDT", type: "range" },
      },
      undefined,
      { source: "client_stated", reason: "Client corrected budget from 30k to 50k" }
    );

    art = await Repository.getArtifact1(campId);
    expect(art.sections.budget_allocation.total_budget.value).toBe(50000);
    expect(art.budget.amount).toBe(50000);
  });

  // Scenario 4: Admin Correction -> admin edits an artifact field, provenance changes to admin_provided
  it("Scenario 4: Admin Correction - changes persist with admin_provided provenance and confirmed verification status", async () => {
    const campId = "scenario_4_admin_corr_104";
    // Pre-populate with client data
    await Repository.upsertArtifact1(
      campId,
      {
        client: { company_name: "TechFlow", industry: "SaaS" },
      },
      "DRAFT",
      { source: "client_stated" }
    );

    const adminEdit = {
      sections: {
        business_profile: {
          website: {
            value: "https://techflow-bd.com",
            source: "admin_provided",
            confidence: 1.0,
            verification_status: "confirmed",
          },
        },
        product_offering: {
          pricing: {
            value: 25000,
            source: "admin_provided",
            confidence: 1.0,
            verification_status: "confirmed",
          },
        },
      },
    };

    const updated = await Repository.upsertArtifact1(campId, adminEdit, "READY_FOR_REVIEW", {
      source: "admin_provided",
      modifiedBy: "admin_user",
      reason: "Admin verified website and confirmed pricing tier",
    });

    expect(updated.sections.business_profile.website.value).toBe("https://techflow-bd.com");
    expect(updated.sections.business_profile.website.source).toBe("admin_provided");
    expect(updated.sections.business_profile.website.verification_status).toBe("confirmed");

    expect(updated.sections.product_offering.pricing.value).toBe(25000);
    expect(updated.sections.product_offering.pricing.source).toBe("admin_provided");

    // Legacy sync
    expect(updated.client.website).toBe("https://techflow-bd.com");
    expect(updated.product_service.price).toBe(25000);
  });

  // Scenario 5: Admin Confirmation -> preserves confirmed snapshot, downstream API returns confirmed version
  it("Scenario 5: Admin Confirmation - locks immutable snapshot and enables downstream handoff", async () => {
    const campId = "scenario_5_admin_confirm_105";
    // Provide complete core requirements
    await Repository.upsertArtifact1(
      campId,
      {
        client: { company_name: "TechFlow", industry: "SaaS", website: "https://techflow.io" },
        product_service: { name: "ERP Suite", type: "Software", price: 30000 },
        campaign: { objective: "Lead Gen", desired_result: "100 Demos" },
        target_audience: { age_range: "25-45", location: "Bangladesh", description: "B2B SMBs" },
        budget: { amount: 60000, currency: "BDT", type: "range" },
        timeline: { duration: "1 Month" },
      },
      "READY_FOR_REVIEW",
      { source: "client_stated" }
    );

    const confirmed = await Repository.confirmArtifact1(campId, "lead_marketing_admin");
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.metadata.confirmedBy).toBe("lead_marketing_admin");
    expect(confirmed.confirmedSnapshot).toBeDefined();
    expect(confirmed.confirmedSnapshot.status).toBe("CONFIRMED");
    expect(confirmed.confirmedSnapshot.sections.business_profile.company_name.value).toBe("TechFlow");

    // Downstream API retrieval
    const handoff = await Repository.getConfirmedClientBrief(campId);
    expect(handoff).not.toBeNull();
    expect(handoff?.status).toBe("CONFIRMED");
    expect(handoff?.structuredCampaignInformation.business_profile.company_name.value).toBe("TechFlow");
    expect(handoff?.confirmationMetadata.confirmedBy).toBe("lead_marketing_admin");
  });

  // Scenario 6: Unauthorized Access & Safety Boundary -> unconfirmed artifacts cannot be retrieved as downstream-ready
  it("Scenario 6: Safety Boundary - unconfirmed artifacts are rejected by the downstream handoff API", async () => {
    const unconfirmedId = "scenario_6_unconfirmed_106";
    await Repository.upsertArtifact1(
      unconfirmedId,
      {
        client: { company_name: "DraftCorp" },
      },
      "DRAFT",
      { source: "client_stated" }
    );

    const downstream = await Repository.getConfirmedClientBrief(unconfirmedId);
    expect(downstream).toBeNull();
  });

  // Scenario 7: Post-Confirmation Client Update -> preserves locked snapshot, bumps version, and transitions to review
  it("Scenario 7: Post-Confirmation Client Update - preserves locked snapshot, bumps version, and transitions to review", async () => {
    const campId = "scenario_7_post_confirm_107";
    // Pre-populate & confirm
    await Repository.upsertArtifact1(
      campId,
      {
        client: { company_name: "AlphaBrand", industry: "Apparel" },
        product_service: { name: "Oversized Tee", price: 1200 },
        campaign: { objective: "Sales", desired_result: "500 Orders" },
        target_audience: { age_range: "18-28", location: "Nationwide", description: "Youth" },
        budget: { amount: 50000, currency: "BDT", type: "range" },
        timeline: { duration: "1 Month" },
      },
      "READY_FOR_REVIEW",
      { source: "client_stated" }
    );
    await Repository.confirmArtifact1(campId, "lead_admin");

    const confirmedBrief = await Repository.getConfirmedClientBrief(campId);
    expect(confirmedBrief).not.toBeNull();
    const initialVersion = confirmedBrief?.version;

    // Client corrects timeline after confirmation
    await Repository.upsertArtifact1(
      campId,
      {
        timeline: { duration: "3 Months" },
      },
      undefined,
      { source: "client_stated", reason: "Client extended campaign duration" }
    );

    const updated = await Repository.getArtifact1(campId);
    expect(updated.version).toBe(initialVersion + 1);
    expect(updated.status).toBe("READY_FOR_REVIEW");

    // The frozen snapshot remains untouched
    expect(updated.confirmedSnapshot).toBeDefined();
    expect(updated.confirmedSnapshot.version).toBe(initialVersion);
    expect(updated.confirmedSnapshot.sections.execution_timeline.duration.value).toBe("1 Month");

    // The working draft reflects the new 3-month duration
    expect(updated.sections.execution_timeline.duration.value).toBe("3 Months");
  });

  it("Scenario 8: Admin Request Clarification - marks field verification_status and transitions to NEEDS_CLARIFICATION", async () => {
    const campId = "scenario_8_clarification_108";
    await Repository.upsertArtifact1(
      campId,
      {
        client: { company_name: "BetaTech" },
        product_service: { name: "BetaApp" },
      },
      "READY_FOR_REVIEW",
      { source: "client_stated" }
    );

    const art = await Repository.requestArtifact1Clarification(
      campId,
      "product_offering",
      "pricing",
      "Need specific tier pricing for custom implementation",
      "admin"
    );

    expect(art.status).toBe("NEEDS_CLARIFICATION");
    expect(art.sections.product_offering.pricing.verification_status).toBe("needs_clarification");
  });
});
