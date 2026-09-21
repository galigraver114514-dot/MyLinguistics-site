/* MyLinguistics - the Japanese seed.
 *
 * Japanese only, and no English anywhere: readings are kana and parts of
 * speech are Japanese. Definitions live in src/lexicon/seed-ja.js for now;
 * the shared dictionary module (src/dict) becomes the source when it lands.
 */
window.ML_DATA = (function () {
  'use strict';

  var VOCAB = [
    { id: 'ja-001', term: 'こんにちは', reading: 'こんにちは', tag: '挨拶', example: 'こんにちは、田中さん。' },
    { id: 'ja-002', term: 'ありがとう', reading: 'ありがとう', tag: '挨拶', example: '手伝ってくれてありがとう。' },
    { id: 'ja-003', term: 'お願いします', reading: 'おねがいします', tag: '表現', example: 'コーヒーをお願いします。' },
    { id: 'ja-004', term: '水', reading: 'みず', tag: '名詞', example: '水を一杯ください。' },
    { id: 'ja-005', term: '本', reading: 'ほん', tag: '名詞', example: '毎日本を読みます。' },
    { id: 'ja-006', term: '家', reading: 'いえ', tag: '名詞', example: '家に帰ります。' },
    { id: 'ja-007', term: '食べる', reading: 'たべる', tag: '動詞', example: '朝ごはんを食べます。' },
    { id: 'ja-008', term: '話す', reading: 'はなす', tag: '動詞', example: '日本語を少し話します。' },
    { id: 'ja-009', term: '学ぶ', reading: 'まなぶ', tag: '動詞', example: '毎日新しい言葉を学びます。' },
    { id: 'ja-010', term: 'おはようございます', reading: 'おはようございます', tag: '挨拶', example: 'おはようございます、先生。' },
    { id: 'ja-011', term: '都市', reading: 'とし', tag: '名詞', example: '東京は大きな都市です。' },
    { id: 'ja-012', term: '時間', reading: 'じかん', tag: '名詞', example: '今日は時間がありません。' },
    { id: 'ja-013', term: 'いつも', reading: 'いつも', tag: '副詞', example: 'いつも朝に勉強します。' },
    { id: 'ja-014', term: '時々', reading: 'ときどき', tag: '副詞', example: '時々音楽を聞きます。' },
    { id: 'ja-015', term: '分かる', reading: 'わかる', tag: '動詞', example: 'この文が分かりません。' },
    { id: 'ja-016', term: '覚える', reading: 'おぼえる', tag: '動詞', example: '名前を覚えていますか。' },
    { id: 'ja-017', term: '週', reading: 'しゅう', tag: '名詞', example: '来週は試験があります。' },
    { id: 'ja-018', term: 'しかし', reading: 'しかし', tag: '接続詞', example: '難しいです。しかし、面白いです。' }
  ];

  return { vocab: VOCAB };
})();
