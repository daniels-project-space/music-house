import "server-only";
import { getSecret } from "./vault";

const API_BASE = "https://api.anthropic.com/v1/messages";

type CallOpts = {
  system?: string;
  user: string;
  model?: string;
  maxTokens?: number;
};

export async function callClaude({ system, user, model = "claude-sonnet-4-6", maxTokens = 1024 }: CallOpts): Promise<string> {
  const key = await getSecret("anthropic", "ANTHROPIC_API_KEY");
  const r = await fetch(API_BASE, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: user }],
      ...(system ? { system } : {}),
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j?.content?.[0]?.text ?? "";
}
