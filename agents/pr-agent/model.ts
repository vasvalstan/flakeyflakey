import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai";
import { required } from "./config";

export function createCodingModel(configuration?: ChatOpenAIFields["configuration"]) {
  return new ChatOpenAI({
    model: process.env.PR_AGENT_MODEL ?? "gpt-6-astra",
    apiKey: required("OPENAI_API_KEY"),
    // Astra tool calls require Responses and a non-zero reasoning effort.
    useResponsesApi: true,
    reasoning: { effort: "low" },
    service_tier: "default",
    // Replay reasoning with tool results without storing Responses on OpenAI.
    modelKwargs: { store: false, include: ["reasoning.encrypted_content"] },
    maxTokens: 8192,
    maxRetries: 2,
    configuration,
  });
}
