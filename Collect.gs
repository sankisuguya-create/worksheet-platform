/**
 * Collect.gs — 抽出集約
 *
 * 全児童の同じ欄だけを取り出して、1枚に並べたり順に投影したりするための土台。
 * D列「取り上げ」に押した順の番号を入れることで、
 * 「誰を取り上げるか」と「どの順で見せるか」を1つの操作にまとめている。
 */

/** 抽出画面が必要とするものを一度に返す。 */
function loadCollect(unitId, lessonName) {
  requireTeacher_();
  var ss = unitSS_(unitId);
  var tpl = getTemplate_(unitId, lessonName);
  var fields = templateFields_(tpl);
  var r = readLessonRows_(ss, lessonName, fields);
  var u = unit_(unitId);

  var rows = r.rows.map(function(x) {
    var vals = {};
    fields.forEach(function(f) {
      var v = x.data[f.id];
      if (v == null) v = '';
      if (Object.prototype.toString.call(v) === '[object Array]') v = v.join('、');
      vals[f.label] = String(v);
    });
    return {email: x.email, name: x.name, pick: x.pick,
            updated: x.updated, filled: x.filled, vals: vals};
  });

  return {
    meta: {unitId: u.id, unit: u.name, subject: u.subject, grade: u.grade, name: lessonName},
    fields: fields.map(function(f){ return f.label; }),
    total: fields.length,
    rows: rows
  };
}

/**
 * 取り上げる／やめる。押した順に 1,2,3… を振る。
 * 外したときは番号を詰め直すので、常に 1 から連番になる。
 */
function togglePick(unitId, lessonName, email, on) {
  requireTeacher_();
  var sh = unitSS_(unitId).getSheetByName(lessonName);
  if (!sh) throw new Error('授業シートがありません。');
  var last = sh.getLastRow();
  if (last < 2) return [];

  var v = sh.getRange(2, 2, last - 1, 3).getValues();   // B:メール C:氏名 D:取り上げ
  var cur = [];
  for (var i = 0; i < v.length; i++) {
    var em = String(v[i][0]).trim();
    if (!em) continue;
    var n = Number(v[i][2]) || 0;
    if (n > 0) cur.push({row: i + 2, email: em, n: n});
  }
  cur.sort(function(a, b){ return a.n - b.n; });

  var hit = -1;
  for (var j = 0; j < cur.length; j++)
    if (cur[j].email.toLowerCase() === String(email).toLowerCase()) hit = j;

  if (on && hit < 0) {
    var row = 0;
    for (var k = 0; k < v.length; k++)
      if (String(v[k][0]).trim().toLowerCase() === String(email).toLowerCase()) row = k + 2;
    if (!row) throw new Error('その児童の行が見つかりません。');
    cur.push({row: row, email: email, n: cur.length + 1});
  } else if (!on && hit >= 0) {
    cur.splice(hit, 1);
  } else {
    return picks_(cur);
  }

  // 1 から詰め直す
  var write = {};
  cur.forEach(function(p, i){ write[p.row] = i + 1; p.n = i + 1; });
  var all = sh.getRange(2, 4, last - 1, 1).getValues();
  for (var r2 = 0; r2 < all.length; r2++) all[r2][0] = write[r2 + 2] || '';
  sh.getRange(2, 4, last - 1, 1).setValues(all);

  return picks_(cur);
}

function picks_(cur) {
  return cur.map(function(p){ return {email: p.email, n: p.n}; });
}

/** 取り上げをすべて解除する。 */
function clearPicks(unitId, lessonName) {
  requireTeacher_();
  var sh = unitSS_(unitId).getSheetByName(lessonName);
  if (!sh) throw new Error('授業シートがありません。');
  var last = sh.getLastRow();
  if (last < 2) return true;
  var blank = [];
  for (var i = 0; i < last - 1; i++) blank.push(['']);
  sh.getRange(2, 4, last - 1, 1).setValues(blank);
  return true;
}
