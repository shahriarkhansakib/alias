import { describe, it, expect, beforeEach, vi } from "vitest";
import { AdminCommunicationAgent } from "@/lib/ai/admin-communication-agent";

describe("Cross-Industry Senior Marketing Consultant AI Engine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.ALLOW_DEMO_AUTH;
    delete process.env.ALLOW_INSECURE_NON_TRANSACTIONAL_FALLBACK;
  });

  // ==========================================
  // 1. SPORTS APPAREL
  // ==========================================
  describe("Scenario 1: Sports Apparel", () => {
    it("adapts strategy to athletic performance gear, community loyalty, and online sales", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "Velocity Sportswear (Sports Apparel)",
        clientName: "Nafis",
        businessName: "Velocity Sportswear",
        recentMessages: [{ sender: "client", content: "Velocity Sportswear (Sports Apparel)" }],
      });

      expect(res.intentCategory).toBe("Business & Brand Intake");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toContain("Velocity Sportswear");
      expect(professional).toMatch(/sportswear|athletic gear|direct online sales|brand awareness/i);
      expect(friendly).toMatch(/sportswear|athletic|standout/i);
      expect(detailed).toMatch(/funnel|athletes|Meta/i);
    });

    it("handles skepticism from failed past sports apparel ad campaigns", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "We spent 50k on Facebook ads for our gym jerseys with another agency and it was a complete waste of money.",
        clientName: "Nafis",
        businessName: "Velocity Sportswear",
        recentMessages: [
          { sender: "client", content: "We spent 50k on Facebook ads for our gym jerseys with another agency and it was a complete waste of money." },
        ],
      });

      expect(res.intentCategory).toBe("Client Objection & Skepticism");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toMatch(/testing|methodology|de-risk/i);
      expect(friendly).toMatch(/gamble|profitable|test/i);
      expect(detailed).toMatch(/risk|testing budgets|protocol/i);
    });
  });

  // ==========================================
  // 2. B2B SAAS
  // ==========================================
  describe("Scenario 2: B2B SaaS", () => {
    it("understands SaaS business models, product demo bookings, and sales pipelines", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "CloudPulse (B2B SaaS)",
        clientName: "Sarah",
        businessName: "CloudPulse",
        recentMessages: [{ sender: "client", content: "CloudPulse (B2B SaaS)" }],
      });

      expect(res.intentCategory).toBe("Business & Brand Intake");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toContain("CloudPulse");
      expect(professional).toMatch(/SaaS|software|demo|pipeline/i);
      expect(friendly).toMatch(/SaaS|decision-makers|standout/i);
      expect(detailed).toMatch(/full-funnel|decision-makers|demo/i);
    });

    it("diagnoses B2B SaaS demo conversion drop-offs intelligently", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "We are getting healthy website visitors and clicks from LinkedIn ads, but nobody is buying or booking product demos.",
        clientName: "Sarah",
        businessName: "CloudPulse (B2B SaaS)",
        recentMessages: [
          { sender: "client", content: "We are getting healthy website visitors and clicks from LinkedIn ads, but nobody is buying or booking product demos." },
        ],
      });

      expect(res.intentCategory).toBe("Conversion & Sales Funnel Optimization");
      const { professional, detailed } = res.suggestions;

      expect(professional).toMatch(/demo form friction|pricing transparency|case studies|bounce rate/i);
      expect(detailed).toMatch(/audit|Offer|checkout|drop-off/i);
    });
  });

  // ==========================================
  // 3. RESTAURANT & HOSPITALITY
  // ==========================================
  describe("Scenario 3: Restaurant & Hospitality", () => {
    it("focuses on culinary offerings, table reservations, and foot traffic", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "Bistro Banani (Restaurant)",
        clientName: "Chef Arman",
        businessName: "Bistro Banani",
        recentMessages: [{ sender: "client", content: "Bistro Banani (Restaurant)" }],
      });

      expect(res.intentCategory).toBe("Business & Brand Intake");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toContain("Bistro Banani");
      expect(professional).toMatch(/culinary|dining|table reservations|foot traffic/i);
      expect(friendly).toMatch(/culinary|diners|foodies/i);
      expect(detailed).toMatch(/diners|reservations|Top of Funnel/i);
    });

    it("recommends high-definition food preparation Reels and local promotions", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "Should we run Instagram Reels video ads or static banners to promote our new weekend brunch menu?",
        clientName: "Chef Arman",
        businessName: "Bistro Banani (Restaurant)",
        recentMessages: [
          { sender: "client", content: "Should we run Instagram Reels video ads or static banners to promote our new weekend brunch menu?" },
        ],
      });

      expect(res.intentCategory).toBe("Paid Advertising & Creative Strategy");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toMatch(/testing|Reels|promotions/i);
      expect(friendly).toMatch(/video|carousels|culinary/i);
      expect(detailed).toMatch(/Reels|CAPI|reservations|foot traffic/i);
    });
  });

  // ==========================================
  // 4. E-COMMERCE & DIGITAL RETAIL
  // ==========================================
  describe("Scenario 4: E-commerce", () => {
    it("tackles cart abandonment, AOV, and catalog conversion rates", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "GadgetHive BD (E-commerce)",
        clientName: "Sohan",
        businessName: "GadgetHive BD",
        recentMessages: [{ sender: "client", content: "GadgetHive BD (E-commerce)" }],
      });

      expect(res.intentCategory).toBe("Business & Brand Intake");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toContain("GadgetHive BD");
      expect(professional).toMatch(/retail|catalog|order volume|cart completion/i);
      expect(friendly).toMatch(/retail|digital shoppers|standout/i);
      expect(detailed).toMatch(/shoppers|retargeting|order volume/i);
    });

    it("diagnoses e-commerce checkout and delivery trust friction", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "We have thousands of website visitors every day from Facebook ads, but zero sales and high cart drop-off.",
        clientName: "Sohan",
        businessName: "GadgetHive BD",
        recentMessages: [
          { sender: "client", content: "We have thousands of website visitors every day from Facebook ads, but zero sales and high cart drop-off." },
        ],
      });

      expect(res.intentCategory).toBe("Conversion & Sales Funnel Optimization");
      const { professional, detailed } = res.suggestions;

      expect(professional).toMatch(/load speed|checkout friction|shipping costs|payment trust/i);
      expect(detailed).toMatch(/audit|Offer|checkout|drop-off/i);
    });
  });

  // ==========================================
  // 5. CLOTHING BRAND / FASHION
  // ==========================================
  describe("Scenario 5: Clothing Brand", () => {
    it("handles seasonal collections, designer apparel, and lookbook engagement", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "Silk & Linen (Clothing Brand)",
        clientName: "Farhana",
        businessName: "Silk & Linen",
        recentMessages: [{ sender: "client", content: "Silk & Linen (Clothing Brand)" }],
      });

      expect(res.intentCategory).toBe("Business & Brand Intake");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toContain("Silk & Linen");
      expect(professional).toMatch(/fashion collections|designer apparel|sell-through/i);
      expect(friendly).toMatch(/fashion|apparel|shoppers|standout/i);
      expect(detailed).toMatch(/shoppers|lookbook|sell-through/i);
    });

    it("calibrates fashion ad budget against customer acquisition cost and ROAS", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "How much budget do we need to launch our new premium festive collection?",
        clientName: "Farhana",
        businessName: "Silk & Linen (Clothing Brand)",
        recentMessages: [
          { sender: "client", content: "How much budget do we need to launch our new premium festive collection?" },
        ],
      });

      expect(res.intentCategory).toBe("Budgeting & Pricing Policy");
      const { professional, detailed } = res.suggestions;

      expect(professional).toMatch(/learning phase|Customer Acquisition Cost|ROAS/i);
      expect(detailed).toMatch(/Phase 1|ROAS|spend/i);
    });
  });

  // ==========================================
  // 6. SOFTWARE COMPANY
  // ==========================================
  describe("Scenario 6: Software Company", () => {
    it("adapts to enterprise digital solutions, discovery calls, and CTO audiences", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "CodeCraft Solutions (Software Company)",
        clientName: "Zubair",
        businessName: "CodeCraft Solutions",
        recentMessages: [{ sender: "client", content: "CodeCraft Solutions (Software Company)" }],
      });

      expect(res.intentCategory).toBe("Business & Brand Intake");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toContain("CodeCraft Solutions");
      expect(professional).toMatch(/software engineering|digital solutions|discovery call/i);
      expect(friendly).toMatch(/software|CTOs|standout/i);
      expect(detailed).toMatch(/enterprise buyers|discovery call|contracts/i);
    });

    it("handles technical credibility objections constructively", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "We worked with a marketing agency before and they only got us irrelevant student clicks instead of enterprise B2B clients.",
        clientName: "Zubair",
        businessName: "CodeCraft Solutions (Software Company)",
        recentMessages: [
          { sender: "client", content: "We worked with a marketing agency before and they only got us irrelevant student clicks instead of enterprise B2B clients." },
        ],
      });

      expect(res.intentCategory).toBe("Client Objection & Skepticism");
      const { professional, detailed } = res.suggestions;

      expect(professional).toMatch(/testing|methodology|de-risk/i);
      expect(detailed).toMatch(/risk-mitigation|testing budgets|protocol/i);
    });
  });

  // ==========================================
  // 7. EDUCATIONAL INSTITUTE
  // ==========================================
  describe("Scenario 7: Educational Institute", () => {
    it("understands academic curriculums, student enrollments, and admission cycles", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "Apex Academy (Educational Institute)",
        clientName: "Dr. Rahman",
        businessName: "Apex Academy",
        recentMessages: [{ sender: "client", content: "Apex Academy (Educational Institute)" }],
      });

      expect(res.intentCategory).toBe("Business & Brand Intake");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toContain("Apex Academy");
      expect(professional).toMatch(/curriculums|courses|admission|enrollment/i);
      expect(friendly).toMatch(/curriculums|students|standout/i);
      expect(detailed).toMatch(/students|admission|enrollment/i);
    });

    it("provides full-funnel admissions strategy recommendations", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "What marketing strategy do you recommend to fill our upcoming batch of data science students?",
        clientName: "Dr. Rahman",
        businessName: "Apex Academy (Educational Institute)",
        recentMessages: [
          { sender: "client", content: "What marketing strategy do you recommend to fill our upcoming batch of data science students?" },
        ],
      });

      expect(res.intentCategory).toBe("Marketing Strategy & Frameworks");
      const { professional, detailed } = res.suggestions;

      expect(professional).toContain("Apex Academy");
      expect(professional).toMatch(/customer acquisition|revenue|enrollment/i);
      expect(detailed).toMatch(/creative assets|demographics|enrollment/i);
    });
  });

  // ==========================================
  // 8. HEALTHCARE BUSINESS
  // ==========================================
  describe("Scenario 8: Healthcare Business", () => {
    it("aligns with patient care, verified doctor consultations, and clinic trust", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "Prime Dental & Aesthetic Clinic (Healthcare Business)",
        clientName: "Dr. Yasmin",
        businessName: "Prime Dental & Aesthetic Clinic",
        recentMessages: [{ sender: "client", content: "Prime Dental & Aesthetic Clinic (Healthcare Business)" }],
      });

      expect(res.intentCategory).toBe("Business & Brand Intake");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toContain("Prime Dental & Aesthetic Clinic");
      expect(professional).toMatch(/medical services|healthcare|consultations|appointments/i);
      expect(friendly).toMatch(/medical|patients|standout/i);
      expect(detailed).toMatch(/patients|consultations|appointments/i);
    });

    it("handles client frustration with immediate accountability and patient care focus", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "I am extremely disappointed that our doctor appointment booking pixel has not been tested yet.",
        clientName: "Dr. Yasmin",
        businessName: "Prime Dental & Aesthetic Clinic",
        recentMessages: [
          { sender: "client", content: "I am extremely disappointed that our doctor appointment booking pixel has not been tested yet." },
        ],
      });

      expect(res.intentCategory).toBe("Complaint & Dissatisfaction");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toMatch(/candor|priority|address/i);
      expect(friendly).toMatch(/sorry|expectations|resolve/i);
      expect(detailed).toMatch(/accountability|milestones|bottlenecks/i);
    });
  });

  // ==========================================
  // 9. REAL ESTATE & PROPERTY DEVELOPMENT
  // ==========================================
  describe("Scenario 9: Real Estate", () => {
    it("tailors messaging to property developments, site visits, and high-net-worth investors", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "Urban Loft Properties (Real Estate)",
        clientName: "Mr. Chowdhury",
        businessName: "Urban Loft Properties",
        recentMessages: [{ sender: "client", content: "Urban Loft Properties (Real Estate)" }],
      });

      expect(res.intentCategory).toBe("Business & Brand Intake");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toContain("Urban Loft Properties");
      expect(professional).toMatch(/developments|properties|investor|site visit/i);
      expect(friendly).toMatch(/properties|investors|standout/i);
      expect(detailed).toMatch(/investors|site visit|brochure/i);
    });

    it("applies regional STP segmentation for property investor acquisition", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "Should we run property ads targeting only Dhaka and Chittagong or launch nationwide across Bangladesh?",
        clientName: "Mr. Chowdhury",
        businessName: "Urban Loft Properties (Real Estate)",
        recentMessages: [
          { sender: "client", content: "Should we run property ads targeting only Dhaka and Chittagong or launch nationwide across Bangladesh?" },
        ],
      });

      expect(res.intentCategory).toBe("Target Audience & Segmentation");
      const { professional, detailed } = res.suggestions;

      expect(professional).toMatch(/Dhaka and Chittagong|purchasing power|logistics/i);
      expect(detailed).toMatch(/STP|audience|cohorts/i);
    });
  });

  // ==========================================
  // 10. DIGITAL SERVICE AGENCY
  // ==========================================
  describe("Scenario 10: Digital Service Agency", () => {
    it("understands high-ticket retainers, discovery calls, and B2B client acquisition", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "Nexus Design & Growth Studio (Digital Service Agency)",
        clientName: "Tanvir",
        businessName: "Nexus Design & Growth Studio",
        recentMessages: [{ sender: "client", content: "Nexus Design & Growth Studio (Digital Service Agency)" }],
      });

      expect(res.intentCategory).toBe("Business & Brand Intake");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toContain("Nexus Design & Growth Studio");
      expect(professional).toMatch(/consulting|agency services|discovery call|retainer/i);
      expect(friendly).toMatch(/consulting|founders|CMOs|standout/i);
      expect(detailed).toMatch(/founders|discovery calls|partnerships/i);
    });

    it("guides agency campaign performance and retainer metrics", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "How do we evaluate performance and KPIs for high-ticket retainer client acquisition?",
        clientName: "Tanvir",
        businessName: "Nexus Design & Growth Studio (Digital Service Agency)",
        recentMessages: [
          { sender: "client", content: "How do we evaluate performance and KPIs for high-ticket retainer client acquisition?" },
        ],
      });

      expect(res.intentCategory).toBe("Campaign Performance & KPIs");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toMatch(/CTR|CPC|Discovery Call|proposal/i);
      expect(friendly).toMatch(/metrics|Discovery Call|revenue/i);
      expect(detailed).toMatch(/tiered KPI|Discovery Call|performance targets/i);
    });
  });

  // ==========================================
  // GENERAL BUSINESS & CASUAL INQUIRIES
  // ==========================================
  describe("General & Rapport Scenarios Across Industries", () => {
    it("welcomes a healthcare client warmly with sector alignment", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "Hello",
        clientName: "Dr. Yasmin",
        businessName: "Prime Dental Clinic (Healthcare Business)",
        recentMessages: [{ sender: "client", content: "Hello" }],
      });

      expect(res.intentCategory).toBe("Client Greeting & Rapport");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toMatch(/Prime Dental Clinic|connecting/i);
      expect(friendly).toMatch(/excited|collaborate/i);
      expect(detailed).toMatch(/consultations|appointments|revenue/i);
    });

    it("welcomes a real estate developer with strategic readiness", async () => {
      const res = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "Good morning",
        clientName: "Mr. Chowdhury",
        businessName: "Urban Loft Properties (Real Estate)",
        recentMessages: [{ sender: "client", content: "Good morning" }],
      });

      expect(res.intentCategory).toBe("Client Greeting & Rapport");
      const { professional, friendly, detailed } = res.suggestions;

      expect(professional).toMatch(/Urban Loft Properties|connecting/i);
      expect(friendly).toMatch(/excited to collaborate/i);
      expect(detailed).toMatch(/investor|site visit|goal/i);
    });
  });
});
