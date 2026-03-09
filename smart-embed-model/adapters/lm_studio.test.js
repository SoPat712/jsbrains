import test from 'ava';

import {
  LmStudioEmbedModelAdapter,
  parse_lm_studio_models,
} from './lm_studio.js';

function create_model(data = {}) {
  return {
    data: {
      host: 'http://localhost:1234',
      api_key: '',
      model_key: 'text-embedding-nomic-embed-text-v1.5',
      ...data,
    },
    opts: {},
    re_render_settings() {},
  };
}

test('parse_lm_studio_models keeps only embedding-capable entries from native v1 model lists', (t) => {
  const parsed = parse_lm_studio_models({
    models: [
      {
        identifier: 'text-embedding-nomic-embed-text-v1.5',
        display_name: 'Nomic Embed',
        type: 'embedding',
        max_context_length: 8192,
      },
      {
        identifier: 'openai/gpt-oss-20b',
        display_name: 'GPT OSS',
        type: 'llm',
      },
    ],
  });

  t.deepEqual(Object.keys(parsed), ['text-embedding-nomic-embed-text-v1.5']);
  t.is(parsed['text-embedding-nomic-embed-text-v1.5'].name, 'Nomic Embed');
  t.is(parsed['text-embedding-nomic-embed-text-v1.5'].max_tokens, 8192);
});

test('LM Studio embedding adapter targets supported endpoints and optional auth headers', (t) => {
  const adapter = new LmStudioEmbedModelAdapter(create_model());
  const authed_adapter = new LmStudioEmbedModelAdapter(create_model({ api_key: 'secret-token' }));

  t.is(adapter.endpoint, 'http://localhost:1234/v1/embeddings');
  t.is(adapter.models_endpoint, 'http://localhost:1234/api/v1/models');
  t.deepEqual(adapter.prepare_request_headers(), {
    'Content-Type': 'application/json',
  });
  t.deepEqual(authed_adapter.prepare_request_headers(), {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer secret-token',
  });
});
