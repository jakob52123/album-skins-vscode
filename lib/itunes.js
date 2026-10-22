// Apple iTunes 公开接口：搜专辑、查专辑、换封面尺寸、下载。只用全局 fetch，不依赖 vscode。
'use strict';
const fs = require('fs');

const API = 'https://itunes.apple.com';

/** mzstatic 封面地址换尺寸和格式，例如 artworkUrl(url, 32, 'png')。 */
function artworkUrl(url, size, ext = 'jpg') {
  return url.replace(/\/\d+x\d+bb\.\w+$/, `/${size}x${size}bb.${ext}`);
}

const SINGLE = / - (Single|EP)$/;

function toAlbum(result) {
  return {
    itunesId: result.collectionId,
    title: result.collectionName,
    artist: result.artistName,
    year: Number(String(result.releaseDate || '').slice(0, 4)) || undefined,
    artwork: result.artworkUrl100,
    single: SINGLE.test(result.collectionName) || result.trackCount <= 3,
  };
}

/** iTunes 限流时返回纯文本「Rate limit exceeded」，不是 JSON；单独标出来好给用户说人话。 */
async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (response.status === 403 || response.status === 429 || /^rate limit/i.test(text)) {
    throw Object.assign(new Error('iTunes 限流'), { rateLimited: true });
  }
  if (!response.ok) throw new Error(`iTunes ${response.status}`);
  return JSON.parse(text);
}

/**
 * 搜专辑：专辑名、歌手、歌名都能搜。台区商店认简繁中文和常见昵称（霉霉、泰勒斯威夫特），也认英文。
 * 按专辑名搜，短词会搜出一堆同名冷门专辑；按歌名搜，iTunes 按热度排。所以两边轮流取一张，
 * 「晴天」的葉惠美、「十年」的黑.白.灰都能排到前面。整张专辑在单曲 / EP 前。
 * 按歌名命中的带上 song，好在列表里标「含《晴天》」。
 */
async function search(term, country = 'tw') {
  const [albumHits, songHits] = await Promise.all(['album', 'song'].map((entity) => {
    const query = new URLSearchParams({ term, entity, limit: '25', country });
    return getJson(`${API}/search?${query}`).then((json) => json.results);
  }));
  const byAlbum = albumHits.filter((r) => r.collectionType === 'Album').map(toAlbum);
  const bySong = songHits.filter((r) => r.kind === 'song' && r.collectionId).map((r) => ({ ...toAlbum(r), song: r.trackName }));
  const seen = new Set();
  const albums = [];
  for (let i = 0; i < Math.max(byAlbum.length, bySong.length); i++) {
    for (const album of [byAlbum[i], bySong[i]]) {
      const key = album && `${album.title}\u0000${album.artist}`;
      if (!album || seen.has(album.itunesId) || seen.has(key)) continue;
      seen.add(album.itunesId).add(key);
      albums.push(album);
    }
  }
  return [...albums.filter((a) => !a.single), ...albums.filter((a) => a.single)];
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
