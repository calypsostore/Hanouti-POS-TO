const RELEASE_MANIFEST_URL = 'https://github.com/calypsostore/Hanouti-POS-TO/releases/latest/download/version.json';

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET, OPTIONS');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const upstream = await globalThis.fetch(RELEASE_MANIFEST_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!upstream.ok) {
      response.status(upstream.status).json({ error: `GitHub returned ${upstream.status} for the APK update manifest.` });
      return;
    }
    response.status(200).json(await upstream.json());
  } catch (error) {
    globalThis.console.error('[updates] Could not fetch the GitHub APK update manifest.', error);
    response.status(502).json({ error: 'Could not fetch the APK update manifest.' });
  }
}
