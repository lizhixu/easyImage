const nsfwKeys = ['Porn', 'Hentai', 'Sexy'];
const sightengineNsfwKeys = ['sexual_activity', 'sexual_display', 'erotica', 'very_suggestive', 'suggestive'];

function endpointFor(baseUrl, imageUrl) {
  const value = String(baseUrl || '').trim();
  if (!value) return '';
  if (value.includes('{url}')) return value.replace('{url}', encodeURIComponent(imageUrl));

  const url = new URL(value);
  url.searchParams.set('url', imageUrl);
  return url.toString();
}

function findScores(payload) {
  if (Array.isArray(payload)) {
    const scores = {};
    for (const item of payload) {
      if (!item || typeof item !== 'object') continue;
      const className = item.className || item.class_name || item.name;
      const probability = item.probability ?? item.score;
      if (className && typeof probability === 'number') {
        scores[className] = probability;
      }
    }
    if (Object.keys(scores).length) return scores;
  }

  if (!payload || typeof payload !== 'object') return null;
  const hasScores = ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy'].some((key) => typeof payload[key] === 'number');
  if (hasScores) return payload;

  for (const value of Object.values(payload)) {
    const found = findScores(value);
    if (found) return found;
  }
  return null;
}

export async function classifyNsfwUrl(imageUrl, settings) {
  const provider = settings.nsfwProvider || 'nsfwjs';

  if (provider === 'none') {
    return { checked: false, suspicious: false, reason: null };
  }

  if (provider === 'sightengine') {
    if (!settings.sightengineApiUser || !settings.sightengineApiSecret) {
      return { checked: false, suspicious: false, reason: null };
    }
    return classifySightengineUrl(imageUrl, settings);
  }

  if (!settings.nsfwjsUrl) {
    return { checked: false, suspicious: false, reason: null };
  }

  return classifyNsfwjsUrl(imageUrl, settings);
}

async function classifyNsfwjsUrl(imageUrl, settings) {
  const endpoint = endpointFor(settings.nsfwjsUrl, imageUrl);
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(15000),
    headers: { accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`NSFWJS 请求失败：HTTP ${response.status}`);
  }

  const payload = await response.json();
  const scores = findScores(payload);
  if (!scores) {
    throw new Error('NSFWJS 返回格式无法识别');
  }

  const threshold = Number(settings.nsfwThreshold || 0.6);
  const hits = nsfwKeys
    .map((key) => [key, Number(scores[key] || 0)])
    .filter(([, score]) => score >= threshold)
    .sort((a, b) => b[1] - a[1]);

  if (!hits.length) {
    return { checked: true, suspicious: false, reason: null, scores };
  }

  const reason = hits.map(([key, score]) => `${key}=${score.toFixed(3)}`).join('；');
  return { checked: true, suspicious: true, reason: `NSFWJS 命中：${reason}`, scores };
}

function findSightengineScores(payload) {
  const nudity = payload?.nudity;
  if (!nudity || typeof nudity !== 'object') return null;

  const scores = {};
  for (const key of sightengineNsfwKeys) {
    const value = Number(nudity[key] || 0);
    if (Number.isFinite(value)) scores[key] = value;
  }

  if (!Object.keys(scores).length) return null;
  return scores;
}

async function classifySightengineUrl(imageUrl, settings) {
  const endpoint = new URL('https://api.sightengine.com/1.0/check.json');
  endpoint.searchParams.set('models', 'nudity-2.1');
  endpoint.searchParams.set('url', imageUrl);
  endpoint.searchParams.set('api_user', settings.sightengineApiUser);
  endpoint.searchParams.set('api_secret', settings.sightengineApiSecret);

  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(15000),
    headers: { accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Sightengine 请求失败：HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.status && payload.status !== 'success') {
    const message = payload.error?.message || payload.error || payload.status;
    throw new Error(`Sightengine 返回失败：${message}`);
  }

  const scores = findSightengineScores(payload);
  if (!scores) {
    throw new Error('Sightengine 返回格式无法识别');
  }

  const threshold = Number(settings.sightengineThreshold ?? settings.nsfwThreshold ?? 0.6);
  const hits = Object.entries(scores)
    .filter(([, score]) => score >= threshold)
    .sort((a, b) => b[1] - a[1]);

  if (!hits.length) {
    return { checked: true, suspicious: false, reason: null, scores };
  }

  const reason = hits.map(([key, score]) => `${key}=${score.toFixed(3)}`).join('；');
  return { checked: true, suspicious: true, reason: `Sightengine 命中：${reason}`, scores };
}
