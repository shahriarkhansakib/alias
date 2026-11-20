import { describe, it, expect } from "vitest";
import { ConsultantQuestionGenerator } from "./consultant-questions";

describe("ConsultantQuestionGenerator - Senior Marketing Consultant Questions for Incomplete Fields", () => {
  it("Generates senior marketing consultant question for Target Audience matching user example", () => {
    const q = ConsultantQuestionGenerator.generateQuestion({
      fieldKey: "target_audience",
      fieldLabel: "Target Audience",
      companyName: "Jersey Camp BD",
      industry: "Sports Apparel",
    });

    expect(q).toContain("To make sure we’re spending your budget on the right people");
    expect(q).toContain("describe your ideal customer");
    expect(q).toContain("age range");
    expect(q).toContain("location");
    expect(q).toContain("best existing");
    expect(q).toContain("Jersey Camp BD");
  });

  it("Generates senior consultant question for incomplete Website field", () => {
    const q = ConsultantQuestionGenerator.generateQuestion({
      fieldKey: "website",
      fieldLabel: "Website",
      companyName: "Jersey Camp BD",
      industry: "Sports Apparel",
    });

    expect(q).toContain("digital presence");
    expect(q).toContain("active website or online store");
    expect(q).toContain("Facebook Messenger");
    expect(q).toContain("Jersey Camp BD");
  });

  it("Generates senior consultant question for incomplete Price field", () => {
    const q = ConsultantQuestionGenerator.generateQuestion({
      fieldKey: "price",
      fieldLabel: "Price",
      companyName: "Jersey Camp BD",
      industry: "Sports Apparel",
    });

    expect(q).toContain("Return on Ad Spend");
    expect(q).toContain("price range");
    expect(q).toContain("average order value");
    expect(q).toContain("Jersey Camp BD");
  });

  it("Generates senior consultant question for Campaign Objective", () => {
    const q = ConsultantQuestionGenerator.generateQuestion({
      fieldKey: "objective",
      fieldLabel: "Objective",
      companyName: "TechFlow",
      industry: "Software",
    });

    expect(q).toContain("commercial goals");
    expect(q).toContain("primary objective");
    expect(q).toContain("online sales");
    expect(q).toContain("leads");
  });

  it("Generates senior consultant question for Budget", () => {
    const q = ConsultantQuestionGenerator.generateQuestion({
      fieldKey: "budget",
      fieldLabel: "Budget",
      companyName: "Jersey Camp BD",
    });

    expect(q).toContain("media plan");
    expect(q).toContain("advertising budget");
    expect(q).toContain("recommendation");
  });

  it("Generates senior consultant question for Timeline Duration", () => {
    const q = ConsultantQuestionGenerator.generateQuestion({
      fieldKey: "duration",
      fieldLabel: "Duration",
      companyName: "Jersey Camp BD",
    });

    expect(q).toContain("campaign phases");
    expect(q).toContain("timeline");
    expect(q).toContain("testing");
  });

  it("Correctly maps section path for manual artifact updates", () => {
    expect(ConsultantQuestionGenerator.getSectionPath("website", "Website")).toEqual({
      section: "client",
      field: "website",
    });
    expect(ConsultantQuestionGenerator.getSectionPath("price", "Price")).toEqual({
      section: "product_service",
      field: "price",
    });
    expect(ConsultantQuestionGenerator.getSectionPath("objective", "Objective")).toEqual({
      section: "campaign",
      field: "objective",
    });
  });
});
