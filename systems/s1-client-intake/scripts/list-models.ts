import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { GoogleGenAI } from "@google/genai";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set in .env.local");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const pager = await ai.models.list();
    const availableModels: string[] = [];

    for await (const model of pager) {
      // Check if model supports generateContent
      // In Gemini API, supportedActions or supportedGenerationMethods indicates support
      const supportedMethods =
        (model as any).supportedGenerationMethods ||
        (model as any).supportedActions ||
        [];

      const supportsGenerateContent =
        supportedMethods.length === 0 || // if not specified, include by default or check name
        supportedMethods.includes("generateContent") ||
        supportedMethods.includes("models.generateContent");

      if (supportsGenerateContent) {
        availableModels.push(model.name || "unknown");
      }
    }

    console.log("=== Available Models Supporting generateContent ===");
    for (const name of availableModels) {
      console.log(name);
    }
  } catch (error: any) {
    console.error("Failed to list models:", error.message || error);
    process.exit(1);
  }
}

main();
