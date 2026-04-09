import {
  SmartEmbedCustomOpenAIAdapter,
} from "smart-embed-model/adapters/custom_openai.js";

function clear_cached_models() {
  delete this.data.provider_models;
}

export class CustomOpenAIEmbeddingModelAdapter extends SmartEmbedCustomOpenAIAdapter {
  constructor(model_item) {
    super(model_item);
  }

  get http_adapter() {
    if (!this._http_adapter) {
      const HttpClass = this.model.env.config.modules.http_adapter.class;
      const http_params = { ...this.model.env.config.modules.http_adapter, class: undefined };
      this._http_adapter = new HttpClass(http_params);
    }
    return this._http_adapter;
  }
}

export const settings_config = {
  api_key: {
    name: "API Key",
    type: "password",
    description: "Enter the API key for your OpenAI-compatible embedding provider.",
    callback: clear_cached_models,
    rerender_on_change: true,
  },
  endpoint: {
    name: "Embeddings Endpoint",
    type: "text",
    description: "Full URL for the OpenAI-compatible `/v1/embeddings` endpoint.",
    callback: clear_cached_models,
    rerender_on_change: true,
  },
  models_endpoint: {
    name: "Models Endpoint",
    type: "text",
    description: "Full URL for the OpenAI-compatible `/v1/models` endpoint.",
    callback: clear_cached_models,
    rerender_on_change: true,
  },
  refresh_models: {
    name: "Refresh Models",
    type: "button",
    description: "Reload the available models from the configured provider.",
    callback: "adapter.refresh_models",
  },
  dimensions: {
    name: "Embedding Dimensions",
    type: "dropdown",
    description: "Select the embedding dimensions for OpenAI text-embedding-3 compatible models.",
    options_callback() {
      return [
        { value: "256", label: "256 (equivalent to ada using 'large' model)" },
        { value: "512", label: "512 (equivalent to ada using 'small' model)" },
        { value: "1536", label: "1536" },
        { value: "3072", label: "3072 (uses >10X more RAM/storage than 256)" },
      ];
    },
    default: "512",
  },
};

export default {
  class: CustomOpenAIEmbeddingModelAdapter,
  settings_config,
};
