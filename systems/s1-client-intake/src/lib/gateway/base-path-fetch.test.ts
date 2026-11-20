import { describe, expect, it } from "vitest";
import { withBasePath } from "./base-path-fetch";

describe("withBasePath", () => {
  describe("happy paths", () => {
    it("prefixes same-origin API calls with the gateway base path", () => {
      expect(withBasePath("/api/campaigns")).toBe("/intake/api/campaigns");
      expect(withBasePath("/api/conversations/abc/messages?x=1")).toBe(
        "/intake/api/conversations/abc/messages?x=1",
      );
    });
  });

  describe("edge cases", () => {
    it("does not double-prefix paths that already carry the base path", () => {
      expect(withBasePath("/intake/api/campaigns")).toBe("/intake/api/campaigns");
    });
    it("leaves non-API paths alone (Next.js handles page links itself)", () => {
      expect(withBasePath("/campaign/new")).toBe("/campaign/new");
      expect(withBasePath("/apiary")).toBe("/apiary");
    });
  });

  describe("error cases", () => {
    it("leaves absolute, protocol-relative and relative URLs untouched", () => {
      expect(withBasePath("https://api.tavily.com/search")).toBe("https://api.tavily.com/search");
      expect(withBasePath("//cdn.example.com/a.js")).toBe("//cdn.example.com/a.js");
      expect(withBasePath("api/campaigns")).toBe("api/campaigns");
    });
  });
});
