/**
 * A built-in sample book, so the reader can be looked at before any file is
 * opened. The prose is written for this project; the ruby markup is real, so
 * it exercises authored-furigana rendering.
 */
export const SAMPLE_BOOK = {
  title: 'サンプル',
  author: 'MyLinguistics',
  chapters: [
    '<h2>一</h2>' +
    '<p><ruby>読書<rt>どくしょ</rt></ruby>という<ruby>行為<rt>こうい</rt></ruby>は、ただ<ruby>文字<rt>もじ</rt></ruby>を<ruby>追<rt>お</rt></ruby>うだけのものではない。</p>' +
    '<p><ruby>行間<rt>ぎょうかん</rt></ruby>に<ruby>沈<rt>しず</rt></ruby>む<ruby>記憶<rt>きおく</rt></ruby>や、かつて<ruby>見<rt>み</rt></ruby>た<ruby>風景<rt>ふうけい</rt></ruby>の<ruby>断片<rt>だんぺん</rt></ruby>が、<ruby>頁<rt>ページ</rt></ruby>を<ruby>繰<rt>く</rt></ruby>るたびに<ruby>呼<rt>よ</rt></ruby>び<ruby>起<rt>お</rt></ruby>こされる。</p>' +
    '<p><ruby>夏<rt>なつ</rt></ruby>の<ruby>午後<rt>ごご</rt></ruby>の<ruby>強<rt>つよ</rt></ruby>い<ruby>日差<rt>ひざ</rt></ruby>しが<ruby>障子<rt>しょうじ</rt></ruby><ruby>越<rt>ご</rt></ruby>しに<ruby>差<rt>さ</rt></ruby>し<ruby>込<rt>こ</rt></ruby>み、<ruby>畳<rt>たたみ</rt></ruby>の<ruby>上<rt>うえ</rt></ruby>に<ruby>淡<rt>あわ</rt></ruby>い<ruby>影<rt>かげ</rt></ruby>を<ruby>落<rt>お</rt></ruby>としていた。</p>' +
    '<p><ruby>私<rt>わたし</rt></ruby>は<ruby>古<rt>ふる</rt></ruby>い<ruby>文庫本<rt>ぶんこぼん</rt></ruby>を<ruby>片手<rt>かたて</rt></ruby>に、ゆっくりと<ruby>物語<rt>ものがたり</rt></ruby>の<ruby>世界<rt>せかい</rt></ruby>へ<ruby>歩<rt>あゆ</rt></ruby>みを<ruby>進<rt>すす</rt></ruby>めていく。</p>' +
    '<p>ページを送るたびに、縦書きの行が右から左へと流れていく。この動きに慣れてしまうと、横書きの文章がどこか落ち着かないものに感じられるから不思議だ。</p>' +

    '<h2>二</h2>' +
    '<p><ruby>言葉<rt>ことば</rt></ruby>を<ruby>覚<rt>おぼ</rt></ruby>えるということは、<ruby>単<rt>たん</rt></ruby>に<ruby>語彙<rt>ごい</rt></ruby>が<ruby>増<rt>ふ</rt></ruby>えることではない。</p>' +
    '<p>ある語が、どのような場面で使われ、どのような語と並び、どこで使ってはいけないのか。その<ruby>輪郭<rt>りんかく</rt></ruby>が少しずつ<ruby>鮮明<rt>せんめい</rt></ruby>になっていく過程こそが、<ruby>習得<rt>しゅうとく</rt></ruby>なのだと思う。</p>' +
    '<p><ruby>辞書<rt>じしょ</rt></ruby>を<ruby>引<rt>ひ</rt></ruby>いて<ruby>意味<rt>いみ</rt></ruby>を<ruby>知<rt>し</rt></ruby>った<ruby>瞬間<rt>しゅんかん</rt></ruby>は、まだ<ruby>入口<rt>いりぐち</rt></ruby>に<ruby>立<rt>た</rt></ruby>っただけだ。<ruby>本当<rt>ほんとう</rt></ruby>の<ruby>意味<rt>いみ</rt></ruby>は、いくつもの<ruby>文脈<rt>ぶんみゃく</rt></ruby>の<ruby>中<rt>なか</rt></ruby>でその<ruby>語<rt>ご</rt></ruby>に<ruby>出会<rt>であ</rt></ruby>い<ruby>直<rt>なお</rt></ruby>すうちに、<ruby>身体<rt>しんたい</rt></ruby>のほうで<ruby>理解<rt>りかい</rt></ruby>されていく。</p>' +
    '<p>だから読む量そのものが<ruby>引擎<rt>エンジン</rt></ruby>で、<ruby>復習<rt>ふくしゅう</rt></ruby>は<ruby>速度<rt>そくど</rt></ruby>を<ruby>保<rt>たも</rt></ruby>つためのものにすぎない。</p>'
  ],
  read(index) {
    return Promise.resolve(this.chapters[index] || '');
  }
};

export default { SAMPLE_BOOK };
