import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Repository } from "@/lib/db/repo";
import Campaign from "@/models/Campaign";
import { dbConnect } from "@/lib/db/connect";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "client";
}

export interface VerificationResult {
  authorized: boolean;
  status: number;
  error?: string;
  campaign?: any;
  user?: AuthenticatedUser;
}

export class CommunicationAuth {
  /**
   * Resolve authenticated user strictly from NextAuth session or Bearer token.
   * Demo authentication fallback is only allowed if explicitly enabled via
   * ALLOW_DEMO_AUTH="true" in non-production environments.
   */
  static async getUser(req?: Request): Promise<AuthenticatedUser | null> {
    try {
      const session = await getServerSession(authOptions);
      if (session?.user) {
        const id = (session.user as any).id || (session.user as any)._id;
        if (id) {
          return {
            id: String(id),
            name: session.user.name || "User",
            email: session.user.email || "user@example.com",
            role: (session.user as any).role || "client",
          };
        }
      }
    } catch {
      // Ignore session read error
    }

    // Check Authorization: Bearer <CRON_SECRET> for system background invocations
    if (req) {
      const authHeader = req.headers.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.replace("Bearer ", "").trim();
        if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) {
          return {
            id: "system_cron",
            name: "System Cron",
            email: "cron@system.local",
            role: "admin",
          };
        }
      }
    }

    // Explicit opt-in demo authentication for non-production environments only
    const allowDemoAuth =
      process.env.ALLOW_DEMO_AUTH === "true" && process.env.NODE_ENV !== "production";

    if (allowDemoAuth) {
      try {
        const demoClient = await Repository.getOrCreateDemoClient();
        if (demoClient) {
          return {
            id: demoClient._id ? demoClient._id.toString() : String(demoClient.id),
            name: demoClient.name || "Demo Client",
            email: demoClient.email || "client@example.com",
            role: "client",
          };
        }
      } catch {
        // Fall through
      }
    }

    // Fail closed: Missing or invalid session returns null
    return null;
  }

  /**
   * Enforce Admin role authorization.
   * Never bypasses in production.
   */
  static async requireAdmin(req?: Request): Promise<AuthenticatedUser | null> {
    const user = await this.getUser(req);
    if (!user) {
      return null;
    }

    if (user.role === "admin") {
      return user;
    }

    // Explicit demo admin fallback only in non-production when explicitly allowed
    if (
      process.env.ALLOW_DEMO_AUTH === "true" &&
      process.env.NODE_ENV !== "production"
    ) {
      return {
        id: "admin_dev",
        name: "System Admin",
        email: "admin@example.com",
        role: "admin",
      };
    }

    return null;
  }

  /**
   * Verify Client ownership of a campaign strictly.
   * Returns 401 if unauthenticated, 403 if unauthorized.
   */
  static async verifyClientOwnership(
    campaignId: string,
    req?: Request
  ): Promise<VerificationResult> {
    await dbConnect();
    const user = await this.getUser(req);

    if (!user) {
      return {
        authorized: false,
        status: 401,
        error: "Authentication required to access campaign messages",
      };
    }

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return {
        authorized: false,
        status: 404,
        error: "Campaign not found",
        user,
      };
    }

    // Admins have access to all campaigns
    if (user.role === "admin") {
      return { authorized: true, status: 200, campaign, user };
    }

    // Verify ownership: client ID must strictly match campaign.clientId
    const campaignClientId = campaign.clientId ? campaign.clientId.toString() : "";
    if (campaignClientId === user.id) {
      return { authorized: true, status: 200, campaign, user };
    }

    // Authenticated user does not own this campaign
    return {
      authorized: false,
      status: 403,
      error: "Forbidden: You do not have permission to access this campaign",
      campaign,
      user,
    };
  }
}
