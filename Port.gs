/**
 * Port.gs — 書き出しと取り込み
 *
 * 取り込みJSONの検証・座標の自動配置は、種別定義を持つクライアント側（layout.html）で行う。
 * サーバはできあがったテンプレートを保存するだけにして、
 * 種別の一覧をサーバとクライアントで二重に持たないようにしている。
 */

/** 1授業の書き出し。 */
function exportLesson(unitId, lessonName) {
  requireTeacher_();
  return {name: lessonName, template: getTemplate_(unitId, lessonName)};
}

/** 単元まるごとの書き出し。授業は並び順で出る。 */
function exportUnit(unitId) {
  requireTeacher_();
  var u = unit_(unitId);
  var out = {
    unit: {id: u.id, subject: u.subject, grade: u.grade, name: u.name},
    lessons: []
  };
  readLessons_().forEach(function(l) {
    if (l.unitId !== unitId) return;
    out.lessons.push({name: l.name, template: getTemplate_(unitId, l.name)});
  });
  return out;
}

/**
 * 単元まるごとの取り込み。単元を新しく作り、授業を順に足す。
 * lessons は [{name, template}] で、template は正規化済みであること。
 */
function importUnitBundle(meta, lessons) {
  requireTeacher_();
  if (!lessons || !lessons.length) throw new Error('授業がありません。');
  var unitId = createUnit(meta);
  var made = [];
  for (var i = 0; i < lessons.length; i++) {
    var name = createLesson(unitId, lessons[i].name);
    saveTemplate(unitId, name, lessons[i].template);
    made.push(name);
  }
  return {unitId: unitId, lessons: made};
}

/**
 * 既存の単元に授業を1つ足して取り込む。
 * 同じ名前の授業が既にあれば、その中身を差し替える（回答は列のラベルで引き継がれる）。
 */
function importLessonInto(unitId, lessonName, template) {
  requireTeacher_();
  var ss = unitSS_(unitId);
  var name = ss.getSheetByName(lessonName) ? lessonName : createLesson(unitId, lessonName);
  saveTemplate(unitId, name, template);
  return name;
}
