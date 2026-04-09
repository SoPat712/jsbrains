import test from "ava";

import {
  SmartEmbedCustomOpenAIAdapter,
  model_supports_embeddings,
} from "./custom_openai.js";

function create_model(data = {}) {
  return {
    data: {
      endpoint: "https://example.com/v1/embeddings",
      models_endpoint: "https://example.com/v1/models",
      api_key: "",
      model_key: "text-embedding-3-small",
      ...data,
    },
    opts: {},
    re_render_settings() {},
  };
}

test("model_supports_embeddings detects OpenAI-compatible embedding metadata", (t) => {
  t.true(model_supports_embeddings({ id: "text-embedding-3-small" }));
  t.true(model_supports_embeddings({ id: "vendor/model", capabilities: ["embeddings"] }));
  t.false(model_supports_embeddings({ id: "gpt-4.1-mini", capabilities: ["chat.completions"] }));
});

test("Custom OpenAI adapter respects configured endpoints", (t) => {
  const adapter = new SmartEmbedCustomOpenAIAdapter(create_model());

  t.is(adapter.endpoint, "https://example.com/v1/embeddings");
  t.is(adapter.models_endpoint, "https://example.com/v1/models");
});

test("Custom OpenAI adapter prefers embedding-like models from model discovery", (t) => {
  const adapter = new SmartEmbedCustomOpenAIAdapter(create_model());
  const parsed = adapter.parse_model_data({
    data: [
      { id: "gpt-4.1-mini", type: "chat" },
      { id: "text-embedding-3-small", type: "embedding" },
    ],
  });

  t.deepEqual(Object.keys(parsed), ["text-embedding-3-small"]);
  t.is(parsed["text-embedding-3-small"].adapter, "custom_openai");
  t.is(parsed["text-embedding-3-small"].endpoint, "https://example.com/v1/embeddings");
});

test("Custom OpenAI adapter falls back to all discovered models when embedding metadata is missing", (t) => {
  const adapter = new SmartEmbedCustomOpenAIAdapter(create_model());
  const parsed = adapter.parse_model_data({
    data: [
      { id: "custom-embed-large" },
      { id: "custom-embed-small" },
    ],
  });

  t.deepEqual(Object.keys(parsed), ["custom-embed-large", "custom-embed-small"]);
});
