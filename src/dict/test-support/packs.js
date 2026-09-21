/**
 * Test fixtures for the dictionary packs. Lives under src/dict/test-support so
 * it stays inside agent-reader's territory.
 */
import { gzipSync } from 'node:zlib';

export function word(id, kanji, kana, glosses, options = {}) {
  return {
    id: String(id),
    kanji: kanji ? kanji.map(function (k) {
      return { common: !!options.common, text: k, tags: options.tags || [] };
    }) : [],
    kana: kana ? kana.map(function (k) {
      return { common: !!options.common, text: k, tags: options.tags || [] };
    }) : [],
    sense: glosses.map(function (gloss) {
      return {
        partOfSpeech: options.pos || ['n'],
        gloss: [{ lang: 'eng', text: gloss }],
        field: [], misc: [], dialect: []
      };
    })
  };
}

export function pack(words, options = {}) {
  return {
    version: options.version || '3.6.2',
    dictDate: options.dictDate || '2026-09-14',
    commonOnly: !!options.commonOnly,
    languages: ['eng'],
    words: words
  };
}

export function gzipped(value) {
  return new Uint8Array(gzipSync(Buffer.from(JSON.stringify(value), 'utf8')));
}

export function plain(value) {
  return new Uint8Array(Buffer.from(JSON.stringify(value), 'utf8'));
}

/** A fetch stand-in that serves one body for any URL. */
export function fetchReturning(body, options = {}) {
  const calls = [];
  const impl = function (url) {
    calls.push(url);
    if (options.status && options.status !== 200) {
      return Promise.resolve(new Response('', { status: options.status }));
    }
    return Promise.resolve(new Response(body));
  };
  impl.calls = calls;
  return impl;
}

/** A fetch stand-in that serves a different body per URL. */
export function fetchMap(map) {
  return function (url) {
    if (Object.prototype.hasOwnProperty.call(map, url)) {
      return Promise.resolve(new Response(map[url]));
    }
    return Promise.resolve(new Response('', { status: 404 }));
  };
}
