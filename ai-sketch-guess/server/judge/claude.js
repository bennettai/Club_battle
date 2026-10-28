// Anthropic Claude adapter. Set JUDGE_PROVIDER=claude to use it.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

let client;

export async function judgeImages({ instructions, imageA, imageB, zodSchema }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic();

  const response = await client.messages.parse({
    model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(zodSchema) },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Drawing A:" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: imageA } },
          { type: "text", text: "Drawing B:" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: imageB } },
          { type: "text", text: instructions },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude declined to judge this round");
  if (!response.parsed_output) throw new Error(`Claude returned no verdict (stop_reason: ${response.stop_reason})`);
  return response.parsed_output;
}
