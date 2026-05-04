exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  const GHL_TOKEN = 'pit-cb8ac95c-815c-4981-abd0-0a3d573a5f1d';
  const API = 'https://services.leadconnectorhq.com';

  const { path, params, method, body } = JSON.parse(event.body || '{}');
  if (!path) return { statusCode: 400, body: JSON.stringify({ error: 'path required' }) };

  const httpMethod = method || 'GET';

  // /opportunities/search usa snake_case (location_id, pipeline_id)
  // /contacts/ usa camelCase (locationId)
  function normalizeParams(obj, endpointPath) {
    if (!obj) return obj;
    const out = { ...obj };
    if (endpointPath.startsWith('/opportunities')) {
      if (out.locationId) { out.location_id = out.locationId; delete out.locationId; }
      if (out.pipelineId) { out.pipeline_id = out.pipelineId; delete out.pipelineId; }
    } else {
      if (out.location_id) { out.locationId = out.location_id; delete out.location_id; }
    }
    return out;
  }

  let url = `${API}${path}`;
  const normalizedParams = normalizeParams(params, path);
  const normalizedBody   = normalizeParams(body, path);

  let fetchOptions = {
    method: httpMethod,
    headers: {
      'Authorization': `Bearer ${GHL_TOKEN}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    }
  };

  if (httpMethod === 'GET' && normalizedParams) {
    url += '?' + new URLSearchParams(normalizedParams).toString();
  } else if (httpMethod === 'POST') {
    fetchOptions.body = JSON.stringify(normalizedBody || normalizedParams || {});
  }

  // Retry com exponential backoff para lidar com rate limit (429)
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 1000; // 1s, 2s, 4s, 8s, 16s

  async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt < retries; attempt++) {
      const resp = await fetch(url, options);

      if (resp.status !== 429) {
        return resp;
      }

      // Verifica se a API enviou um Retry-After header
      const retryAfter = resp.headers.get('Retry-After');
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : BASE_DELAY_MS * Math.pow(2, attempt);

      console.log(`[ghl] 429 recebido. Tentativa ${attempt + 1}/${retries}. Aguardando ${waitMs}ms...`);
      await sleep(waitMs);
    }

    // Após esgotar retries, retorna o último 429
    return fetch(url, options);
  }

  try {
    const resp = await fetchWithRetry(url, fetchOptions);
    const data = await resp.json();
    return {
      statusCode: resp.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(data)
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
