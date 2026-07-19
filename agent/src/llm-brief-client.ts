import type { BriefClient, BriefInput, BriefReputationSnapshot } from "@quittance/core";
import { fakeBriefText } from "@quittance/core";

/**
 * Real `BriefClient` (SPEC-5) — produces a per-cycle AI verification brief via
 * an LLM. Env-gated: uses Anthropic (`ANTHROPIC_API_KEY`) when set, else Ollama
 * (`OLLAMA_HOST`); if neither is configured, falls back to the deterministic
 * `fakeBriefText` template so the agent still records a brief in environments
 * without an LLM (e.g. CI). No new npm dep — Node 20+ global `fetch`.
 *
 * The LLM only **narrates** — it never decides fund release (the quorum stays
 * deterministic, SPEC-4). The prompt is fixed-structure ("explain, don't
 * decide"). The brief is agent-attested narration, NOT cryptographic proof.
 */
export class LlmBriefClient implements BriefClient {
  private readonly anthropicKey: string | undefined;
  private readonly ollamaHost: string | undefined;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.anthropicKey = env.ANTHROPIC_API_KEY;
    this.ollamaHost = env.OLLAMA_HOST;
  }

  async brief(input: BriefInput): Promise<string> {
    const prompt = buildPrompt(input);
    if (this.anthropicKey) {
      return await this.briefAnthropic(prompt);
    }
    if (this.ollamaHost) {
      return await this.briefOllama(prompt);
    }
    // No LLM configured — deterministic fallback (CI / local without a key).
    return fakeBriefText(input);
  }

  private async briefAnthropic(prompt: string): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.anthropicKey as string,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-latest",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Anthropic brief failed: ${res.status}`);
    const json = (await res.json()) as { content?: Array<{ text?: string }> };
    const text = json.content?.[0]?.text;
    if (!text) throw new Error("Anthropic brief: empty response");
    return text;
  }

  private async briefOllama(prompt: string): Promise<string> {
    const host = (this.ollamaHost as string).replace(/\/$/, "");
    const res = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5:7b",
        stream: false,
        messages: [{ role: "user", content: prompt }],
      }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Ollama brief failed: ${res.status}`);
    const json = (await res.json()) as { message?: { content?: string } };
    const text = json.message?.content;
    if (!text) throw new Error("Ollama brief: empty response");
    return text;
  }
}

/**
 * Fixed-structure prompt for the per-cycle brief. Deterministic instructions
 * ("explain, don't decide") so the LLM's only freedom is prose, not the
 * settlement decision (which the chain already made cryptographically).
 */
function buildPrompt(input: BriefInput): string {
  const yes = input.verdicts.filter((v) => v.verdict.verdict === "yes").length;
  const no = input.verdicts.filter((v) => v.verdict.verdict === "no").length;
  const outcome = input.distributed
    ? "the contract verified each signature on-chain, the quorum was met, and funds were released pro-rata"
    : "the quorum was NOT met and the contract halted, releasing nothing";
  const reps = formatReps(input.reputationSnapshot);
  return [
    "You are the Quittance servicer agent. Write a 2-3 sentence verification brief",
    `for cycle ${input.cycleId} on asset ${input.assetId}.`,
    "",
    `Verdicts collected: ${yes} yes / ${no} no (of ${input.verdicts.length} signed).`,
    `Outcome: ${outcome}.`,
    reps ? `Verifier reputation (pre-cycle): ${reps}` : "",
    "",
    "Explain what the verifiers confirmed and why funds moved (or didn't).",
    "Do NOT decide or recommend; only explain the cryptographically verified record.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function formatReps(reps: BriefReputationSnapshot[]): string {
  if (reps.length === 0) return "";
  return reps
    .map((r) => `${r.signer} ${r.cyclesAgreed}/${r.cyclesVoted} voted`)
    .join("; ");
}