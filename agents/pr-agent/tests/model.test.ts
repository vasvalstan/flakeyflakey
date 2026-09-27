import { afterEach, beforeEach, expect, test } from "bun:test";
import { createDeepAgent } from "deepagents";
import { tool, toolStrategy } from "langchain";
import { z } from "zod";
import { decisionSchema, type Decision } from "../coder";
import { createCodingModel } from "../model";

const previous = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, PR_AGENT_MODEL: process.env.PR_AGENT_MODEL };
beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.PR_AGENT_MODEL;
});
afterEach(() => {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test("Astra executes a tool and returns a structured decision through Responses", async () => {
  const requests: { url: string; body: any }[] = [];
  let inspected = false;
  const decision: Decision = { action: "stop", title: "Already fixed", summary: "The repository already contains the fix.", reply: "No changes needed." };
  const model = createCodingModel({
    baseURL: "https://api.openai.com/v1",
    fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push({ url: String(url), body });
      const number = requests.length;
      if (number > 2) throw new Error("Unexpected additional model request");
      const decisionTool = body.tools.find((entry: any) => entry.parameters?.properties?.action?.enum?.includes("publish"));
      expect(decisionTool).toBeDefined();
      return Response.json({
        id: `resp_${number}`, object: "response", created_at: 1, status: "completed", model: "gpt-6-astra",
        error: null, incomplete_details: null,
        output: [
          { type: "reasoning", id: `rs_${number}`, summary: [], encrypted_content: `test-reasoning-${number}` },
          { type: "function_call", id: `fc_${number}`, call_id: `call_${number}`, status: "completed",
            name: number === 1 ? "inspect_repository" : decisionTool.name,
            arguments: JSON.stringify(number === 1 ? {} : decision) },
        ],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
          input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 5 } },
      });
    },
  });
  const agent = createDeepAgent({
    model,
    tools: [tool(async () => { inspected = true; return "Fix already present"; }, {
      name: "inspect_repository", description: "Inspect the test repository", schema: z.object({}),
    })],
    responseFormat: toolStrategy(decisionSchema),
  });
  const result = await agent.invoke({ messages: [{ role: "user", content: "Inspect the repository and decide whether it needs a fix." }] }, { recursionLimit: 10 });

  expect(inspected).toBe(true);
  expect(result.structuredResponse).toEqual(decision);
  expect(requests).toHaveLength(2);
  for (const { url, body } of requests) {
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(body.model).toBe("gpt-6-astra");
    expect(body.reasoning.effort).toBe("low");
    expect(body.max_output_tokens).toBe(8192);
    expect(body.service_tier).toBe("default");
    expect(body.store).toBe(false);
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
    for (const unsupported of ["temperature", "top_p", "top_logprobs", "logprobs", "max_tokens", "prompt_cache_retention"]) {
      expect(body).not.toHaveProperty(unsupported);
    }
  }
  const continuation = requests[1]!.body.input;
  expect(continuation).toContainEqual(expect.objectContaining({ type: "function_call_output", call_id: "call_1", output: "Fix already present" }));
  expect(continuation).toContainEqual(expect.objectContaining({ type: "reasoning", encrypted_content: "test-reasoning-1" }));
});
