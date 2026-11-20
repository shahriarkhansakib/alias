import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function testGeminiSearch() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("GEMINI_API_KEY present:", Boolean(apiKey));
  const ai = new GoogleGenAI({ apiKey });

  try {
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
      contents: "What are the latest 2025/2026 menswear and fashion retail trends and top clothing brands in Bangladesh?",
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    console.log("Res text length:", res.text?.length);
    console.log("Grounding metadata:", JSON.stringify(res.candidates?.[0]?.groundingMetadata, null, 2));
  } catch (err: any) {
    console.error("Gemini Search test failed:", err);
  }
}

testGeminiSearch();
