// Apple iTunes 公开接口：搜专辑、查专辑、换封面尺寸、下载。只用全局 fetch，不依赖 vscode。
'use strict';
const fs = require('fs');

const API = 'https://itunes.apple.com';

/** mzstatic 封面地址换尺寸和格式，例如 artworkUrl(url, 32, 'png')。 */
function artworkUrl(url, size, ext = 'jpg') {
  return url.replace(/\/\d+x\d+bb\.\w+$/, `/${size}x${size}bb.${ext}`);
}

function toAlbum(result) {
  return {
    itunesId: result.collectionId,
    title: result.collectionName,
    artist: result.artistName,
    year: Number(String(result.releaseDate || '').slice(0, 4)) || undefined,
    artwork: result.artworkUrl100,
  };
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`iTunes ${response.status}`);
  return response.json();
}

/** 搜专辑：先查台区（中文名全），结果太少再补美区；按 collectionId 去重。 */
async function search(term, countries = ['tw', 'us']) {
  const seen = new Set();
  const albums = [];
  for (const country of countries) {
    const query = new URLSearchParams({ term, entity: 'album', limit: '25', country });
    const { results } = await getJson(`${API}/search?${query}`);
    for (const result of results) {
      if (result.collectionType !== 'Album' || seen.has(result.collectionId)) continue;
      seen.add(result.collectionId);
      albums.push(toAlbum(result));
    }
    if (albums.length >= 5) break;
  }
  return albums;
}

/** 按 collectionId 批量查封面地址。返回 Map(id → artworkUrl100)。 */
async function lookupArtwork(ids, country = 'tw') {
  const { results } = await getJson(`${API}/lookup?id=${ids.join(',')}&country=${country}`);
  return new Map(results.map((r) => [r.collectionId, r.artworkUrl100]));
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/** 下载到临时文件再改名，避免中途失败留下半张图。 */
async function download(url, target) {
  const temp = `${target}.part`;
  fs.writeFileSync(temp, await fetchBuffer(url));
  fs.renameSync(temp, target);
}

module.exports = { artworkUrl, search, lookupArtwork, fetchBuffer, download };
