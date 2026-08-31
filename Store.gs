/**
 * Store.gs — マスター／単元ファイルへのアクセス、権限、名簿、キャッシュ
 *
 * マスターファイル（1つ）
 *   単元 : 単元ID 教科 学年 単元名 ファイルID 更新日時
 *   授業 : 単元ID 授業名 順 公開 更新日時
 *   名簿 : メール 氏名
 *   教師 : メール
 *
 * 単元ファイル（単元ごと）
 *   _設定 : 授業名 テンプレートJSON 更新日時
 *   授業ごとに1シート : A更新日時 Bメール C氏名 D以降 入力欄
 */

var MASTER_ID = '';    // setUp が出力するIDを貼る（公開リポジトリには書かない）
var FOLDER_ID = '';    // 単元ファイルを入れるフォルダのID（公開リポジトリには書かない）

var M_UNIT    = '単元';
var M_LESSON  = '授業';
var M_ROSTER  = '名簿';
var M_TEACHER = '教師';
var CFG       = '_設定';
var ANS_HEAD  = ['更新日時', 'メール', '氏名', '取り上げ'];
var COL_FIELD = 5;   // 入力欄の列はここから始まる（A〜D は固定）
var CACHE_SEC = 30;      // 索引
var CACHE_LONG = 900;    // 名簿・教師・テンプレート（変更時に破棄する）

/* 1回の実行の中で同じものを何度も読まないための記憶。
   GASの実行は短命なので、実行が終われば消える。 */
var _MEMO = {};
function memo_(key, fn) {
  if (_MEMO[key] === undefined) _MEMO[key] = fn();
  return _MEMO[key];
}
function cache_() {
  try { return CacheService.getScriptCache(); } catch (e) { return null; }
}
function cacheGet_(key) {
  var c = cache_();
  if (!c) return null;
  var v = c.get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
function cachePut_(key, val, sec) {
  var c = cache_();
  if (!c) return;
  try { c.put(key, JSON.stringify(val), sec || CACHE_LONG); } catch (e) {}
}
function cacheDel_(key) {
  var c = cache_();
  if (c) { try { c.remove(key); } catch (e) {} }
  delete _MEMO[key];
}


// ===== セットアップ =============================================

function setUp() {
  var ss = MASTER_ID ? SpreadsheetApp.openById(MASTER_ID)
                     : SpreadsheetApp.create(APP_TITLE + '_マスター');
  if (!MASTER_ID) Logger.log('MASTER_ID に貼り付けてください: ' + ss.getId());
  mkSheet_(ss, M_UNIT,    ['単元ID','教科','学年','単元名','ファイルID','更新日時']);
  mkSheet_(ss, M_LESSON,  ['単元ID','授業名','順','公開','更新日時']);
  mkSheet_(ss, M_ROSTER,  ['メール','氏名']);
  mkSheet_(ss, M_TEACHER, ['メール']);

  var t = ss.getSheetByName(M_TEACHER);
  var me = Session.getActiveUser().getEmail();
  if (me && t.getLastRow() < 2) t.appendRow([me]);

  if (!FOLDER_ID) {
    var f = DriveApp.createFolder(APP_TITLE + '_単元');
    Logger.log('FOLDER_ID に貼り付けてください: ' + f.getId());
  }
  Logger.log('教師として登録: ' + me);
  return ss.getId();
}

function mkSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(header);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
  return sh;
}


// ===== 基本 =====================================================

function master_() {
  if (!MASTER_ID) throw new Error('MASTER_ID が未設定です。setUp() を実行してください。');
  return SpreadsheetApp.openById(MASTER_ID);
}

function msh_(name) {
  var s = master_().getSheetByName(name);
  if (!s) throw new Error('シート「' + name + '」がありません。setUp() を実行してください。');
  return s;
}

function whoAmI_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function fmtDate_(d) {
  return (d instanceof Date)
    ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'M/d H:mm') : String(d || '');
}

/** シート名に使えない文字を弾く。授業名はそのままシート名になる。 */
function checkName_(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) throw new Error('名前を入れてください。');
  if (s.length > 90) throw new Error('名前が長すぎます（90字まで）。');
  if (/[:\\\/\?\*\[\]]/.test(s)) throw new Error('名前に : \\ / ? * [ ] は使えません。');
  if (s.charAt(0) === '_') throw new Error('名前の先頭に _ は使えません。');
  return s;
}


// ===== 権限・名簿 ===============================================

/**
 * 教師の一覧。
 * キャッシュしない。シートに足したのに反映されず、
 * 「どこかを押して更新する」という手順を覚えさせることになるため。
 * 実行内の重複読みだけを避ける。
 */
function teachers_() {
  return memo_('teachers', function() {
    var t = msh_(M_TEACHER), out = [];
    if (t.getLastRow() >= 2) {
      var v = t.getRange(2, 1, t.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < v.length; i++) {
        var em = String(v[i][0]).trim().toLowerCase();
        if (em) out.push(em);
      }
    }
    return out;
  });
}

function isTeacher_(email) {
  if (!email) return false;
  return teachers_().indexOf(String(email).toLowerCase()) >= 0;
}

function requireTeacher_() {
  var me = whoAmI_();
  if (!isTeacher_(me)) throw new Error('この操作は先生のみ行えます。');
  return me;
}

/**
 * 名簿。
 * キャッシュしない。名簿に児童を足したのに氏名が古いまま出る、という状態を作らないため。
 * 保存のたびに1往復増えるが、「更新ボタンを押す」ことを覚えさせるより安い。
 */
function roster_() {
  return memo_('roster', function() {
    var r = msh_(M_ROSTER), out = [];
    if (r.getLastRow() >= 2) {
      var v = r.getRange(2, 1, r.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < v.length; i++) {
        var em = String(v[i][0]).trim();
        if (em) out.push({email: em, name: String(v[i][1] || em.split('@')[0])});
      }
    }
    return out;
  });
}

function nameOf_(email) {
  if (!email) return '';
  var r = roster_();
  for (var i = 0; i < r.length; i++)
    if (r[i].email.toLowerCase() === email.toLowerCase()) return r[i].name;
  return email.split('@')[0];
}


// ===== 索引（キャッシュ付き） ===================================

function cacheDrop_() {
  try { CacheService.getScriptCache().remove('idx'); } catch (e) {}
}

/** 単元と授業の一覧。35人が一斉に開いてもマスターを読み直さない。 */
function indexRaw_() {
  var c = null;
  try { c = CacheService.getScriptCache(); } catch (e) {}
  if (c) {
    var hit = c.get('idx');
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  }
  var us = readUnits_(), ls = readLessons_();
  var data = {units: us, lessons: ls};
  if (c) { try { c.put('idx', JSON.stringify(data), CACHE_SEC); } catch (e) {} }
  return data;
}

function readUnits_() {
  var sh = msh_(M_UNIT), out = [];
  if (sh.getLastRow() < 2) return out;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  for (var i = 0; i < v.length; i++) {
    if (!String(v[i][0]).trim()) continue;
    out.push({id: String(v[i][0]), subject: String(v[i][1]), grade: String(v[i][2]),
              name: String(v[i][3]), fileId: String(v[i][4]), row: i + 2});
  }
  return out;
}

function readLessons_() {
  var sh = msh_(M_LESSON), out = [];
  if (sh.getLastRow() < 2) return out;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  for (var i = 0; i < v.length; i++) {
    if (!String(v[i][0]).trim()) continue;
    out.push({unitId: String(v[i][0]), name: String(v[i][1]),
              ord: Number(v[i][2]) || 0, pub: String(v[i][3]),
              updated: fmtDate_(v[i][4]), row: i + 2});
  }
  out.sort(function(a, b){ return (a.ord - b.ord) || (a.row - b.row); });
  return out;
}

function unit_(unitId) {
  var u = indexRaw_().units;
  for (var i = 0; i < u.length; i++) if (u[i].id === unitId) return u[i];
  throw new Error('単元が見つかりません: ' + unitId);
}

function lesson_(unitId, name) {
  var l = indexRaw_().lessons;
  for (var i = 0; i < l.length; i++)
    if (l[i].unitId === unitId && l[i].name === name) return l[i];
  throw new Error('授業が見つかりません: ' + name);
}

/** 単元ファイル。openById は重いので、1回の実行では1回だけ開く。 */
function unitSS_(unitId) {
  return memo_('ss:' + unitId, function() {
    var u = unit_(unitId);
    try { return SpreadsheetApp.openById(u.fileId); }
    catch (e) {
      throw new Error('単元ファイル「' + u.name + '」を開けません。\n' +
        'ゴミ箱にあれば戻してください。消してしまった場合は、' +
        'マスターの「単元」シートからこの行を削除すると一覧から外れます。');
    }
  });
}

/** マスターの「授業」シートで、指定授業の行番号を取り直す（キャッシュを信用しない） */
function lessonRow_(unitId, name) {
  var sh = msh_(M_LESSON);
  if (sh.getLastRow() < 2) return 0;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < v.length; i++)
    if (String(v[i][0]) === unitId && String(v[i][1]) === name) return i + 2;
  return 0;
}

function unitRow_(unitId) {
  var sh = msh_(M_UNIT);
  if (sh.getLastRow() < 2) return 0;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]) === unitId) return i + 2;
  return 0;
}


// ===== 画面用 ===================================================

/** 児童＝公開中のみ／教師＝全件 */
function listIndex() {
  var teacher = isTeacher_(whoAmI_());
  var raw = indexRaw_(), umap = {};
  raw.units.forEach(function(u){ umap[u.id] = u; });
  var out = [];
  raw.lessons.forEach(function(l){
    var u = umap[l.unitId];
    if (!u) return;
    if (!teacher && !l.pub) return;
    out.push({unitId: u.id, unit: u.name, subject: u.subject, grade: u.grade,
              name: l.name, ord: l.ord, pub: l.pub, updated: l.updated});
  });
  return {teacher: teacher, units: raw.units, lessons: out};
}
