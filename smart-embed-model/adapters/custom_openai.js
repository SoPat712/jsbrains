import { SmartEmbedOpenAIAdapter } from "./openai.js";

function get_model_id(model = {}) {
  return model.id || model.name || model.model || model.key || model.model_id || "";
}

export function model_supports_embeddings(model = {}) {
  const fields = [
    get_model_id(model),
    model.type,
    model.object,
    model.modality,
    model.input_modality,
    model.output_modality,
    model.task,
    model.capability,
    model.architecture?.type,
  ];
  const capabilities = Array.isArray(model.capabilities) ? model.capabilities : [];
  const methods = Array.isArray(model.supported_generation_methods) ? model.supported_generation_methods : [];
  const haystack = [...fields, ...capabilities, ...methods]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(" ");
  return haystack.includes("embed");
}

/**
 * Adapter for OpenAI-compatible embedding APIs with configurable endpoints.
 * Falls back to the built-in OpenAI model catalog when model discovery fails.
 */
export class SmartEmbedCustomOpenAIAdapter extends SmartEmbedOpenAIAdapter {
  static key = "custom_openai";

  static defaults = {
    ...SmartEmbedOpenAIAdapter.defaults,
    adapter: "custom_openai",
    description: "Custom (OpenAI)",
    endpoint: "https://api.openai.com/v1/embeddings",
    models_endpoint: "https://api.openai.com/v1/models",
  };

  get endpoint() {
    return this.model.data.endpoint || this.constructor.defaults.endpoint;
  }

  get models_endpoint() {
    return this.model.data.models_endpoint || this.constructor.defaults.models_endpoint;
  }

  build_fallback_models() {
    return Object.fromEntries(
      Object.entries(super.models).map(([id, model]) => [
        id,
        {
          ...model,
          adapter: this.constructor.key,
          endpoint: this.endpoint,
        },
      ])
    );
  }

  build_model_entry(model = {}) {
    const id = get_model_id(model);
    if (!id) return null;
    const fallback = this.build_fallback_models()[id] || {};
    const max_tokens = model.context_length
      || model.max_context_length
      || fallback.max_tokens
      || this.max_tokens
    ;
    return {
      id,
      name: model.display_name || model.name || fallback.name || id,
      model_name: id,
      dims: model.dimensions || model.embedding_dimension || fallback.dims,
      max_tokens,
      description: model.description || fallback.description || `OpenAI-compatible model: ${id}`,
      adapter: this.constructor.key,
      endpoint: this.endpoint,
    };
  }

  parse_model_data(model_data) {
    const list = Array.isArray(model_data?.data)
      ? model_data.data
      : Array.isArray(model_data)
        ? model_data
        : []
    ;
    if (!list.length) {
      return this.build_fallback_models();
    }

    const all_models = {};
    const embedding_models = {};
    for (const model of list) {
      const entry = this.build_model_entry(model);
      if (!entry) continue;
      all_models[entry.id] = entry;
      if (model_supports_embeddings(model)) {
        embedding_models[entry.id] = entry;
      }
    }

    if (Object.keys(embedding_models).length) {
      return embedding_models;
    }
    if (Object.keys(all_models).length) {
      return all_models;
    }
    return this.build_fallback_models();
  }

  async get_models(refresh = false) {
    if (!refresh && this.model.data.provider_models) {
      return this.model.data.provider_models;
    }

    try {
      const resp = await this.http_adapter.request({
        url: this.models_endpoint,
        method: "GET",
        headers: this.prepare_request_headers(),
      });
      const raw = await this.get_resp_json(resp);
      const parsed = this.parse_model_data(raw);
      this.model.data.provider_models = parsed;
      this.model.re_render_settings();
      return parsed;
    } catch (error) {
      console.error("[SmartEmbedCustomOpenAIAdapter] Failed to fetch models:", error);
      const fallback = this.build_fallback_models();
      this.model.data.provider_models = fallback;
      this.model.re_render_settings();
      return fallback;
    }
  }

  refresh_models() {
    delete this.model.data.provider_models;
    return this.get_models(true);
  }
}
