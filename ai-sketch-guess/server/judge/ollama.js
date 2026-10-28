// Local models through Ollama (https://ollama.com). Set JUDGE_PROVIDER=ollama.
// The model must accept images: check with `ollama show <model>` (look for "vision").
export async function judgeImages({ instructions, imageA, imageB, jsonSchema }) {
  const host = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "");

  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "gemma4:12b",
      stream: false,
      format: jsonSchema,
      messages: [
        { role: "user", content: "Drawing A:", images: [imageA] },
        { role: "user", content: "Drawing B:", images: [imageB] },
        { role: "user", content: instructions },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.message.content);
}
