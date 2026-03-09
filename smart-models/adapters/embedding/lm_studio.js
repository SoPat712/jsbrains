import {
  LmStudioEmbedModelAdapter,
} from "smart-embed-model/adapters/lm_studio.js";

export class LmStudioEmbeddingModelAdapter extends LmStudioEmbedModelAdapter {
  constructor(model_item) {
    super(model_item);
  }
  get http_adapter() {
    if (!this._http_adapter) {
      const HttpClass = this.model.env.config.modules.http_adapter.class;
      const http_params = {...this.model.env.config.modules.http_adapter, class: undefined};
      this._http_adapter = new HttpClass(http_params);
    }
    return this._http_adapter;
  }
}

export const settings_config = {
  host: {
    name: 'LM Studio host',
    type: 'text',
    description: 'Base URL for the LM Studio local server.',
    default: 'http://localhost:1234',
  },
  api_key: {
    name: 'API Key (optional)',
    type: 'password',
    description: 'Optional unless API authentication is enabled in LM Studio.',
  },
};

export default {
  class: LmStudioEmbeddingModelAdapter,
  settings_config,
};
