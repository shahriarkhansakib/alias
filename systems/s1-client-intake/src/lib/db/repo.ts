import dbConnect, { isMongoConnected, DatabaseConnectionError, getLastDatabaseError } from "@/lib/db/connect";
import User, { IUser } from "@/models/User";
import Campaign, { ICampaign } from "@/models/Campaign";
import Conversation, { IConversation } from "@/models/Conversation";
import Message, { IMessage } from "@/models/Message";
import Artifact1, { IArtifact1, IArtifact1Sections, IArtifact1Snapshot, FieldSource, FieldVerificationStatus } from "@/models/Artifact1";
import Artifact2, { IArtifact2 } from "@/models/Artifact2";
import MasterCampaignBrief, { IMasterCampaignBrief } from "@/models/MasterCampaignBrief";

function assertMemoryFallbackAllowed(operation: string) {
  if (process.env.ALLOW_MEMORY_FALLBACK === "false") {
    const lastErr = getLastDatabaseError();
    const reasonMsg = lastErr?.message ? ` (Underlying cause: ${lastErr.message})` : "";
    throw new DatabaseConnectionError(
      `[Repository] Database unavailable for ${operation} and ALLOW_MEMORY_FALLBACK is 'false'.${reasonMsg}`
    );
  }
}

// In-Memory Storage for Demo Fallback Mode
interface LocalStore {
  users: Record<string, any>;
  campaigns: Record<string, any>;
  conversations: Record<string, any>;
  messages: any[];
  artifacts1: Record<string, any>;
  artifacts2: Record<string, any>;
  masterBriefs: Record<string, any>;
}

declare global {
  // eslint-disable-next-line no-var
  var demoStore: LocalStore | undefined;
}

const memoryStore: LocalStore = global.demoStore || {
  users: {},
  campaigns: {},
  conversations: {},
  messages: [],
  artifacts1: {},
  artifacts2: {},
  masterBriefs: {},
};

if (!global.demoStore) {
  global.demoStore = memoryStore;
}

function generateId(prefix = "id"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function createInitialSections(): IArtifact1Sections {
  return {
    business_profile: {
      company_name: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      industry: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      website: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      business_description: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      business_location: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    product_offering: {
      name: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      category: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      description: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      key_features: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      usp: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      pricing: { value: null, source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      main_benefits: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    campaign_objectives: {
      primary_objective: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      secondary_objectives: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      desired_results: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      kpis: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    target_audience: {
      age_range: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      gender: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      location: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      description: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      demographics: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      pain_points: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      needs: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    budget_allocation: {
      total_budget: { value: null, source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      currency: { value: "BDT", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      budget_type: { value: "unspecified", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      budget_flexibility: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    execution_timeline: {
      duration: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      expected_launch_date: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      launch_readiness: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      deadlines: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    brand_identity: {
      brand_voice: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      brand_personality: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      brand_positioning: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      brand_guidelines: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    marketing_preferences: {
      preferred_platforms: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      content_types: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      competitors: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      previous_experience: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      other_preferences: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
  };
}

function applyFieldVal(
  target: any,
  newVal: any,
  source: FieldSource = "client_stated",
  confidence: number = 1.0,
  verification_status: FieldVerificationStatus = "unverified"
) {
  if (newVal === undefined || newVal === null) return;
  if (typeof newVal === "string" && newVal.trim().length === 0) return;
  if (Array.isArray(newVal) && newVal.length === 0) return;

  target.value = newVal;
  target.source = source;
  target.confidence = confidence;
  if (verification_status) target.verification_status = verification_status;
}

function syncUpdatesToSections(sections: any, updates: any, defaultSource: FieldSource = "client_stated", confidence: number = 1.0) {
  if (!sections) return;
  if (updates.sections) {
    for (const [secKey, secObj] of Object.entries(updates.sections)) {
      if (!sections[secKey]) sections[secKey] = {};
      for (const [fieldKey, fieldVal] of Object.entries(secObj as any)) {
        if (fieldVal && typeof fieldVal === "object" && "value" in fieldVal) {
          const fObj = fieldVal as any;
          sections[secKey][fieldKey] = {
            value: fObj.value,
            source: fObj.source || defaultSource,
            confidence: fObj.confidence ?? confidence,
            verification_status: fObj.verification_status || "unverified",
          };
        } else {
          sections[secKey][fieldKey] = {
            value: fieldVal,
            source: defaultSource,
            confidence,
            verification_status: "unverified",
          };
        }
      }
    }
  }

  // Map legacy fields
  if (updates.client) {
    if (updates.client.company_name) applyFieldVal(sections.business_profile.company_name, updates.client.company_name, defaultSource, confidence);
    if (updates.client.industry) applyFieldVal(sections.business_profile.industry, updates.client.industry, defaultSource, confidence);
    if (updates.client.website) applyFieldVal(sections.business_profile.website, updates.client.website, defaultSource, confidence);
    if (updates.client.business_description) applyFieldVal(sections.business_profile.business_description, updates.client.business_description, defaultSource, confidence);
    if (updates.client.location || updates.client.business_location) applyFieldVal(sections.business_profile.business_location, updates.client.location || updates.client.business_location, defaultSource, confidence);
    if (updates.client.brand_personality) applyFieldVal(sections.brand_identity.brand_personality, updates.client.brand_personality, defaultSource, confidence);
    if (updates.client.competitor_references) applyFieldVal(sections.marketing_preferences.competitors, updates.client.competitor_references, defaultSource, confidence);
    if (updates.client.usp) applyFieldVal(sections.product_offering.usp, updates.client.usp, defaultSource, confidence);
  }

  if (updates.product_service) {
    if (updates.product_service.name) applyFieldVal(sections.product_offering.name, updates.product_service.name, defaultSource, confidence);
    if (updates.product_service.type || updates.product_service.category) applyFieldVal(sections.product_offering.category, updates.product_service.type || updates.product_service.category, defaultSource, confidence);
    if (updates.product_service.description) applyFieldVal(sections.product_offering.description, updates.product_service.description, defaultSource, confidence);
    if (updates.product_service.price !== undefined && updates.product_service.price !== null) applyFieldVal(sections.product_offering.pricing, updates.product_service.price, defaultSource, confidence);
    if (updates.product_service.price_range) applyFieldVal(sections.product_offering.pricing, updates.product_service.price_range, defaultSource, confidence);
    if (updates.product_service.offer) applyFieldVal(sections.product_offering.main_benefits, [updates.product_service.offer], defaultSource, confidence);
    if (updates.product_service.pain_point_solved) applyFieldVal(sections.target_audience.pain_points, [updates.product_service.pain_point_solved], defaultSource, confidence);
  }

  if (updates.campaign) {
    if (updates.campaign.objective) applyFieldVal(sections.campaign_objectives.primary_objective, updates.campaign.objective, defaultSource, confidence);
    if (updates.campaign.desired_result) applyFieldVal(sections.campaign_objectives.desired_results, updates.campaign.desired_result, defaultSource, confidence);
    if (updates.campaign.channels?.paid) applyFieldVal(sections.marketing_preferences.preferred_platforms, updates.campaign.channels.paid, defaultSource, confidence);
  }

  if (updates.target_audience) {
    if (updates.target_audience.age_range) applyFieldVal(sections.target_audience.age_range, updates.target_audience.age_range, defaultSource, confidence);
    if (updates.target_audience.gender) applyFieldVal(sections.target_audience.gender, updates.target_audience.gender, defaultSource, confidence);
    if (updates.target_audience.location) applyFieldVal(sections.target_audience.location, updates.target_audience.location, defaultSource, confidence);
    if (updates.target_audience.description) applyFieldVal(sections.target_audience.description, updates.target_audience.description, defaultSource, confidence);
    if (updates.target_audience.demographics) applyFieldVal(sections.target_audience.demographics, updates.target_audience.demographics, defaultSource, confidence);
    if (updates.target_audience.pain_points) {
      const pp = Array.isArray(updates.target_audience.pain_points) ? updates.target_audience.pain_points : [updates.target_audience.pain_points];
      applyFieldVal(sections.target_audience.pain_points, pp, defaultSource, confidence);
    }
  }

  if (updates.budget) {
    if (updates.budget.amount !== undefined && updates.budget.amount !== null) applyFieldVal(sections.budget_allocation.total_budget, updates.budget.amount, defaultSource, confidence);
    if (updates.budget.currency) applyFieldVal(sections.budget_allocation.currency, updates.budget.currency, defaultSource, confidence);
    if (updates.budget.type) applyFieldVal(sections.budget_allocation.budget_type, updates.budget.type, defaultSource, confidence);
  }

  if (updates.timeline) {
    if (updates.timeline.duration) applyFieldVal(sections.execution_timeline.duration, updates.timeline.duration, defaultSource, confidence);
    if (updates.timeline.start_date) applyFieldVal(sections.execution_timeline.expected_launch_date, updates.timeline.start_date, defaultSource, confidence);
  }

  if (updates.brand_preferences) {
    if (updates.brand_preferences.tone && updates.brand_preferences.tone.length > 0) applyFieldVal(sections.brand_identity.brand_voice, updates.brand_preferences.tone, defaultSource, confidence);
    if (updates.brand_preferences.visual_preference) applyFieldVal(sections.brand_identity.brand_positioning, updates.brand_preferences.visual_preference, defaultSource, confidence);
  }

  if (updates.assets?.readiness) {
    applyFieldVal(sections.execution_timeline.launch_readiness, updates.assets.readiness, defaultSource, confidence);
  }
}

function syncSectionsToLegacyFields(sections: any, target: any) {
  if (!sections || !target) return;
  target.client = target.client || {};
  if (sections.business_profile?.company_name?.value) target.client.company_name = sections.business_profile.company_name.value;
  if (sections.business_profile?.industry?.value) target.client.industry = sections.business_profile.industry.value;
  if (sections.business_profile?.website?.value) target.client.website = sections.business_profile.website.value;
  if (sections.business_profile?.business_description?.value) target.client.business_description = sections.business_profile.business_description.value;

  target.product_service = target.product_service || {};
  if (sections.product_offering?.name?.value) target.product_service.name = sections.product_offering.name.value;
  if (sections.product_offering?.category?.value) target.product_service.type = sections.product_offering.category.value;
  if (sections.product_offering?.description?.value) target.product_service.description = sections.product_offering.description.value;
  if (sections.product_offering?.pricing?.value !== undefined && sections.product_offering.pricing.value !== null) {
    const val = sections.product_offering.pricing.value;
    target.product_service.price = typeof val === "number" ? val : Number(String(val).replace(/\D+/g, "")) || null;
  }

  target.campaign = target.campaign || {};
  if (sections.campaign_objectives?.primary_objective?.value) target.campaign.objective = sections.campaign_objectives.primary_objective.value;
  if (sections.campaign_objectives?.desired_results?.value) target.campaign.desired_result = sections.campaign_objectives.desired_results.value;

  target.target_audience = target.target_audience || {};
  if (sections.target_audience?.age_range?.value) target.target_audience.age_range = sections.target_audience.age_range.value;
  if (sections.target_audience?.gender?.value) target.target_audience.gender = sections.target_audience.gender.value;
  if (sections.target_audience?.location?.value) target.target_audience.location = sections.target_audience.location.value;
  if (sections.target_audience?.description?.value) target.target_audience.description = sections.target_audience.description.value;

  target.budget = target.budget || {};
  if (sections.budget_allocation?.total_budget?.value !== undefined && sections.budget_allocation.total_budget.value !== null) {
    target.budget.amount = sections.budget_allocation.total_budget.value;
  }
  if (sections.budget_allocation?.currency?.value) target.budget.currency = sections.budget_allocation.currency.value;
  if (sections.budget_allocation?.budget_type?.value) target.budget.type = sections.budget_allocation.budget_type.value;

  target.timeline = target.timeline || {};
  if (sections.execution_timeline?.duration?.value) target.timeline.duration = sections.execution_timeline.duration.value;
  if (sections.execution_timeline?.expected_launch_date?.value) target.timeline.start_date = sections.execution_timeline.expected_launch_date.value;
}

function isCoreIntakeComplete(sections: any, legacy: any): boolean {
  const company = sections?.business_profile?.company_name?.value || legacy?.client?.company_name;
  const product = sections?.product_offering?.name?.value || legacy?.product_service?.name;
  const objective = sections?.campaign_objectives?.primary_objective?.value || legacy?.campaign?.objective;
  const audience =
    sections?.target_audience?.description?.value ||
    sections?.target_audience?.location?.value ||
    sections?.target_audience?.age_range?.value ||
    legacy?.target_audience?.description ||
    legacy?.target_audience?.location ||
    legacy?.target_audience?.age_range;
  const hasBudget =
    Boolean(sections?.budget_allocation?.total_budget?.value) ||
    sections?.budget_allocation?.budget_type?.value === "unknown" ||
    Boolean(legacy?.budget?.amount) ||
    legacy?.budget?.type === "unknown";
  const timeline = sections?.execution_timeline?.duration?.value || legacy?.timeline?.duration;

  return Boolean(
    company &&
    typeof company === "string" && company.trim().length >= 2 && company.toLowerCase() !== "name" &&
    product &&
    objective &&
    audience &&
    hasBudget &&
    timeline
  );
}

export const Repository = {
  async getStorageMode(): Promise<"mongodb" | "demo_fallback"> {
    await dbConnect();
    return isMongoConnected() ? "mongodb" : "demo_fallback";
  },

  // USERS
  async getOrCreateDemoClient() {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      let client = await User.findOne({ role: "client" });
      if (!client) {
        client = await User.create({
          name: "Demo Client",
          email: "client@example.com",
          role: "client",
        });
      }
      return client;
    }

    assertMemoryFallbackAllowed("getOrCreateDemoClient");

    // Fallback
    const existing = Object.values(memoryStore.users).find((u) => u.role === "client");
    if (existing) return existing;
    const newClient = {
      _id: generateId("usr"),
      name: "Demo Client",
      email: "client@example.com",
      role: "client",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryStore.users[newClient._id] = newClient;
    return newClient;
  },

  async findUserByEmail(email: string) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      return await User.findOne({ email });
    }
    assertMemoryFallbackAllowed("findUserByEmail");
    return Object.values(memoryStore.users).find((u) => u.email === email) || null;
  },

  async createUser(data: { name: string; email: string; password?: string; role: "admin" | "client" }) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      return await User.create(data);
    }
    assertMemoryFallbackAllowed("createUser");
    const newUser = {
      _id: generateId("usr"),
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryStore.users[newUser._id] = newUser;
    return newUser;
  },

  // CAMPAIGNS
  async createCampaign(name: string, clientId: string) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      const campaign = await Campaign.create({
        clientId,
        name: name || "Untitled Campaign",
        status: "collecting",
      });

      const conversation = await Conversation.create({
        campaignId: campaign._id,
        status: "active",
      });

      campaign.conversationId = conversation._id;
      await campaign.save();

      return {
        campaignId: campaign._id.toString(),
        conversationId: conversation._id.toString(),
        campaign,
      };
    }

    assertMemoryFallbackAllowed("createCampaign");

    // Fallback store
    const campaignId = generateId("camp");
    const conversationId = generateId("conv");

    const campaign = {
      _id: campaignId,
      clientId,
      name: name || "Untitled Campaign",
      status: "collecting",
      conversationId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const conversation = {
      _id: conversationId,
      campaignId,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    memoryStore.campaigns[campaignId] = campaign;
    memoryStore.conversations[conversationId] = conversation;

    return { campaignId, conversationId, campaign };
  },

  async getCampaignById(campaignId: string) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      return await Campaign.findById(campaignId).populate("clientId");
    }
    assertMemoryFallbackAllowed("getCampaignById");
    const c = memoryStore.campaigns[campaignId];
    if (!c) return null;
    const client = memoryStore.users[c.clientId] || { name: "Demo Client", email: "client@example.com" };
    return { ...c, clientId: client };
  },

  async getAllCampaigns() {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      return await Campaign.find().populate("clientId", "name email").sort({ createdAt: -1 });
    }
    assertMemoryFallbackAllowed("getAllCampaigns");
    const list = Object.values(memoryStore.campaigns).map((c) => {
      const client = memoryStore.users[c.clientId] || { name: "Demo Client", email: "client@example.com" };
      return { ...c, clientId: client };
    });
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async updateCampaignStatus(campaignId: string, status: string, additionalRefs: Record<string, any> = {}) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      return await Campaign.findByIdAndUpdate(campaignId, { status, ...additionalRefs }, { returnDocument: 'after' });
    }
    assertMemoryFallbackAllowed("updateCampaignStatus");
    if (memoryStore.campaigns[campaignId]) {
      memoryStore.campaigns[campaignId].status = status;
      Object.assign(memoryStore.campaigns[campaignId], additionalRefs);
      memoryStore.campaigns[campaignId].updatedAt = new Date();
      return memoryStore.campaigns[campaignId];
    }
    return null;
  },

  /**
   * Updates the campaign name to reflect the confirmed brand name.
   * Called automatically as soon as the brand name is extracted from the conversation.
   */
  async updateCampaignName(campaignId: string, brandName: string) {
    if (!brandName || brandName.trim().length < 2) return null;
    const cleanName = brandName.trim();
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      return await Campaign.findByIdAndUpdate(
        campaignId,
        { name: cleanName },
        { returnDocument: 'after' }
      );
    }
    assertMemoryFallbackAllowed("updateCampaignName");
    if (memoryStore.campaigns[campaignId]) {
      memoryStore.campaigns[campaignId].name = cleanName;
      memoryStore.campaigns[campaignId].updatedAt = new Date();
      return memoryStore.campaigns[campaignId];
    }
    return null;
  },

  // CONVERSATIONS & MESSAGES
  async getConversation(campaignId: string) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      return await Conversation.findOne({ campaignId });
    }
    assertMemoryFallbackAllowed("getConversation");
    return Object.values(memoryStore.conversations).find((cv) => cv.campaignId === campaignId) || null;
  },

  async getMessages(campaignId: string) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      return await Message.find({ campaignId }).sort({ createdAt: 1 });
    }
    assertMemoryFallbackAllowed("getMessages");
    return memoryStore.messages
      .filter((m) => m.campaignId === campaignId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  async createMessage(data: {
    conversationId: string;
    campaignId: string;
    sender: "user" | "ai" | "system";
    content: string;
    extractedFields?: any;
  }) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      return await Message.create(data);
    }
    assertMemoryFallbackAllowed("createMessage");
    const msg = {
      _id: generateId("msg"),
      ...data,
      createdAt: new Date(),
    };
    memoryStore.messages.push(msg);
    return msg;
  },

  // ARTIFACT 1
  async getArtifact1(campaignId: string) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      return await Artifact1.findOne({ campaignId });
    }
    assertMemoryFallbackAllowed("getArtifact1");
    return memoryStore.artifacts1[campaignId] || null;
  },

  async upsertArtifact1(
    campaignId: string,
    updates: any = {},
    status?: string,
    options?: { source?: FieldSource; reason?: string; modifiedBy?: string }
  ) {
    const source: FieldSource = options?.source || "client_stated";
    const confidence = source === "client_stated" ? 1.0 : source === "admin_provided" ? 1.0 : 0.8;

    // Sanitize numeric fields if LLM passed range strings
    if (updates.budget && typeof updates.budget.amount === "string") {
      const numbers = (updates.budget.amount as string).match(/\d+/g);
      if (numbers && numbers.length > 0) {
        const val = Number(numbers[numbers.length - 1]);
        updates.budget.amount = isNaN(val) ? null : val;
        if (numbers.length > 1) updates.budget.type = "range";
      } else {
        updates.budget.amount = null;
      }
    }
    if (updates.product_service && typeof updates.product_service.price === "string") {
      const numbers = (updates.product_service.price as string).match(/\d+/g);
      if (numbers && numbers.length > 0) {
        const val = Number(numbers[0]);
        updates.product_service.price = isNaN(val) ? null : val;
      } else {
        updates.product_service.price = null;
      }
    }

    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      let artifact = await Artifact1.findOne({ campaignId });
      const initialSections = createInitialSections();

      if (!artifact) {
        artifact = new Artifact1({
          campaignId,
          type: "client_facts",
          artifactType: "client_campaign_brief",
          version: 1,
          status: status || "DRAFT",
          sections: initialSections,
          metadata: {
            generatedAt: new Date(),
            lastUpdatedAt: new Date(),
          },
          revisions: [],
        });
      } else {
        const wasConfirmed = String(artifact.status || "").toUpperCase() === "CONFIRMED";
        if (wasConfirmed && source === "client_stated") {
          if (!artifact.confirmedSnapshot) {
            artifact.confirmedSnapshot = {
              version: artifact.version,
              status: "CONFIRMED",
              sections: JSON.parse(JSON.stringify(artifact.sections || initialSections)),
              confirmedAt: artifact.metadata?.confirmedAt || new Date(),
              confirmedBy: artifact.metadata?.confirmedBy || "admin",
            };
          }
          artifact.revisions.push({
            version: artifact.version,
            status: artifact.status,
            sections: JSON.parse(JSON.stringify(artifact.sections || initialSections)),
            confirmedAt: artifact.metadata?.confirmedAt,
            confirmedBy: artifact.metadata?.confirmedBy,
            updatedAt: new Date(),
            reason: options?.reason || "Client correction received after confirmation",
          });
          artifact.version = (artifact.version || 1) + 1;
          artifact.status = "READY_FOR_REVIEW";
        }
      }

      if (!artifact.sections || !artifact.sections.business_profile) {
        artifact.sections = initialSections;
      }

      syncUpdatesToSections(artifact.sections, updates, source, confidence);
      syncSectionsToLegacyFields(artifact.sections, artifact);

      if (updates.client) artifact.client = { ...((artifact.client as any)?.toObject?.() || artifact.client), ...updates.client };
      if (updates.product_service) artifact.product_service = { ...((artifact.product_service as any)?.toObject?.() || artifact.product_service), ...updates.product_service };
      if (updates.campaign) artifact.campaign = { ...((artifact.campaign as any)?.toObject?.() || artifact.campaign), ...updates.campaign };
      if (updates.target_audience) artifact.target_audience = { ...((artifact.target_audience as any)?.toObject?.() || artifact.target_audience), ...updates.target_audience };
      if (updates.budget) artifact.budget = { ...((artifact.budget as any)?.toObject?.() || artifact.budget), ...updates.budget };
      if (updates.timeline) artifact.timeline = { ...((artifact.timeline as any)?.toObject?.() || artifact.timeline), ...updates.timeline };
      if (updates.brand_preferences) artifact.brand_preferences = { ...((artifact.brand_preferences as any)?.toObject?.() || artifact.brand_preferences), ...updates.brand_preferences };
      if (updates.assets) artifact.assets = { ...((artifact.assets as any)?.toObject?.() || artifact.assets), ...updates.assets };
      if (updates.offers) (artifact as any).offers = { ...((artifact as any).offers?.toObject?.() || (artifact as any).offers), ...updates.offers };
      if (updates.operations) (artifact as any).operations = { ...((artifact as any).operations?.toObject?.() || (artifact as any).operations), ...updates.operations };
      if (updates.confirmed_facts) (artifact as any).confirmed_facts = { ...((artifact as any).confirmed_facts || {}), ...updates.confirmed_facts };
      if (updates.ai_recommendations) (artifact as any).ai_recommendations = { ...((artifact as any).ai_recommendations || {}), ...updates.ai_recommendations };
      if (updates.assumptions) (artifact as any).assumptions = { ...((artifact as any).assumptions || {}), ...updates.assumptions };
      if (updates.missing_information) (artifact as any).missing_information = updates.missing_information;

      const complete = isCoreIntakeComplete(artifact.sections, artifact);
      if (status) {
        artifact.status = status as any;
      } else if (String(artifact.status || "").toUpperCase() === "CONFIRMED") {
        // preserve
      } else if (complete) {
        artifact.status = "READY_FOR_REVIEW";
      } else if (!artifact.status) {
        artifact.status = "DRAFT";
      }

      artifact.metadata = artifact.metadata || { generatedAt: new Date(), lastUpdatedAt: new Date() };
      artifact.metadata.lastUpdatedAt = new Date();

      artifact.markModified("sections");
      artifact.markModified("metadata");
      artifact.markModified("revisions");
      await artifact.save();

      const campaignUpdates: any = { artifact1Id: artifact._id };
      const brandName = artifact.client?.company_name || artifact.sections?.business_profile?.company_name?.value;
      if (brandName && typeof brandName === "string" && brandName.trim().length >= 2 && brandName.toLowerCase() !== "name") {
        const camp = await Campaign.findById(campaignId);
        if (camp) {
          const isDefault = !camp.name || camp.name === "New Marketing Campaign" || camp.name === "Untitled Campaign";
          if (isDefault) {
            campaignUpdates.name = brandName.trim();
          }
        }
      }
      await Campaign.findByIdAndUpdate(campaignId, campaignUpdates);
      return artifact;
    }

    assertMemoryFallbackAllowed("upsertArtifact1");

    let current = memoryStore.artifacts1[campaignId];
    const initialSections = createInitialSections();
    if (!current) {
      current = {
        _id: generateId("art1"),
        campaignId,
        type: "client_facts",
        artifactType: "client_campaign_brief",
        version: 1,
        status: status || "DRAFT",
        sections: initialSections,
        metadata: {
          generatedAt: new Date(),
          lastUpdatedAt: new Date(),
        },
        revisions: [],
        client: { name: "", company_name: "", industry: "", website: "", business_description: "" },
        product_service: { name: "", type: "", description: "", price: null, offer: "" },
        campaign: { name: "", objective: "", campaign_type: "", desired_result: "" },
        target_audience: { age_range: "", gender: "", location: "", description: "" },
        budget: { amount: null, currency: "BDT", type: "unspecified" },
        timeline: { start_date: "", end_date: "", duration: "" },
        brand_preferences: { tone: [], language: [], visual_preference: "", do: [], dont: [] },
        assets: { logo: [], images: [], videos: [], documents: [], links: [] },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } else {
      const wasConfirmed = String(current.status || "").toUpperCase() === "CONFIRMED";
      if (wasConfirmed && source === "client_stated") {
        if (!current.confirmedSnapshot) {
          current.confirmedSnapshot = {
            version: current.version,
            status: "CONFIRMED",
            sections: JSON.parse(JSON.stringify(current.sections || initialSections)),
            confirmedAt: current.metadata?.confirmedAt || new Date(),
            confirmedBy: current.metadata?.confirmedBy || "admin",
          };
        }
        current.revisions = current.revisions || [];
        current.revisions.push({
          version: current.version,
          status: current.status,
          sections: JSON.parse(JSON.stringify(current.sections || initialSections)),
          confirmedAt: current.metadata?.confirmedAt,
          confirmedBy: current.metadata?.confirmedBy,
          updatedAt: new Date(),
          reason: options?.reason || "Client correction received after confirmation",
        });
        current.version = (current.version || 1) + 1;
        current.status = "READY_FOR_REVIEW";
      }
    }

    current.sections = current.sections || initialSections;
    syncUpdatesToSections(current.sections, updates, source, confidence);
    syncSectionsToLegacyFields(current.sections, current);

    if (updates.client) current.client = { ...current.client, ...updates.client };
    if (updates.product_service) current.product_service = { ...current.product_service, ...updates.product_service };
    if (updates.campaign) current.campaign = { ...current.campaign, ...updates.campaign };
    if (updates.target_audience) current.target_audience = { ...current.target_audience, ...updates.target_audience };
    if (updates.budget) current.budget = { ...current.budget, ...updates.budget };
    if (updates.timeline) current.timeline = { ...current.timeline, ...updates.timeline };
    if (updates.brand_preferences) current.brand_preferences = { ...current.brand_preferences, ...updates.brand_preferences };
    if (updates.assets) current.assets = { ...current.assets, ...updates.assets };
    if (updates.offers) current.offers = { ...(current.offers || {}), ...updates.offers };
    if (updates.operations) current.operations = { ...(current.operations || {}), ...updates.operations };
    if (updates.confirmed_facts) current.confirmed_facts = { ...(current.confirmed_facts || {}), ...updates.confirmed_facts };
    if (updates.ai_recommendations) current.ai_recommendations = { ...(current.ai_recommendations || {}), ...updates.ai_recommendations };
    if (updates.assumptions) current.assumptions = { ...(current.assumptions || {}), ...updates.assumptions };
    if (updates.missing_information) current.missing_information = updates.missing_information;

    const completeMem = isCoreIntakeComplete(current.sections, current);
    if (status) {
      current.status = status;
    } else if (String(current.status || "").toUpperCase() === "CONFIRMED") {
      // preserve
    } else if (completeMem) {
      current.status = "READY_FOR_REVIEW";
    } else if (!current.status) {
      current.status = "DRAFT";
    }

    current.metadata = current.metadata || { generatedAt: new Date(), lastUpdatedAt: new Date() };
    current.metadata.lastUpdatedAt = new Date();
    current.updatedAt = new Date();

    memoryStore.artifacts1[campaignId] = current;
    if (memoryStore.campaigns[campaignId]) {
      memoryStore.campaigns[campaignId].artifact1Id = current._id;
      const brandName = current.client?.company_name || current.sections?.business_profile?.company_name?.value;
      if (brandName && brandName.trim().length >= 2 && brandName.toLowerCase() !== "name") {
        const campName = memoryStore.campaigns[campaignId].name;
        if (!campName || campName === "New Marketing Campaign" || campName === "Untitled Campaign") {
          memoryStore.campaigns[campaignId].name = brandName.trim();
        }
      }
    }
    return current;
  },

  // CAMPAIGN DOCUMENTS (Phase 1 Deliverables)
  async saveCampaignDocuments(campaignId: string, docs: { masterBriefMarkdown: string; executionScriptMarkdown: string }) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      let brief = await MasterCampaignBrief.findOne({ campaignId });
      if (brief) {
        brief.masterBriefMarkdown = docs.masterBriefMarkdown;
        brief.executionScriptMarkdown = docs.executionScriptMarkdown;
        brief.status = "confirmed";
        brief.version = "1.0";
        await brief.save();
      } else {
        brief = await MasterCampaignBrief.create({
          campaignId,
          status: "confirmed",
          version: "1.0",
          masterBriefMarkdown: docs.masterBriefMarkdown,
          executionScriptMarkdown: docs.executionScriptMarkdown,
        });
      }

      const campaignDocUpdates: any = {
        masterBriefId: brief._id,
        masterBriefMarkdown: docs.masterBriefMarkdown,
        executionScriptMarkdown: docs.executionScriptMarkdown,
        status: "completed",
      };

      // Ensure campaign name reflects confirmed brand
      const briefTitleMatch = docs.masterBriefMarkdown?.match(/^#\s+MASTER\s+CAMPAIGN\s+BRIEF:\s*(.+)$/m);
      const brandInBrief = briefTitleMatch?.[1]?.replace(/[*_#]/g, "")?.trim();
      if (brandInBrief && brandInBrief.length >= 2 && brandInBrief.toLowerCase() !== "name") {
        campaignDocUpdates.name = brandInBrief;
      } else {
        const art1 = await Artifact1.findOne({ campaignId });
        if (art1?.client?.company_name && art1.client.company_name.toLowerCase() !== "name") {
          campaignDocUpdates.name = art1.client.company_name.trim();
        }
      }

      const campaign = await Campaign.findByIdAndUpdate(
        campaignId,
        campaignDocUpdates,
        { returnDocument: 'after' }
      );
      return campaign;
    }

    assertMemoryFallbackAllowed("saveCampaignDocuments");

    if (memoryStore.campaigns[campaignId]) {
      memoryStore.campaigns[campaignId].masterBriefMarkdown = docs.masterBriefMarkdown;
      memoryStore.campaigns[campaignId].executionScriptMarkdown = docs.executionScriptMarkdown;
      memoryStore.campaigns[campaignId].status = "completed";
      memoryStore.campaigns[campaignId].updatedAt = new Date();
      const briefTitleMatch = docs.masterBriefMarkdown?.match(/^#\s+MASTER\s+CAMPAIGN\s+BRIEF:\s*(.+)$/m);
      const brandInBrief = briefTitleMatch?.[1]?.replace(/[*_#]/g, "")?.trim();
      if (brandInBrief && brandInBrief.length >= 2 && brandInBrief.toLowerCase() !== "name") {
        memoryStore.campaigns[campaignId].name = brandInBrief;
      }
      return memoryStore.campaigns[campaignId];
    }
    return null;
  },

  async getCampaignDocuments(campaignId: string) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign) return null;
      return {
        masterBriefMarkdown: campaign.masterBriefMarkdown || "",
        executionScriptMarkdown: campaign.executionScriptMarkdown || "",
        status: campaign.status,
      };
    }

    assertMemoryFallbackAllowed("getCampaignDocuments");

    const campaign = memoryStore.campaigns[campaignId];
    if (!campaign) return null;
    return {
      masterBriefMarkdown: campaign.masterBriefMarkdown || "",
      executionScriptMarkdown: campaign.executionScriptMarkdown || "",
      status: campaign.status,
    };
  },

  async confirmArtifact1(campaignId: string, confirmedBy: string = "admin") {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      let artifact = await Artifact1.findOne({ campaignId });
      if (!artifact) {
        throw new Error("Artifact-1 not found for this campaign");
      }

      artifact.status = "CONFIRMED";
      artifact.metadata = artifact.metadata || { generatedAt: new Date(), lastUpdatedAt: new Date() };
      artifact.metadata.confirmedAt = new Date();
      artifact.metadata.confirmedBy = confirmedBy;
      artifact.metadata.lastUpdatedAt = new Date();

      // Create frozen locked snapshot
      const snapshotSections = JSON.parse(JSON.stringify(artifact.sections || {}));
      artifact.confirmedSnapshot = {
        version: artifact.version || 1,
        status: "CONFIRMED",
        sections: snapshotSections,
        confirmedAt: artifact.metadata.confirmedAt,
        confirmedBy,
      };

      artifact.revisions = artifact.revisions || [];
      artifact.revisions.push({
        version: artifact.version || 1,
        status: "CONFIRMED",
        sections: snapshotSections,
        confirmedAt: artifact.metadata.confirmedAt,
        confirmedBy,
        updatedAt: new Date(),
        reason: "Confirmed by admin",
      });

      artifact.markModified("sections");
      artifact.markModified("metadata");
      artifact.markModified("revisions");
      artifact.markModified("confirmedSnapshot");
      await artifact.save();

      const campUpdate: any = { status: "confirmed" };
      const brandName = artifact.client?.company_name || artifact.sections?.business_profile?.company_name?.value;
      if (brandName && typeof brandName === "string" && brandName.trim().length >= 2 && brandName.toLowerCase() !== "name") {
        campUpdate.name = brandName.trim();
      }
      await Campaign.findByIdAndUpdate(campaignId, campUpdate);
      return artifact;
    }

    assertMemoryFallbackAllowed("confirmArtifact1");

    let current = memoryStore.artifacts1[campaignId];
    if (!current) {
      throw new Error("Artifact-1 not found for this campaign in memory store");
    }

    current.status = "CONFIRMED";
    current.metadata = current.metadata || { generatedAt: new Date(), lastUpdatedAt: new Date() };
    current.metadata.confirmedAt = new Date();
    current.metadata.confirmedBy = confirmedBy;
    current.metadata.lastUpdatedAt = new Date();
    current.updatedAt = new Date();

    const snapshotSections = JSON.parse(JSON.stringify(current.sections || {}));
    current.confirmedSnapshot = {
      version: current.version || 1,
      status: "CONFIRMED",
      sections: snapshotSections,
      confirmedAt: current.metadata.confirmedAt,
      confirmedBy,
    };

    current.revisions = current.revisions || [];
    current.revisions.push({
      version: current.version || 1,
      status: "CONFIRMED",
      sections: snapshotSections,
      confirmedAt: current.metadata.confirmedAt,
      confirmedBy,
      updatedAt: new Date(),
      reason: "Confirmed by admin",
    });

    if (memoryStore.campaigns[campaignId]) {
      memoryStore.campaigns[campaignId].status = "confirmed";
      const brandName = current.client?.company_name || current.sections?.business_profile?.company_name?.value;
      if (brandName && brandName.trim().length >= 2 && brandName.toLowerCase() !== "name") {
        memoryStore.campaigns[campaignId].name = brandName.trim();
      }
    }
    return current;
  },

  async getConfirmedClientBrief(campaignId: string) {
    const artifact = await this.getArtifact1(campaignId);
    if (!artifact) return null;
    const st = String(artifact.status || "").toUpperCase();
    if (st !== "CONFIRMED") return null;

    return {
      artifactId: artifact._id,
      campaignId: artifact.campaignId,
      version: artifact.confirmedSnapshot?.version || artifact.version || 1,
      status: "CONFIRMED",
      structuredCampaignInformation: artifact.confirmedSnapshot?.sections || artifact.sections,
      provenanceMetadata: {
        generatedAt: artifact.metadata?.generatedAt || artifact.createdAt,
        lastUpdatedAt: artifact.metadata?.lastUpdatedAt || artifact.updatedAt,
        confirmedAt: artifact.metadata?.confirmedAt || artifact.updatedAt,
        confirmedBy: artifact.metadata?.confirmedBy || "admin",
        version: artifact.confirmedSnapshot?.version || artifact.version || 1,
      },
      confirmationMetadata: {
        confirmedAt: artifact.metadata?.confirmedAt || artifact.updatedAt,
        confirmedBy: artifact.metadata?.confirmedBy || "admin",
        lockedSnapshotVersion: artifact.confirmedSnapshot?.version || artifact.version || 1,
      },
      artifact: artifact.confirmedSnapshot || artifact,
    };
  },

  async requestArtifact1Clarification(
    campaignId: string,
    fieldSection: string,
    fieldKey: string,
    reason: string = "Needs clarification",
    requestedBy: string = "admin"
  ) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      const artifact = await Artifact1.findOne({ campaignId });
      if (!artifact) throw new Error("Artifact-1 not found");
      if (artifact.sections && (artifact.sections as any)[fieldSection] && (artifact.sections as any)[fieldSection][fieldKey]) {
        (artifact.sections as any)[fieldSection][fieldKey].verification_status = "needs_clarification";
      }
      artifact.status = "NEEDS_CLARIFICATION";
      artifact.metadata = artifact.metadata || { generatedAt: new Date(), lastUpdatedAt: new Date() };
      artifact.metadata.lastUpdatedAt = new Date();
      artifact.revisions = artifact.revisions || [];
      artifact.revisions.push({
        version: artifact.version || 1,
        status: "NEEDS_CLARIFICATION",
        sections: JSON.parse(JSON.stringify(artifact.sections || {})),
        updatedAt: new Date(),
        reason: `Clarification requested on ${fieldSection}.${fieldKey}: ${reason}`,
      });
      artifact.markModified("sections");
      artifact.markModified("metadata");
      artifact.markModified("revisions");
      await artifact.save();
      return artifact;
    }

    assertMemoryFallbackAllowed("requestArtifact1Clarification");
    const current = memoryStore.artifacts1[campaignId];
    if (!current) throw new Error("Artifact-1 not found");
    if (current.sections && current.sections[fieldSection] && current.sections[fieldSection][fieldKey]) {
      current.sections[fieldSection][fieldKey].verification_status = "needs_clarification";
    }
    current.status = "NEEDS_CLARIFICATION";
    current.metadata = current.metadata || { generatedAt: new Date(), lastUpdatedAt: new Date() };
    current.metadata.lastUpdatedAt = new Date();
    current.revisions = current.revisions || [];
    current.revisions.push({
      version: current.version || 1,
      status: "NEEDS_CLARIFICATION",
      sections: JSON.parse(JSON.stringify(current.sections || {})),
      updatedAt: new Date(),
      reason: `Clarification requested on ${fieldSection}.${fieldKey}: ${reason}`,
    });
    return current;
  },

  // ARTIFACT 2
  async getArtifact2(campaignId: string) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      return await Artifact2.findOne({ campaignId });
    }
    assertMemoryFallbackAllowed("getArtifact2");
    return memoryStore.artifacts2[campaignId] || null;
  },

  async saveArtifact2(campaignId: string, data: any) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      let artifact2 = await Artifact2.findOne({ campaignId });
      if (artifact2) {
        const existingSnapshot = {
          version: artifact2.version || "1.0",
          research_status: artifact2.research_status,
          completion_date: artifact2.completion_date,
          categories_completed: artifact2.categories_completed,
          findings: artifact2.findings,
          competitors: artifact2.competitors,
          sources: artifact2.sources,
          stats: artifact2.stats,
          limitations: artifact2.limitations,
          search_provider_status: artifact2.search_provider_status,
          savedAt: new Date(),
        };

        const currentRevHistory = Array.isArray(artifact2.revision_history) ? [...artifact2.revision_history] : [];
        currentRevHistory.push(existingSnapshot);

        const currentVersionNumber = parseFloat(artifact2.version || "1.0");
        const nextVersion = isNaN(currentVersionNumber) ? "2.0" : (currentVersionNumber + 1.0).toFixed(1);

        Object.assign(artifact2, data, {
          status: "confirmed",
          version: nextVersion,
          revision_history: currentRevHistory,
        });
        await artifact2.save();
      } else {
        artifact2 = await Artifact2.create({
          campaignId,
          status: "confirmed",
          version: data.version || "1.0",
          revision_history: [],
          ...data,
        });
      }
      await Campaign.findByIdAndUpdate(campaignId, { artifact2Id: artifact2._id });
      return artifact2;
    }

    assertMemoryFallbackAllowed("saveArtifact2");

    const prev = memoryStore.artifacts2[campaignId];
    let revision_history: any[] = [];
    let nextVersion = "1.0";
    if (prev) {
      revision_history = Array.isArray(prev.revision_history) ? [...prev.revision_history] : [];
      revision_history.push({
        version: prev.version || "1.0",
        research_status: prev.research_status,
        findings: prev.findings,
        competitors: prev.competitors,
        sources: prev.sources,
        stats: prev.stats,
        savedAt: new Date(),
      });
      const verNum = parseFloat(prev.version || "1.0");
      nextVersion = isNaN(verNum) ? "2.0" : (verNum + 1.0).toFixed(1);
    }

    const art2 = {
      _id: prev?._id || generateId("art2"),
      campaignId,
      type: "research_enrichment",
      status: "confirmed",
      ...data,
      version: prev ? nextVersion : (data.version || "1.0"),
      revision_history,
      createdAt: prev?.createdAt || new Date(),
      updatedAt: new Date(),
    };
    memoryStore.artifacts2[campaignId] = art2;
    if (memoryStore.campaigns[campaignId]) {
      memoryStore.campaigns[campaignId].artifact2Id = art2._id;
    }
    return art2;
  },

  // MASTER CAMPAIGN BRIEF
  async getMasterBrief(campaignId: string) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      return await MasterCampaignBrief.findOne({ campaignId });
    }
    assertMemoryFallbackAllowed("getMasterBrief");
    return memoryStore.masterBriefs[campaignId] || null;
  },

  async saveMasterBrief(campaignId: string, data: any) {
    const mongo = await dbConnect();
    if (mongo && isMongoConnected()) {
      let brief = await MasterCampaignBrief.findOne({ campaignId });
      if (brief) {
        Object.assign(brief, data, { status: "confirmed", version: "1.0" });
        await brief.save();
      } else {
        brief = await MasterCampaignBrief.create({
          campaignId,
          status: "confirmed",
          version: "1.0",
          ...data,
        });
      }
      const masterBriefCampaignUpdates: any = {
        masterBriefId: brief._id,
        status: "completed",
      };

      const briefTitleMatch = data?.masterBriefMarkdown?.match(/^#\s+MASTER\s+CAMPAIGN\s+BRIEF:\s*(.+)$/m);
      const brandInBrief = briefTitleMatch?.[1]?.replace(/[*_#]/g, "")?.trim();
      if (brandInBrief && brandInBrief.length >= 2 && brandInBrief.toLowerCase() !== "name") {
        masterBriefCampaignUpdates.name = brandInBrief;
      }

      await Campaign.findByIdAndUpdate(campaignId, masterBriefCampaignUpdates);
      return brief;
    }

    assertMemoryFallbackAllowed("saveMasterBrief");

    const brief = {
      _id: generateId("brief"),
      campaignId,
      status: "confirmed",
      version: "1.0",
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryStore.masterBriefs[campaignId] = brief;
    if (memoryStore.campaigns[campaignId]) {
      memoryStore.campaigns[campaignId].masterBriefId = brief._id;
      memoryStore.campaigns[campaignId].status = "completed";
      const briefTitleMatch = data?.masterBriefMarkdown?.match(/^#\s+MASTER\s+CAMPAIGN\s+BRIEF:\s*(.+)$/m);
      const brandInBrief = briefTitleMatch?.[1]?.replace(/[*_#]/g, "")?.trim();
      if (brandInBrief && brandInBrief.length >= 2 && brandInBrief.toLowerCase() !== "name") {
        memoryStore.campaigns[campaignId].name = brandInBrief;
      }
    }
    return brief;
  },

  // ADMIN OVERVIEW METRICS
  async getAdminStats() {
    const allCampaigns = await this.getAllCampaigns();
    const totalCampaigns = allCampaigns.length;
    const completedBriefs = allCampaigns.filter((c) => c.status === "completed").length;
    const activeConversations = allCampaigns.filter((c) => c.status === "collecting" || c.status === "ready_for_confirmation").length;
    const completedResearch = allCampaigns.filter((c) => c.status === "research_completed" || c.status === "completed").length;

    const mongo = await dbConnect();
    let totalClients = 0;
    if (mongo && isMongoConnected()) {
      totalClients = await User.countDocuments({ role: "client" });
    } else {
      assertMemoryFallbackAllowed("getAdminStats");
      totalClients = Object.values(memoryStore.users).filter((u) => u.role === "client").length || 1;
    }

    return {
      totalClients,
      totalCampaigns,
      activeConversations,
      completedResearch,
      completedBriefs,
    };
  },
};
