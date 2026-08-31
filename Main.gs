/**
 * Main.gs — ルーティングのみ
 *
 * ファイル構成
 *   Main.gs    ルーティング
 *   Store.gs   マスター／単元ファイルへのアクセス、権限、名簿、キャッシュ
 *   Schema.gs  テンプレートのスキーマ版・検証・移行
 *   Lesson.gs  テンプレート、回答、列同期
 *   Admin.gs   単元・授業の作成／改名／削除／並べ替え／公開
 *   Collect.gs 抽出集約（取り上げの指定と読み出し）
 *   Test.gs    自動テスト（runTests を実行）
 *
 * 公開設定（必須）
 *   実行するユーザー       : 自分（教師）
 *   アクセスできるユーザー : 組織内の全員
 *
 * 初回のみ setUp() を1回実行してください（Store.gs にあります）。
 */

var APP_TITLE = 'ワークシート';

function doGet(e) {
  var p = (e && e.parameter) || {};
  var view = p.view || '';
  if (view === 'teacher' || view === 'editor' || view === 'import' || view === 'collect') {
    if (!isTeacher_(whoAmI_())) return deny_();
    return page_(view === 'teacher' ? 'teacher' : view, APP_TITLE + ' 教師用', p);
  }
  return page_('app', APP_TITLE, p);
}

/**
 * GASのウェブアプリはサンドボックスiframeで動くため、
 * クライアント側の location.search にパラメータが入らず、location を書き換えても遷移しない。
 * パラメータとアプリURLをテンプレート経由で渡し、遷移は _top で行う。
 */
function page_(file, title, params) {
  var t = HtmlService.createTemplateFromFile(file);
  t.paramsJson = JSON.stringify(params || {});
  t.appUrl = ScriptApp.getService().getUrl();
  return t.evaluate().setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function deny_() {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:60px;text-align:center;color:#a8322a">' +
    'このページは先生用です。<br>児童のみなさんは、先生からわたされたURLをひらいてください。</div>');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
