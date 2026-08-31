/**
 * Schema.gs — テンプレートのスキーマ版・検証・移行
 *
 * テンプレートは {v: 1, pages: [{objects: [...]}]} の形。
 * v を持たせておくことで、将来オブジェクト形式を変えたときに移行できる。
 *
 * サーバは入力欄の種類を知らない。
 * 複数選択かどうかはエディタがオブジェクトに multi:true を書き込むので、
 * サーバは o.multi を見るだけでよい。種類の定義はクライアントの registry.html に1本化されている。
 */

var SCHEMA_V = 1;

function emptyTemplate_() {
  return {v: SCHEMA_V, pages: [{objects: []}]};
}

/** 保存済みJSONを読み込む。壊れていれば黙って空にせず、はっきり失敗させる。 */
function parseTemplate_(json, where) {
  if (!json) return emptyTemplate_();
  var t;
  try { t = JSON.parse(json); }
  catch (e) {
    throw new Error('テンプレートが壊れています（' + (where || '') + '）。' +
                    '単元ファイルの _設定 シートで、その行のJSONを確認してください。');
  }
  return validateTemplate_(migrateTemplate_(t), where);
}

/** 古い版を現在の版へ引き上げる。 */
function migrateTemplate_(t) {
  if (!t || typeof t !== 'object') return emptyTemplate_();
  var v = Number(t.v) || 0;

  if (v < 1) {
    // v0: 表はセル設定を持たず、0行目が見出し・以降が記入欄という固定だった
    // v0: multi フラグが無い時代のテンプレート
    (t.pages || []).forEach(function(p) {
      (p.objects || []).forEach(function(o) {
        if (o.kind === 'in_check') o.multi = true;
      });
    });
    t.v = 1;
  }
  // 次の版を足すときはここに if (t.v < 2) { ... t.v = 2; } を追加する

  return t;
}

/** 最低限の構造検証。壊れたまま保存させない。 */
function validateTemplate_(t, where) {
  if (!t || typeof t !== 'object' || !t.pages || !t.pages.length)
    throw new Error('テンプレートの形が正しくありません（' + (where || '') + '）。');
  var ids = {};
  t.pages.forEach(function(p, pi) {
    if (!p || !(p.objects instanceof Array))
      throw new Error((pi + 1) + 'ページの中身が壊れています。');
    p.objects.forEach(function(o) {
      if (!o.id || !o.kind) throw new Error((pi + 1) + 'ページに壊れたオブジェクトがあります。');
      if (ids[o.id]) throw new Error('オブジェクトIDが重複しています: ' + o.id);
      ids[o.id] = 1;
      ['x','y','w','h'].forEach(function(k) {
        if (typeof o[k] !== 'number' || !isFinite(o[k])) o[k] = (k === 'x' || k === 'y') ? 0 : 100;
      });
    });
  });
  t.v = SCHEMA_V;
  return t;
}

/**
 * 集約対象の入力欄を、ページ順→上→左の順で列に展開する。
 * ラベルが重複したら連番を付けて一意にする（列の突き合わせにラベルを使うため）。
 */
function templateFields_(t) {
  var out = [], used = {}, n = 0;

  function put(id, label, multi) {
    n++;
    var base = String(label == null ? '' : label).trim() || ('問' + n);
    var lb = base, k = 2;
    while (used[lb]) lb = base + ' (' + (k++) + ')';
    used[lb] = 1;
    out.push({id: id, label: lb, multi: !!multi});
  }

  ((t && t.pages) || []).forEach(function(p) {
    var objs = (p.objects || []).slice();
    objs.sort(function(a, b){ return (a.y - b.y) || (a.x - b.x); });
    objs.forEach(function(o) {
      if (o.kind === 'table') {
        if (!o.collect) return;
        // 記入欄にしたセルだけが列になる。既定は0行目が見出し、以降が記入欄。
        var heads = o.heads || [], cells = o.cells || {};
        for (var r = 0; r < (o.rows || 1); r++) {
          for (var c = 0; c < (o.cols || 1); c++) {
            var d = cells[r + ',' + c];
            var t = (d && d.t) ? d.t : (r === 0 ? 'head' : 'input');
            if (t !== 'input') continue;
            put(o.id + ':' + r + ':' + c, (heads[c] || ('列' + (c + 1))) + '_' + r, false);
          }
        }
        return;
      }
      if (String(o.kind).indexOf('in_') !== 0 || !o.collect) return;
      put(o.id, o.label, o.multi);
    });
  });
  return out;
}
