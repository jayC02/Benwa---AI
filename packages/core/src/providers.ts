import { env } from "./config.js";
import {
  DemoProvider,
  OpenAICompatibleProvider,
  type Provider,
} from "./provider.js";
import { GeminiRouter } from "./gemini/router.js";
export function realProvider(): Provider {
  return env.LLM_PROVIDER === "gemini"
    ? new GeminiRouter()
    : new OpenAICompatibleProvider();
}
export function configuredProvider(mode: string): Provider {
  return mode === "demo" ? new DemoProvider() : realProvider();
}
