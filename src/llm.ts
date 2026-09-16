/** Optional LLM helper (Anthropic Messages API). Features fall back to heuristics without a key. */
export const llmEnabled = () => !!process.env.ANTHROPIC_API_KEY;

export async function askJson<T>(system: string, user: string): Promise<T | null> {
  if (!llmEnabled()) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
        max_tokens: 1200,
        system: system + "\nRespond with JSON only. No prose, no code fences.",
        messages: [{ role: "user", content: user }],
      }),
    });
    const data: any = await res.json();
    const text = (data.content ?? []).map((c: any) => c.text ?? "").join("").replace(/```json|```/g, "").trim();
    return JSON.parse(text) as T;
  } catch (e) {
    console.error("[llm]", e);
    return null;
  }
}
