const nsfwKeys = ['Porn', 'Hentai', 'Sexy'];

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
  if (!settings.nsfwjsUrl) {
    return { checked: false, suspicious: false, reason: null };
  }

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
