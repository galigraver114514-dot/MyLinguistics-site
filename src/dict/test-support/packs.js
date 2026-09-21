/**
 * Test fixtures for the dictionary packs. Lives under src/dict/test-support so
 * it stays inside agent-reader's territory.
 */
import { gzipSync } from 'node:zlib';
import { makeZip } from '../../test-support/zip-writer.js';

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


/* ---- Yomitan dictionary fixtures ---- */

export function yomitanIndex(overrides = {}) {
  return Object.assign({
    title: 'テスト辞典',
    revision: 'test;2026-01-01',
    format: 3,
    author: 'tests',
    description: 'a dictionary that exists only in this test'
  }, overrides);
}

/**
 * One term bank row, in Yomitan's positional format.
 * [term, reading, definitionTags, rules, score, glossary, sequence, termTags]
 */
export function yomitanRow(term, reading, glosses, options = {}) {
  return [
    term,
    reading || '',
    options.definitionTags || '',
    options.rules || '',
    options.score === undefined ? 0 : options.score,
    glosses,
    options.sequence === undefined ? 1 : options.sequence,
    options.termTags || ''
  ];
}

/**
 * A Yomitan dictionary zip.
 * @param {Array<Array>} banks one array of rows per term bank
 */
export function yomitanZip(banks, options = {}) {
  // options.index === null omits index.json entirely, which is how a zip that
  // is not a dictionary at all is built.
  const files = options.index === null
    ? []
    : [{ name: 'index.json', data: JSON.stringify(yomitanIndex(options.index)) }];
  banks.forEach(function (rows, i) {
    files.push({ name: 'term_bank_' + (i + 1) + '.json', data: JSON.stringify(rows) });
  });
  (options.tagBanks || []).forEach(function (tags, i) {
    files.push({ name: 'tag_bank_' + (i + 1) + '.json', data: JSON.stringify(tags) });
  });
  return makeZip(files);
}

/** A short structured-content glossary, the shape real dictionaries use. */
export function structuredGloss(reading, body) {
  return {
    type: 'structured-content',
    content: [
      { tag: 'span', data: { name: '見出部' }, content: [
        { tag: 'span', style: { fontWeight: 'bold' }, data: { name: '見出仮名' }, content: reading }
      ] },
      { tag: 'div', content: body }
    ]
  };
}

