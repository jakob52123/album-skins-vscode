'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { search } = require('./itunes');

const album = (id, name, artist, trackCount = 10) => ({ collectionType: 'Album', collectionId: id, collectionName: name, artistName: artist, trackCount, artworkUrl100: 'x/100x100bb.jpg', releaseDate: '2003-07-31' });
const song = (id, name, artist, track, trackCount = 10) => ({ ...album(id, name, artist, trackCount), collectionType: undefined, kind: 'song', trackName: track });

function mockFetch(byEntity) {
  const calls = [];
  global.fetch = async (url) => {
    const entity = new URL(url).searchParams.get('entity');
    calls.push(entity);
    const body = byEntity[entity];
    return typeof body === 'string'
      ? { ok: true, status: 200, text: async () => body }
      : { ok: true, status: 200, text: async () => JSON.stringify({ results: body }) };
  };
  return calls;
}

test('按专辑名和歌名一起搜，轮流取；按歌名命中的带 song', async () => {
  const calls = mockFetch({
    album: [album(1, '晴天 - Single', '甲', 1), album(2, '本日は晴天なり', '乙'), album(3, '晴天雨', '丙')],
    song: [song(535824731, '葉惠美', '周杰倫', '晴天'), song(9, '2004 無與倫比演唱會 (Live)', '周杰倫', '晴天 (Live)', 20)],
  });
  const result = await search('晴天');
  assert.deepStrictEqual(calls.sort(), ['album', 'song']);
  assert.deepStrictEqual(result.map((a) => a.title), ['葉惠美', '本日は晴天なり', '2004 無與倫比演唱會 (Live)', '晴天雨', '晴天 - Single']);
  assert.strictEqual(result[0].song, '晴天');
  assert.strictEqual(result[0].year, 2003);
  assert.strictEqual(result[1].song, undefined);
});

test('同一张专辑两边都命中只出现一次，同名同歌手的重复版本也去掉', async () => {
  mockFetch({
    album: [album(1, 'Lover', 'Taylor Swift'), album(2, 'Lover', 'Taylor Swift')],
    song: [song(1, 'Lover', 'Taylor Swift', 'Lover'), song(3, 'reputation', 'Taylor Swift', 'Delicate')],
  });
  assert.deepStrictEqual((await search('霉霉')).map((a) => a.itunesId), [1, 3]);
});

test('单曲和 EP 排到整张专辑后面', async () => {
  mockFetch({ album: [album(1, '十年 - EP', '甲', 4), album(2, '十年', '乙', 2), album(3, '黑.白.灰', '陳奕迅')], song: [] });
  assert.deepStrictEqual((await search('十年')).map((a) => a.itunesId), [3, 1, 2]);
});

test('限流时报 rateLimited，好给用户说人话', async () => {
  mockFetch({ album: 'Rate limit exceeded', song: [] });
  await assert.rejects(search('x'), (error) => error.rateLimited === true);
});
