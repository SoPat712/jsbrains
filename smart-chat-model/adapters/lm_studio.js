import { SmartChatModelApiAdapter, SmartChatModelRequestAdapter, SmartChatModelResponseAdapter } from './_api.js';

function get_lm_studio_models_array(model_data) {
  if (Array.isArray(model_data?.models)) return model_data.models;
  if (Array.isArray(model_data?.data)) return model_data.data;
  return [];
}

function get_lm_studio_model_id(model = {}) {
  return model.id || model.identifier || model.key || model.model_id || '';
}

function get_text_content(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text')
    .map((part) => part.text || '')
    .join('\n');
}

function parse_json(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parse_stream_chunk(chunk) {
  const lines = chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  ;
  let event = '';
  const data_lines = [];

  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data_lines.push(line.slice(5).trim());
  }

  const raw_data = data_lines.join('\n');
  const parsed = parse_json(raw_data);
  if ((!event || event === 'message') && parsed?.event) {
    return {
      event: parsed.event,
      data: parsed.data || {},
    };
  }
  return {
    event,
    data: parsed || raw_data,
  };
}

function extract_native_output_text(output) {
  if (typeof output === 'string') return output;
  if (!Array.isArray(output)) return '';
  return output.map((part) => {
    if (typeof part === 'string') return part;
    if (typeof part?.text === 'string') return part.text;
    if (typeof part?.content === 'string') return part.content;
    if (Array.isArray(part?.content)) return extract_native_output_text(part.content);
    return '';
  }).join('');
}

/**
 * Adapter for LM Studio's native v1 REST API with a fallback to the
 * OpenAI-compatible endpoint when a request relies on features the native
 * endpoint does not support yet (assistant replay or custom tools).
 *
 * @class SmartChatModelLmStudioAdapter
 * @extends SmartChatModelApiAdapter
 */
export class SmartChatModelLmStudioAdapter extends SmartChatModelApiAdapter {
  static key = 'lm_studio';

  /** @type {import('./_adapter.js').SmartChatModelAdapter['constructor']['defaults']} */
  static defaults = {
    description: 'LM Studio (native v1)',
    type: 'API',
    host: 'http://localhost:1234',
    endpoint: '/api/v1/chat',
    compat_endpoint: '/v1/chat/completions',
    streaming: true,
    adapter: 'LM_Studio_V1',
    models_endpoint: '/api/v1/models',
    default_model: '',
    signup_url: 'https://lmstudio.ai/docs/app/api/rest-api',
  };

  /* ------------------------------------------------------------------ *
   *  Request / Response classes
   * ------------------------------------------------------------------ */

  get req_adapter () { return SmartChatModelLmStudioRequestAdapter; }
  get res_adapter () { return SmartChatModelLmStudioResponseAdapter; }

  /* ------------------------------------------------------------------ *
   *  Settings
   * ------------------------------------------------------------------ */

  /**
   * Extend the base settings with LM Studio-specific auth/host guidance.
   */
  get settings_config () {
    return {
      ...super.settings_config,
      '[CHAT_ADAPTER].host': {
        name: 'LM Studio host',
        type: 'text',
        description: 'Base URL for the LM Studio local server.',
        default: this.constructor.defaults.host,
      },
      '[CHAT_ADAPTER].api_key': {
        ...super.settings_config['[CHAT_ADAPTER].api_key'],
        name: 'API Key (optional)',
        description: 'Optional unless API authentication is enabled in LM Studio.',
      },
      '[CHAT_ADAPTER].cors_instructions': {
        name: 'CORS required',
        type: 'html',
        value:
          `<p>Before you can use LM Studio ` +
          `you must <strong>Enable CORS</strong> ` +
          `inside LM Studio → Developer → Settings</p>`,
      }
    };
  }

  /* ------------------------------------------------------------------ *
   *  Model list helpers
   * ------------------------------------------------------------------ */


  /**
   * LM Studio v1 returns a native model list; normalise to the project shape.
   */
  parse_model_data (model_data) {
    const models = get_lm_studio_models_array(model_data);
    if (models.length === 0) {
      return { _: { id: 'No models found.' } };
    }
    const out = {};
    for (const model of models) {
      const id = get_lm_studio_model_id(model);
      if (!id) continue;
      if (`${model.type || ''}`.toLowerCase().startsWith('embedding')) continue;
      const loaded = Array.isArray(model.loaded_instances) ? model.loaded_instances[0] : null;
      const max_input_tokens = loaded?.max_context_length
        || loaded?.loaded_context_length
        || model.max_context_length
        || model.loaded_context_length
      ;
      out[id] = {
        id,
        name: model.display_name || model.name || id,
        model_name: id,
        description: `LM Studio model: ${id}`,
        multimodal: false,
        ...(max_input_tokens ? { max_input_tokens } : {}),
      };
    }
    return Object.keys(out).length > 0 ? out : { _: { id: 'No models found.' } };
  }

  get host() {
    return this.model.data?.host || this.constructor.defaults.host;
  }

  get endpoint() {
    return `${this.host}${this.constructor.defaults.endpoint}`;
  }

  get compat_endpoint() {
    return `${this.host}${this.constructor.defaults.compat_endpoint}`;
  }

  get models_endpoint() {
    return `${this.host}${this.constructor.defaults.models_endpoint}`;
  }

  get configured_api_key() {
    return (this.model.api_key || this.model.data?.api_key || this.main.opts?.api_key || '').trim();
  }

  get models_endpoint_method () { return 'GET'; }

  get models_request_params() {
    return {
      url: this.models_endpoint,
      method: this.models_endpoint_method,
      headers: {
        ...(this.configured_api_key ? { Authorization: `Bearer ${this.configured_api_key}` } : {}),
      },
    };
  }

  /**
   * Count tokens in input text (no dedicated endpoint)
   * Rough estimate: 1 token ~ 4 chars
   * @param {string|Object} input
   * @returns {Promise<number>}
   */
  async count_tokens(input) {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    return Math.ceil(text.length / 4);
  }

  is_end_of_stream(event) {
    return event.data === 'data: [DONE]' || event.data.includes('chat.end');
  }

  /**
   * Load models even when auth is disabled and no API key is configured.
   * The native API allows unauthenticated access unless the user enables it.
   * @param {boolean} [refresh=false]
   * @returns {Promise<Object>}
   */
  async get_models(refresh = false) {
    if (!refresh && this.valid_model_data()) return this.model_data;

    try {
      const response = await this.http_adapter.request(this.models_request_params);
      const status = await response.status();
      if (status < 200 || status >= 300) {
        throw new Error(`LM Studio model request failed with status ${status}`);
      }
      this.model_data = this.parse_model_data(await response.json());
    } catch (error) {
      console.error('Failed to fetch LM Studio model data:', error);
      this.model_data = {};
    }

    this.model_data = await this.get_enriched_model_data();
    this.model_data_loaded_at = Date.now();
    if (this.model.data) {
      this.model.data.provider_models = this.model_data;
    }
    if (this.valid_model_data() && typeof this.model.re_render_settings === 'function') {
      setTimeout(() => {
        this.model.re_render_settings();
      }, 100);
    }
    return this.model_data;
  }

  /**
   * Test LM Studio authentication by requesting the models list.
   * @returns {Promise<boolean>}
   */
  async test_api_key() {
    try {
      const response = await this.http_adapter.request(this.models_request_params);
      const status = await response.status();
      return status >= 200 && status < 300;
    } catch {
      return false;
    }
  }

}

/**
 * Request adapter for LM Studio.
 * Uses the native v1 `/api/v1/chat` endpoint for plain chat and falls back to
 * `/v1/chat/completions` when the request depends on custom tools or assistant
 * messages, which native v1 does not currently accept.
 * @class SmartChatModelLmStudioRequestAdapter
 * @extends SmartChatModelRequestAdapter
 */
export class SmartChatModelLmStudioRequestAdapter extends SmartChatModelRequestAdapter {
  get_headers() {
    return {
      'Content-Type': 'application/json',
      ...(this.adapter.configured_api_key
        ? { Authorization: `Bearer ${this.adapter.configured_api_key}` }
        : {}),
    };
  }

  should_use_openai_compat() {
    if (Array.isArray(this.tools) && this.tools.length > 0) return true;
    if (this.tool_choice && this.tool_choice !== 'none') return true;

    const non_system_messages = this.messages.filter((message) => message.role !== 'system');
    if (non_system_messages.length !== 1 || non_system_messages[0]?.role !== 'user') {
      return true;
    }

    return this.messages.some((message) => {
      if (!['system', 'user'].includes(message.role)) return true;
      if (message.tool_calls?.length || message.tool_call_id || message.image_url) return true;
      if (!Array.isArray(message.content)) return false;
      return message.content.some((part) => part?.type !== 'text');
    });
  }

  to_platform (streaming = false) {
    if (this.should_use_openai_compat()) {
      this.adapter.last_request_mode = 'compat';
      return this.to_openai_compat(streaming);
    }

    this.adapter.last_request_mode = 'native';
    const system_prompt = this.messages
      .filter((message) => message.role === 'system')
      .map((message) => get_text_content(message.content))
      .filter(Boolean)
      .join('\n\n')
    ;
    const user_messages = this.messages.filter((message) => message.role === 'user');
    const user_message = user_messages[user_messages.length - 1];
    const body = {
      model: this.model_id,
      input: get_text_content(user_message?.content),
      stream: streaming,
    };

    if (system_prompt) body.system_prompt = system_prompt;
    if (typeof this.temperature === 'number') body.temperature = this.temperature;
    if (typeof this._req.max_tokens === 'number') body.max_tokens = this._req.max_tokens;
    if (typeof this.top_p === 'number') body.top_p = this.top_p;
    if (typeof this.presence_penalty === 'number') body.presence_penalty = this.presence_penalty;
    if (typeof this.frequency_penalty === 'number') body.frequency_penalty = this.frequency_penalty;
    if (typeof this._req.context_length === 'number') body.context_length = this._req.context_length;
    if (this._req.previous_response_id) body.previous_response_id = this._req.previous_response_id;

    return {
      url: this.adapter.endpoint,
      method: 'POST',
      headers: this.get_headers(),
      body: JSON.stringify(body),
    };
  }

  to_openai_compat(streaming = false) {
    const req = super.to_openai(streaming);
    const body = JSON.parse(req.body);

    if (this.tool_choice?.function?.name) {
      const last_msg = body.messages[body.messages.length - 1];
      if (typeof last_msg.content === 'string') {
        last_msg.content = [
          { type: 'text', text: last_msg.content }
        ];
      }
      last_msg.content.push({
        type: 'text',
        text: `Use the "${this.tool_choice.function.name}" tool.`
      });
      body.tool_choice = 'required';
    } else if (body.tool_choice && typeof body.tool_choice === 'object') {
      body.tool_choice = 'auto';
    }

    req.url = this.adapter.compat_endpoint;
    req.headers = this.get_headers();
    req.body = JSON.stringify(body);
    return req;
  }
}

/**
 * Response adapter for LM Studio.
 * Normalises both native v1 and OpenAI-compatible responses into the
 * project's OpenAI-shaped response format.
 * @class SmartChatModelLmStudioResponseAdapter
 * @extends SmartChatModelResponseAdapter
 */
export class SmartChatModelLmStudioResponseAdapter extends SmartChatModelResponseAdapter {
  static get native_platform_res() {
    return {
      id: '',
      model: '',
      output: [],
      output_text: '',
      stats: {},
    };
  }

  constructor(adapter, res, status = null) {
    const default_response = adapter.last_request_mode === 'compat'
      ? SmartChatModelResponseAdapter.platform_res
      : SmartChatModelLmStudioResponseAdapter.native_platform_res
    ;
    super(adapter, res || default_response, status);
  }

  get is_compat_response() {
    return Array.isArray(this._res?.choices);
  }

  get model_name() {
    return this._res.model || this._res.model_info?.identifier || this.adapter.model_key || '';
  }

  get output_text() {
    return this._res.output_text || extract_native_output_text(this._res.output);
  }

  get stop_reason() {
    return this._res.stats?.stop_reason || this._res.stop_reason || null;
  }

  to_openai() {
    if (this.error || this.is_compat_response) return super.to_openai();
    return {
      id: this._res.id || this._res.response_id || '',
      object: 'chat.completion',
      created: Date.now(),
      model: this.model_name,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: this.output_text,
          },
          finish_reason: this._get_openai_finish_reason(this.stop_reason),
        },
      ],
      usage: this._transform_usage_to_openai(),
      raw: this._res,
    };
  }

  handle_chunk(chunk) {
    if (chunk === 'data: [DONE]') return super.handle_chunk(chunk);

    const data_line = chunk.split(/\r?\n/).find((line) => line.startsWith('data: '));
    const compat_payload = data_line ? parse_json(data_line.slice(6)) : null;
    if (compat_payload?.choices || compat_payload?.object?.startsWith?.('chat.completion')) {
      return super.handle_chunk(chunk);
    }

    const { event, data } = parse_stream_chunk(chunk);
    if (!event) return;
    const payload = typeof data === 'object' && data !== null ? data : {};

    if (event === 'chat.response.created') {
      this._res.id = this._res.id || payload.response_id || payload.id || '';
      this._res.model = this._res.model || payload.model || payload.model_info?.identifier || '';
      if (payload.stats) this._res.stats = { ...this._res.stats, ...payload.stats };
      return;
    }

    if (event === 'chat.message.delta') {
      const delta = payload.delta || payload.content || payload.text || '';
      this._res.output_text += delta;
      return delta;
    }

    if (event === 'chat.end') {
      this._res.id = this._res.id || payload.response_id || payload.id || '';
      this._res.model = this._res.model || payload.model || payload.model_info?.identifier || '';
      if (payload.output) this._res.output = payload.output;
      if (payload.output_text && !this._res.output_text) this._res.output_text = payload.output_text;
      if (payload.stats) this._res.stats = { ...this._res.stats, ...payload.stats };
      return;
    }

    if (event === 'chat.error' || event === 'error') {
      this._res.error = payload.error || payload;
    }
  }

  _get_openai_finish_reason(reason) {
    const reason_map = {
      stop: 'stop',
      eosFound: 'stop',
      eos_found: 'stop',
      maxTokensReached: 'length',
      max_predicted_tokens_reached: 'length',
      length: 'length',
    };
    return reason_map[reason] || reason || 'stop';
  }

  _transform_usage_to_openai() {
    return {
      prompt_tokens: this._res.stats?.prompt_tokens_count || 0,
      completion_tokens: this._res.stats?.predicted_tokens_count || 0,
      total_tokens: this._res.stats?.total_tokens_count || 0,
    };
  }
}
