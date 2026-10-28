// Google Gemini adapter (default). Uses the Interactions API from @google/genai.
import { GoogleGenAI } from "@google/genai";

let client;

export async function judgeImages({ instructions, imageA, imageB, jsonSchema }) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const interaction = await client.interactions.create({
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    input: [
      { type: "text", text: instructions },
      { type: "text", text: "Drawing A:" },
      { type: "image", data: imageA, mime_type: "image/png" },
      { type: "text", text: "Drawing B:" },
      { type: "image", data: imageB, mime_type: "image/png" },
    ],
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: jsonSchema,
    },
  });

  return JSON.parse(interaction.output_text);
}
