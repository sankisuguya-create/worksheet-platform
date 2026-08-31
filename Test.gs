/**
 * Test.gs — 自動テスト
 *
 * GASのエディタで runTests を実行すると、結果がログに出る。
 * スプレッドシートに触らない純ロジックだけを対象にしているので、
 * 実行してもデータは一切変わらない。改修のたびに必ず走らせること。
 */

function runTests() {
  var r = {ok: 0, ng: 0, log: []};

  function eq(actual, expect, label) {
    var a = (typeof actual === 'object') ? JSON.stringify(actual) : String(actual);
    var b = (typeof expect === 'object') ? JSON.stringify(expect) : String(expect);
    if (a === b) { r.ok++; r.log.push('OK  ' + label); }
    else { r.ng++; r.log.push('NG  ' + label + '\n      got : ' + a + '\n      want: ' + b); }
  }
  function throws(fn, label) {
    try { fn(); r.ng++; r.log.push('NG  ' + label + '（エラーが出るはずが出なかった）'); }
    catch (e) { r.ok++; r.log.push('OK  ' + label); }
  }

  testSchema_(eq, throws);
  testFields_(eq);
  testRowToData_(eq);
  testAnsLine_(eq);
  testSyncHeader_(eq);
  testAnsColumns_(eq);
  testCheckName_(eq, throws);

  var head = (r.ng === 0)
    ? '全' + r.ok + '件 合格'
    : r.ng + '件 失敗 / ' + (r.ok + r.ng) + '件';
  var out = head + '\n' + r.log.join('\n');
  Logger.log(out);
  return out;
}


// ---- スキーマ ----
function testSchema_(eq, throws) {
  var t0 = {pages: [{objects: [{id: 'a', kind: 'in_check', x: 0, y: 0, w: 1, h: 1}]}]};
  var t1 = migrateTemplate_(t0);
  eq(t1.v, 1, 'v0 のテンプレートが v1 に上がる');
  eq(t1.pages[0].objects[0].multi, true, 'v0 移行で複数選択に multi が付く');

  throws(function(){ parseTemplate_('{壊れ', 'X'); }, '壊れたJSONははっきり失敗する');
  throws(function(){
    validateTemplate_({v:1, pages:[{objects:[{id:'a',kind:'text'},{id:'a',kind:'text'}]}]});
  }, 'オブジェクトIDの重複を弾く');

  var t2 = validateTemplate_({v:1, pages:[{objects:[{id:'a', kind:'text'}]}]});
  eq(t2.pages[0].objects[0].w, 100, '欠けた寸法が既定値で埋まる');
}


// ---- 集約列の抽出 ----
function fixture_() {
  return {v: 1, pages: [{objects: [
    {id:'b1', kind:'box',      x:0,   y:0,   w:1, h:1},
    {id:'q2', kind:'in_short', label:'名前',        collect:true,  x:100, y:300, w:1, h:1},
    {id:'q1', kind:'in_long',  label:'わかったこと', collect:true,  x:100, y:100, w:1, h:1},
    {id:'q4', kind:'in_check', label:'えらぶ',      collect:true,  multi:true,
                               options:['ア','イ'], x:100, y:400, w:1, h:1},
    {id:'q3', kind:'in_long',  label:'下書き',      collect:false, x:100, y:500, w:1, h:1},
    {id:'q5', kind:'in_short', label:'名前',        collect:true,  x:100, y:600, w:1, h:1},
    {id:'t1', kind:'table',    collect:true, rows:3, cols:2, heads:['回','結果'],
                               x:100, y:700, w:1, h:1}
  ]}]};
}

function testFields_(eq) {
  var f = templateFields_(fixture_());
  eq(f.length, 8, '集約列の数（入力欄4＋表セル4）');
  eq(f.map(function(x){ return x.label; }).join('|'),
     'わかったこと|名前|えらぶ|名前 (2)|回_1|結果_1|回_2|結果_2',
     '上から下へ並び、ラベル重複には連番が付く');
  eq(f[2].multi, true, '複数選択に multi が伝わる');
  eq(f[0].multi, false, '長文は multi ではない');
}


// ---- 展開列 → 回答 ----
function testRowToData_(eq) {
  var f = templateFields_(fixture_());
  var head = f.map(function(x){ return x.label; });
  var row = ['気体になる', 'たろう', 'ア, イ', 'たろう2', '1', 'ふえた', '2', 'へった'];
  var d = rowToData_(head, row, f);
  eq(d['q1'], '気体になる', '長文が復元される');
  eq(d['q4'], ['ア','イ'], '複数選択がカンマ区切りから配列に戻る');
  eq(d['t1:2:1'], 'へった', '表セルが復元される');

  var empty = rowToData_(head, ['','','','','','','',''], f);
  eq(empty['q4'], [], '空の複数選択は空配列');
  eq(empty['q1'], '', '空の長文は空文字');

  var shuffled = rowToData_(['名前','わかったこと'], ['はなこ','液体'], f);
  eq(shuffled['q1'], '液体', '列の順が違ってもラベルで正しく引ける');
}


// ---- 書き込む1行の組み立て ----
function testAnsLine_(eq) {
  var f = templateFields_(fixture_());
  var head = f.map(function(x){ return x.label; }).concat(['(削除)むかしの欄']);
  var line = buildAnsLine_(head, f, {q1:'水じょう気', q4:['イ'], 't1:1:0':'1'});
  eq(line[0], '水じょう気', '長文が入る');
  eq(line[2], 'イ', '配列がカンマ区切りになる');
  eq(line[8], null, 'テンプレートに無い列は null（既存値を残す合図）');
  eq(line[1], '', '未入力は空文字');
}


// ---- 列同期（疑似シート） ----
// A〜D の固定列と、E以降の入力欄の列を別々に持つ。
function FakeSheet_(head, rows) {
  this.fixed = ANS_HEAD.slice();
  this.h = head.slice();
  this.r = rows.map(function(x){ return x.slice(); });
}
FakeSheet_.prototype.getLastColumn = function(){ return (COL_FIELD - 1) + this.h.length; };
FakeSheet_.prototype.getLastRow    = function(){ return 1 + this.r.length; };
FakeSheet_.prototype.getRange = function(r, c, nr, nc) {
  var s = this, field = (c >= COL_FIELD);
  return {
    getValues: function() {
      if (r === 1) return [(field ? s.h : s.fixed).slice(c - (field ? COL_FIELD : 1),
                                                        c - (field ? COL_FIELD : 1) + nc)];
      var out = [];
      for (var i = 0; i < nr; i++)
        out.push(s.r[r - 2 + i].slice(c - COL_FIELD, c - COL_FIELD + nc));
      return out;
    },
    setValues: function(v) {
      if (r === 1) { if (field) s.h = v[0].slice(); else s.fixed = v[0].slice(); return this; }
      for (var i = 0; i < v.length; i++) s.r[r - 2 + i] = v[i].slice();
      return this;
    },
    setFontWeight: function(){ return this; }
  };
};
FakeSheet_.prototype.deleteColumns = function() {
  this.h = [];
  this.r = this.r.map(function(){ return []; });
};
FakeSheet_.prototype.insertColumnsAfter = function(after, n) {
  var blank = [];
  for (var i = 0; i < n; i++) blank.push('');
  this.h = blank.slice();
  this.r = this.r.map(function(){ return blank.slice(); });
};

function tplOf_(labels) {
  var objs = labels.map(function(lb, i) {
    return {id: 'f' + i, kind: 'in_short', label: lb, collect: true, x: 0, y: i * 100, w: 1, h: 1};
  });
  return {v: 1, pages: [{objects: objs}]};
}

function testSyncHeader_(eq) {
  var sheet = new FakeSheet_(['予想','結果'], [['ふえる','へった'], ['へる','ふえた']]);
  var ss = {getSheetByName: function(){ return sheet; }};

  syncHeader_(ss, 'L', tplOf_(['結果','予想','ふりかえり']));
  eq(sheet.h.join('|'), '結果|予想|ふりかえり', '列の追加と並べ替えが反映される');
  eq(sheet.r[0].join('|'), 'へった|ふえる|', '既存データがラベルで追従する');
  eq(sheet.fixed.join('|'), ANS_HEAD.join('|'), 'A〜Dの固定列は保たれる');

  syncHeader_(ss, 'L', tplOf_(['予想']));
  eq(sheet.h.join('|'), '予想|(削除)結果|(削除)ふりかえり', '削除した欄の列は保全される');
  eq(sheet.r[1].join('|'), 'へる|ふえた|', '削除後もデータは残る');

  var before = sheet.h.join('|');
  syncHeader_(ss, 'L', tplOf_(['予想']));
  eq(sheet.h.join('|'), before, '変化が無ければ列を作り直さない');
}

function testAnsColumns_(eq) {
  eq(COL_FIELD, 5, '入力欄はE列から始まる');
  eq(ANS_HEAD[3], '取り上げ', 'D列は取り上げの順番');
}


// ---- 名前の検証 ----
function testCheckName_(eq, throws) {
  eq(checkName_('  03 すがたの変化 '), '03 すがたの変化', '前後の空白を落とす');
  throws(function(){ checkName_(''); },          '空の名前を弾く');
  throws(function(){ checkName_('a/b'); },       'シート名に使えない文字を弾く');
  throws(function(){ checkName_('_設定'); },     '先頭のアンダースコアを弾く');
}
