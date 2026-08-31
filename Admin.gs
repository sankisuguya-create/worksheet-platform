/**
 * Admin.gs — 単元・授業の作成／改名／削除／並べ替え／公開
 *
 * 授業名はマスターの「授業」シート・単元ファイルの「_設定」・シート名の3箇所にある。
 * 手で直すと不整合になるため、改名は必ず renameLesson を通す。
 */

// ===== 単元 =====================================================

function createUnit(meta) {
  requireTeacher_();
  var id = checkName_(meta && meta.id);
  readUnits_().forEach(function(u) {
    if (u.id === id) throw new Error('その単元IDは既にあります。');
  });

  var title = ((meta.grade || '') + ' ' + (meta.subject || '') + ' ' + (meta.name || id)).trim();
  var ss = SpreadsheetApp.create(title);
  if (FOLDER_ID) {
    try { DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(FOLDER_ID)); }
    catch (e) { /* フォルダ未設定でもマイドライブに残る */ }
  }
  var first = ss.getSheets()[0];
  first.setName(CFG);
  first.appendRow(['授業名', 'テンプレートJSON', '更新日時']);
  first.setFrozenRows(1);

  msh_(M_UNIT).appendRow([id, meta.subject || '', meta.grade || '',
                          meta.name || id, ss.getId(), new Date()]);
  cacheDrop_();
  return id;
}

function updateUnit(unitId, meta) {
  requireTeacher_();
  var row = unitRow_(unitId);
  if (!row) throw new Error('単元が見つかりません。');
  var sh = msh_(M_UNIT);
  sh.getRange(row, 2, 1, 3).setValues([[meta.subject || '', meta.grade || '', meta.name || unitId]]);
  sh.getRange(row, 6).setValue(new Date());
  cacheDrop_();
  return true;
}

/**
 * 単元を一覧から外す。
 * スプレッドシート本体は削除しない。誤操作でクラス全員の記録が消えるのを防ぐため、
 * ファイルはフォルダに残り、必要なら索引に行を足し直せば復帰できる。
 */
function unlinkUnit(unitId) {
  requireTeacher_();
  var row = unitRow_(unitId);
  if (!row) throw new Error('単元が見つかりません。');
  msh_(M_UNIT).deleteRow(row);

  var ls = msh_(M_LESSON);
  if (ls.getLastRow() >= 2) {
    var v = ls.getRange(2, 1, ls.getLastRow() - 1, 1).getValues();
    for (var i = v.length - 1; i >= 0; i--)
      if (String(v[i][0]) === unitId) ls.deleteRow(i + 2);
  }
  cacheDrop_();
  return true;
}


/** 単元IDは内部用。教師に考えさせず自動で振る。 */
function nextUnitId_() {
  var max = 0;
  readUnits_().forEach(function(u) {
    var m = /^u(\d+)$/.exec(u.id);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'u' + ('00' + (max + 1)).slice(-3);
}

/**
 * 授業をひとつ作る。単元が未指定なら、同じ教科・学年・単元名の単元を探し、
 * 無ければ新しく作る。教師の操作を「授業を作る」1回にまとめるための入口。
 */
function createLessonSmart(meta) {
  requireTeacher_();
  var unitId = String((meta && meta.unitId) || '').trim();

  if (!unitId) {
    var uname = String((meta && meta.unitName) || '').trim();
    if (!uname) throw new Error('単元名を入れてください。');
    var subject = String(meta.subject || '').trim();
    var grade = String(meta.grade || '').trim();
    readUnits_().forEach(function(u) {
      if (!unitId && u.name === uname && u.subject === subject && u.grade === grade) unitId = u.id;
    });
    if (!unitId)
      unitId = createUnit({id: nextUnitId_(), subject: subject, grade: grade, name: uname});
  }
  var name = createLesson(unitId, meta.name);
  return {unitId: unitId, name: name};
}

// ===== 授業 =====================================================

function createLesson(unitId, lessonName) {
  requireTeacher_();
  var name = checkName_(lessonName);
  var ss = unitSS_(unitId);
  if (ss.getSheetByName(name)) throw new Error('その授業名は既にあります。');

  ss.getSheetByName(CFG).appendRow([name, JSON.stringify(emptyTemplate_()), new Date()]);
  var sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, ANS_HEAD.length).setValues([ANS_HEAD]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(4);

  var ord = 0;
  readLessons_().forEach(function(l){ if (l.unitId === unitId) ord = Math.max(ord, l.ord); });
  msh_(M_LESSON).appendRow([unitId, name, ord + 10, '', new Date()]);
  cacheDrop_();
  return name;
}

/** 3箇所（シート名・_設定・マスター）を同時に書き換える。ここを通さないと不整合になる。 */
function renameLesson(unitId, oldName, newName) {
  requireTeacher_();
  var name = checkName_(newName);
  if (name === oldName) return name;

  var ss = unitSS_(unitId);
  if (ss.getSheetByName(name)) throw new Error('その授業名は既にあります。');
  var sh = ss.getSheetByName(oldName);
  if (!sh) throw new Error('授業シートがありません: ' + oldName);

  var cfg = ss.getSheetByName(CFG);
  if (cfg.getLastRow() >= 2) {
    var v = cfg.getRange(2, 1, cfg.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < v.length; i++)
      if (String(v[i][0]) === oldName) { cfg.getRange(i + 2, 1).setValue(name); break; }
  }
  sh.setName(name);

  var row = lessonRow_(unitId, oldName);
  if (row) msh_(M_LESSON).getRange(row, 2).setValue(name);
  cacheDrop_();
  return name;
}

/**
 * 授業を削除する。児童の回答も一緒に消えるため、呼ぶ前に必ず確認をとること。
 * シートはゴミ箱に入らないので、復旧はスプレッドシートの版履歴からになる。
 */
function deleteLesson(unitId, lessonName) {
  requireTeacher_();
  var ss = unitSS_(unitId);
  var sh = ss.getSheetByName(lessonName);
  if (sh) {
    if (ss.getSheets().length <= 1) throw new Error('単元ファイルの最後のシートは削除できません。');
    ss.deleteSheet(sh);
  }
  var cfg = ss.getSheetByName(CFG);
  if (cfg && cfg.getLastRow() >= 2) {
    var v = cfg.getRange(2, 1, cfg.getLastRow() - 1, 1).getValues();
    for (var i = v.length - 1; i >= 0; i--)
      if (String(v[i][0]) === lessonName) cfg.deleteRow(i + 2);
  }
  var row = lessonRow_(unitId, lessonName);
  if (row) msh_(M_LESSON).deleteRow(row);
  cacheDrop_();
  return true;
}

/** 単元内で1つ上／下へ動かす。dir は -1 か 1。 */
function moveLesson(unitId, lessonName, dir) {
  requireTeacher_();
  var list = readLessons_().filter(function(l){ return l.unitId === unitId; });
  var i = -1;
  for (var k = 0; k < list.length; k++) if (list[k].name === lessonName) i = k;
  if (i < 0) throw new Error('授業が見つかりません。');
  var j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= list.length) return false;

  var sh = msh_(M_LESSON);
  var a = lessonRow_(unitId, list[i].name), b = lessonRow_(unitId, list[j].name);
  var oa = list[i].ord, ob = list[j].ord;
  if (oa === ob) { oa = (i + 1) * 10; ob = (j + 1) * 10; }
  sh.getRange(a, 3).setValue(ob);
  sh.getRange(b, 3).setValue(oa);
  cacheDrop_();
  return true;
}

/** 公開状態。'' / '公開' / '今日'。「今日」は全体で1件だけ。 */
function setPublish(unitId, lessonName, state) {
  requireTeacher_();
  var sh = msh_(M_LESSON);
  var target = lessonRow_(unitId, lessonName);
  if (!target) throw new Error('授業が見つかりません。');

  if (state === '今日') {
    readLessons_().forEach(function(l) {
      if (l.pub === '今日' && !(l.unitId === unitId && l.name === lessonName)) {
        var r = lessonRow_(l.unitId, l.name);
        if (r) sh.getRange(r, 4).setValue('公開');
      }
    });
  }
  sh.getRange(target, 4, 1, 2).setValues([[state, new Date()]]);
  cacheDrop_();
  if (state) ensureRows_(unitId, lessonName);
  return true;
}

