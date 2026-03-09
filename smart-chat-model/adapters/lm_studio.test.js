import test from 'ava';

import {
  SmartChatModelLmStudioAdapter,
  SmartChatModelLmStudioRequestAdapter,
  SmartChatModelLmStudioResponseAdapter,
} from './lm_studio.js';

function create_model(data = {}) {
  const merged = {
    host: 'http://localhost:1234',
    api_key: '',
    model_key: 'openai/gpt-oss-20b',
    ...data,
  };
  return {
    api_key: merged.api_key,
    data: merged,
    opts: {},
    model_key: merged.model_key,
    re_render_settings() {},
  };
}

test('LM Studio uses native v1 chat request for simple user/system prompts', (t) => {
  const adapter = new SmartChatModelLmStudioAdapter(create_model());
  const request_adapter = new SmartChatModelLmStudioRequestAdapter(adapter, {
    model: 'openai/gpt-oss-20b',
    messages: [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hello there' },
    ],
    temperature: 0.2,
    max_tokens: 128,
  });

  const req = request_adapter.to_platform();
  const body = JSON.parse(req.body);

  t.is(adapter.last_request_mode, 'native');
  t.is(req.url, 'http://localhost:1234/api/v1/chat');
  t.deepEqual(req.headers, { 'Content-Type': 'application/json' });
  t.is(body.model, 'openai/gpt-oss-20b');
  t.is(body.input, 'Hello there');
  t.is(body.system_prompt, 'Be concise.');
  t.is(body.temperature, 0.2);
  t.is(body.max_tokens, 128);
  t.is(body.stream, false);
});

test('LM Studio falls back to OpenAI-compatible chat when tools are requested', (t) => {
  const adapter = new SmartChatModelLmStudioAdapter(create_model({ api_key: 'secret-token' }));
  const request_adapter = new SmartChatModelLmStudioRequestAdapter(adapter, {
    model: 'openai/gpt-oss-20b',
    messages: [
      { role: 'user', content: 'What is the weather in Boston?' },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Look up weather',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          },
        },
      },
    ],
    tool_choice: {
      type: 'function',
      function: { name: 'get_weather' },
    },
  });

  const req = request_adapter.to_platform();
  const body = JSON.parse(req.body);

  t.is(adapter.last_request_mode, 'compat');
  t.is(req.url, 'http://localhost:1234/v1/chat/completions');
  t.deepEqual(req.headers, {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer secret-token',
  });
  t.is(body.tool_choice, 'required');
  t.true(Array.isArray(body.messages[0].content));
  t.is(body.messages[0].content[1].text, 'Use the "get_weather" tool.');
});

test('LM Studio normalizes native v1 chat responses', (t) => {
  const adapter = new SmartChatModelLmStudioAdapter(create_model());
  adapter.last_request_mode = 'native';
  const response_adapter = new SmartChatModelLmStudioResponseAdapter(adapter, {
    id: 'resp_123',
    model: 'openai/gpt-oss-20b',
    output: [
      { type: 'text', text: 'Hello from LM Studio.' },
    ],
    stats: {
      prompt_tokens_count: 12,
      predicted_tokens_count: 7,
      total_tokens_count: 19,
      stop_reason: 'eosFound',
    },
  });

  const response = response_adapter.to_openai();

  t.is(response.id, 'resp_123');
  t.is(response.model, 'openai/gpt-oss-20b');
  t.is(response.choices[0].message.content, 'Hello from LM Studio.');
  t.is(response.choices[0].finish_reason, 'stop');
  t.deepEqual(response.usage, {
    prompt_tokens: 12,
    completion_tokens: 7,
    total_tokens: 19,
  });
});

test('LM Studio accumulates native stream events into an OpenAI-shaped response', (t) => {
  const adapter = new SmartChatModelLmStudioAdapter(create_model());
  adapter.last_request_mode = 'native';
  const response_adapter = new SmartChatModelLmStudioResponseAdapter(adapter);

  response_adapter.handle_chunk('event: chat.response.created\ndata: {"response_id":"resp_stream","model":"openai/gpt-oss-20b"}');
  response_adapter.handle_chunk('event: chat.message.delta\ndata: {"delta":"Hello"}');
  response_adapter.handle_chunk('event: chat.message.delta\ndata: {"delta":" world"}');
  response_adapter.handle_chunk('event: chat.end\ndata: {"stats":{"prompt_tokens_count":3,"predicted_tokens_count":2,"total_tokens_count":5,"stop_reason":"eosFound"}}');

  const response = response_adapter.to_openai();

  t.is(response.id, 'resp_stream');
  t.is(response.choices[0].message.content, 'Hello world');
  t.deepEqual(response.usage, {
    prompt_tokens: 3,
    completion_tokens: 2,
    total_tokens: 5,
  });
});
