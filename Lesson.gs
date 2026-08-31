/**
 * Lesson.gs — テンプレート、回答、列同期
 *
 * 授業シートが回答の正本である。
 *   A 更新日時 / B メール / C 氏名 / D 取り上げ / E以降 入力欄（1行目がラベル）
 *
 * D「取り上げ」は授業で見せる順番。教師が一覧で押した順に 1,2,3… が入る。
 * 選抜と並び順を1列で兼ねているので、教師の操作が1つで済む。
 * 入力欄の列は COL_FIELD（=5）から始まり、列を作り直しても D は動かさない。
 */

// ===== テンプレート =============================================

function tplKey_(unitId, lessonName){ return 'tpl:' + unitId + ':' + lessonName; }
function headKey_(unitId, lessonName){ return 'head:' + unitId + ':' + lessonName; }

/**
 * テンプレート。児童が保存するたびに _設定 を読み直すと往復が1回増えるので、
 * キャッシュしてある。saveTemplate で破棄されるため、
 * 教師が紙面を直したときの反映は「次に開いたとき」になる。
 * 授業中に紙面を変える運用は想定していない。
 */
function getTemplate_(unitId, lessonName) {
  var key = tplKey_(unitId, lessonName);
  return memo_(key, function() {
    var hit = cacheGet_(key);
    if (hit) return migrateTemplate_(hit);
    var cfg = unitSS_(unitId).getSheetByName(CFG);
    var out = emptyTemplate_();
    if (cfg && cfg.getLastRow() >= 2) {
      var v = cfg.getRange(2, 1, cfg.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < v.length; i++)
        if (String(v[i][0]) === lessonName) { out = parseTemplate_(v[i][1], lessonName); break; }
    }
    cachePut_(key, out);
    return out;
  });
}

/** 入力欄の列見出し。変わるのは syncHeader_ のときだけなので、そこで破棄する。 */
function getHead_(ss, unitId, lessonName) {
  var key = headKey_(unitId, lessonName);
  return memo_(key, function() {
    var hit = cacheGet_(key);
    if (hit) return hit;
    var sh = ss.getSheetByName(lessonName);
    var out = sh ? readHead_(sh) : [];
    cachePut_(key, out);
    return out;
  });
}

function saveTemplate(unitId, lessonName, template) {
  requireTeacher_();
  var t = validateTemplate_(migrateTemplate_(template), lessonName);
  var json = JSON.stringify(t);
  if (json.length > 49000)
    throw new Error('テンプレートが大きすぎます（' + json.length + '字）。ページを分けてください。');

  var ss = unitSS_(unitId), cfg = ss.getSheetByName(CFG), row = 0;
  if (cfg.getLastRow() >= 2) {
    var v = cfg.getRange(2, 1, cfg.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < v.length; i++) if (String(v[i][0]) === lessonName) { row = i + 2; break; }
  }
  if (row) cfg.getRange(row, 2, 1, 2).setValues([[json, new Date()]]);
  else cfg.appendRow([lessonName, json, new Date()]);

  cacheDel_(tplKey_(unitId, lessonName));
  cacheDel_(headKey_(unitId, lessonName));
  syncHeader_(ss, lessonName, t);
  cacheDel_(headKey_(unitId, lessonName));
  return {size: json.length, warn: json.length > 40000};
}


// ===== 列同期 ===================================================

function fieldColCount_(sh) {
  return Math.max(0, sh.getLastColumn() - (COL_FIELD - 1));
}

function readHead_(sh) {
  var n = fieldColCount_(sh);
  return n ? sh.getRange(1, COL_FIELD, 1, n).getValues()[0].map(String) : [];
}

/**
 * テンプレートから授業シートの入力欄の列を作り直す。
 * 既存データはラベルで突き合わせて引き継ぐので、追加・並べ替えでは失われない。
 * 削除された入力欄の列は「(削除)ラベル」として残す。消すと復旧できないため。
 * A〜D の固定列には触らない。
 */
function syncHeader_(ss, lessonName, template) {
  var sh = ss.getSheetByName(lessonName);
  if (!sh) return;

  // 固定列の見出しを整えておく（古いシートに D が無い場合の保険）
  sh.getRange(1, 1, 1, ANS_HEAD.length).setValues([ANS_HEAD]).setFontWeight('bold');

  var want = templateFields_(template).map(function(f){ return f.label; });
  var lastRow = sh.getLastRow();
  var old = readHead_(sh);

  var keep = [];
  old.forEach(function(lb) {
    if (!lb) return;
    var raw = lb.replace(/^\(削除\)/, '');
    if (want.indexOf(raw) < 0 && keep.indexOf('(削除)' + raw) < 0) keep.push('(削除)' + raw);
  });
  var head = want.concat(keep);
  if (head.join('\u0001') === old.join('\u0001')) return;   // 変化なし

  var body = [];
  if (lastRow >= 2) {
    var data = old.length ? sh.getRange(2, COL_FIELD, lastRow - 1, old.length).getValues() : [];
    for (var r = 0; r < lastRow - 1; r++) {
      var m = {}, src = data[r] || [];
      old.forEach(function(lb, i){ m[String(lb).replace(/^\(削除\)/, '')] = src[i]; });
      body.push(head.map(function(lb) {
        var v = m[lb.replace(/^\(削除\)/, '')];
        return v == null ? '' : v;
      }));
    }
  }

  if (old.length) sh.deleteColumns(COL_FIELD, old.length);
  if (head.length) {
    sh.insertColumnsAfter(COL_FIELD - 1, head.length);
    sh.getRange(1, COL_FIELD, 1, head.length).setValues([head]).setFontWeight('bold');
    if (body.length) sh.getRange(2, COL_FIELD, body.length, head.length).setValues(body);
  }
}


// ===== 回答の読み書き ===========================================

function findAnsRow_(sh, email) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var v = sh.getRange(2, 2, last - 1, 1).getValues();
  for (var i = 0; i < v.length; i++)
    if (String(v[i][0]).toLowerCase() === email.toLowerCase()) return i + 2;
  return 0;
}

/** 展開列から回答オブジェクトを復元する。複数選択だけ「, 」で分割する。 */
function rowToData_(head, row, fields) {
  var idx = {};
  head.forEach(function(lb, i){ idx[String(lb)] = i; });
  var out = {};
  fields.forEach(function(f) {
    var i = idx[f.label];
    if (i == null) return;
    var v = row[i];
    if (v === '' || v == null) { out[f.id] = f.multi ? [] : ''; return; }
    out[f.id] = f.multi
      ? String(v).split(',').map(function(s){ return s.trim(); }).filter(function(s){ return s; })
      : String(v);
  });
  return out;
}

function readAnsRow_(ss, lessonName, email, template) {
  var sh = ss.getSheetByName(lessonName);
  if (!sh) return {};
  var n = fieldColCount_(sh);
  if (!n) return {};
  var row = findAnsRow_(sh, email);
  if (!row) return {};
  var head = readHead_(sh);
  var val  = sh.getRange(row, COL_FIELD, 1, n).getValues()[0];
  return rowToData_(head, val, templateFields_(template));
}

/**
 * 授業を開く。
 * trial が真で相手が教師のときは「おためし」。
 * 白紙で開き、保存もしないので、児童の画面をそのまま試せる。
 */
function openLesson(unitId, lessonName, trial) {
  var me = whoAmI_(), teacher = isTeacher_(me);
  var l = lesson_(unitId, lessonName);
  if (!teacher && !l.pub) throw new Error('この授業はまだ公開されていません。');

  var isTrial = !!(trial && teacher);
  var u = unit_(unitId);
  var tpl = getTemplate_(unitId, lessonName);
  var ans = (isTrial || !me) ? {} : readAnsRow_(unitSS_(unitId), lessonName, me, tpl);
  return {
    meta: {unitId: u.id, unit: u.name, subject: u.subject, grade: u.grade,
           name: lessonName, pub: l.pub},
    template: tpl, answer: ans, me: me, name: nameOf_(me),
    teacher: teacher, trial: isTrial
  };
}

function saveAnswer(unitId, lessonName, data) {
  var me = whoAmI_();
  if (!me) throw new Error('ログイン情報を取得できませんでした。学校のアカウントで開き直してください。');
  return writeAnsRow_(unitId, lessonName, me, data);
}

function saveAnswerAsTeacher(unitId, lessonName, email, data) {
  requireTeacher_();
  return writeAnsRow_(unitId, lessonName, email, data);
}

/**
 * 1児童＝1行。行は公開時に事前確保されているので、保存で行の追加が起きず排他制御が不要。
 * ヘッダがテンプレートとずれていた場合だけ作り直してから書く。
 * D「取り上げ」には触らない。
 */
/**
 * 保存。往復を減らすため、書く前に読まない。
 * syncHeader_ は「テンプレートの列 → (削除)の列」の順で並べるので、
 * テンプレート分の範囲だけを書けば、削除済みの列に触れずに済む。
 */
function writeAnsRow_(unitId, lessonName, email, data) {
  var ss = unitSS_(unitId);
  var tpl = getTemplate_(unitId, lessonName);
  var fields = templateFields_(tpl);
  var sh = ss.getSheetByName(lessonName);
  if (!sh) throw new Error('授業シート「' + lessonName + '」がありません。\n' +
    'シート名を手で変えると、この状態になります。単元ファイルでシート名を「' +
    lessonName + '」に戻すか、一覧から授業を削除して作り直してください。');

  var head = getHead_(ss, unitId, lessonName);
  var want = fields.map(function(f){ return f.label; });
  var ok = want.length <= head.length && want.every(function(lb, i){ return head[i] === lb; });
  if (!ok) {
    syncHeader_(ss, lessonName, tpl);
    cacheDel_(headKey_(unitId, lessonName));
    head = getHead_(ss, unitId, lessonName);
  }

  var row = findAnsRow_(sh, email);
  if (!row) row = sh.getLastRow() + 1;
  var now = new Date();

  sh.getRange(row, 1, 1, 3).setValues([[now, email, nameOf_(email)]]);
  if (want.length) {
    var line = fields.map(function(f) {
      var v = (data || {})[f.id];
      if (v == null) return '';
      if (Object.prototype.toString.call(v) === '[object Array]') return v.join(', ');
      return v;
    });
    sh.getRange(row, COL_FIELD, 1, want.length).setValues([line]);
  }
  return {savedAt: fmtDate_(now)};
}

/**
 * 書き込む1行を作る。テンプレートに無い列（削除済みなど）は null にして既存値を残す。
 * 現在の保存経路はテンプレート分の範囲だけを書くのでこれを使わないが、
 * 列の対応関係を確かめる試験がこれを使っている。
 */
function buildAnsLine_(head, fields, data) {
  var idx = {}, line = [];
  head.forEach(function(lb, i){ idx[lb] = i; });
  for (var i = 0; i < head.length; i++) line.push(null);
  fields.forEach(function(f) {
    var c = idx[f.label];
    if (c == null) return;
    var v = (data || {})[f.id];
    if (v == null) v = '';
    if (Object.prototype.toString.call(v) === '[object Array]') v = v.join(', ');
    line[c] = v;
  });
  return line;
}

/** 名簿全員分の行を事前確保する。これで保存時に行追加が起きずロックが不要になる。 */
function ensureRows_(unitId, lessonName) {
  var sh = unitSS_(unitId).getSheetByName(lessonName);
  if (!sh) return 0;
  var list = roster_();
  if (!list.length) return 0;

  var have = {}, last = sh.getLastRow();
  if (last >= 2) {
    var v = sh.getRange(2, 2, last - 1, 1).getValues();
    for (var i = 0; i < v.length; i++) have[String(v[i][0]).toLowerCase()] = true;
  }
  var add = [];
  list.forEach(function(p) {
    if (!have[p.email.toLowerCase()]) add.push(['', p.email, p.name]);
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 3).setValues(add);
  return add.length;
}

/** 授業シートを読んで、教師用の一覧に必要な形にする。 */
function readLessonRows_(ss, lessonName, fields) {
  var sh = ss.getSheetByName(lessonName);
  if (!sh) throw new Error('授業シート「' + lessonName + '」がありません。\n' +
    'シート名を手で変えると、この状態になります。単元ファイルでシート名を戻してください。');
  var n = fieldColCount_(sh), last = sh.getLastRow();
  var head = readHead_(sh), map = {}, rows = [];

  if (last >= 2) {
    sh.getRange(2, 1, last - 1, (COL_FIELD - 1) + n).getValues().forEach(function(r) {
      var em = String(r[1]).trim();
      if (!em) return;
      var d = rowToData_(head, r.slice(COL_FIELD - 1), fields), filled = 0;
      fields.forEach(function(f) {
        var x = d[f.id];
        if (x == null || x === '') return;
        if (Object.prototype.toString.call(x) === '[object Array]') { if (x.length) filled++; }
        else filled++;
      });
      map[em.toLowerCase()] = {email: em, name: String(r[2]), pick: Number(r[3]) || 0,
                               data: d, updated: fmtDate_(r[0]), filled: filled};
    });
  }
  var seen = {};
  roster_().forEach(function(p) {
    var k = p.email.toLowerCase(); seen[k] = 1;
    rows.push(map[k] || {email: p.email, name: p.name, pick: 0, data: {}, updated: '', filled: 0});
  });
  for (var k2 in map) if (!seen[k2]) rows.push(map[k2]);
  return {sheet: sh, rows: rows};
}

/**
 * 教師用一覧。
 * 開いた時点で名簿分の行を整える。年度途中で名簿に足しても、
 * 教師が何かを押す必要がない。
 */
function listAnswers(unitId, lessonName) {
  requireTeacher_();
  var ss = unitSS_(unitId);
  ensureRows_(unitId, lessonName);
  var tpl = getTemplate_(unitId, lessonName), fields = templateFields_(tpl);
  var r = readLessonRows_(ss, lessonName, fields);
  var u = unit_(unitId);
  return {
    meta: {unitId: u.id, unit: u.name, subject: u.subject, grade: u.grade, name: lessonName},
    template: tpl, total: fields.length, rows: r.rows,
    sheetUrl: ss.getUrl() + '#gid=' + r.sheet.getSheetId()
  };
}
