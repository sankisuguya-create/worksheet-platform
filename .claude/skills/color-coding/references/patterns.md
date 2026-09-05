# 実装の型

どれも「色を外しても意味が残るか」で通る形にしてある。色を足す前にこの型に合うか確かめる。

## 凡例（グラフ・地図・図）

凡例を離れた場所に置くと、色の記憶を要求することになる。**凡例は対象の隣に置く。**

```html
<!-- 悪い：色見本と語が離れ、色の記憶を強いる -->
<ul class="legend"><li><span class="sw sw1"></span>1組</li>…</ul>

<!-- 良い：線の終端に直接ラベル。色は補助 -->
<g><path class="s1" …/><text x="…" y="…" class="s1-label">1組 ●</text></g>
```

系列が4つを超えたら、色分けをやめて**小さな図を並べる**（small multiples）。1図1系列にすれば色は1色で済む。

## タブ・現在地

現在地を色だけで示さない。**塗り＋太字＋下線帯**の3つを重ねる。

```css
.tab{color:var(--ink-sub);border-bottom:4px solid transparent}
.tab[aria-current="page"]{color:var(--ink);font-weight:700;
  border-bottom-color:var(--cat-1);background:var(--fill-a)}
```

`aria-current` を付けると支援技術にも現在地が伝わる。色の代替を1つ実装したことになる。

## 状態表示（提出済／未提出、できた／まだ）

**赤×緑を使わない**（1型でΔE00 8.6、同色になる）。

```html
<span class="st st-done">✓ できた</span>
<span class="st st-todo">× まだ</span>
```
```css
.st{font-weight:700;padding:2px 8px;border-radius:4px}
.st-done{color:#fff;background:var(--cat-1)}
.st-todo{color:#fff;background:var(--ink-alert)}
```

記号と語を両方入れる。児童向けでは記号より**語**が確実に伝わる（✓の意味を取り違える児童がいる）。

## 表の行・列の塗り分け

- 交互の縞は `--fill-a` と白のみ。2色の淡色を交互にしない
- 強調したい行は塗りではなく**左端の太いボーダー＋太字**
- 数値の良し悪しを色で示すときは、色と同時に記号（▲▼）を置く

```css
tbody tr:nth-child(even){background:var(--fill-a)}
tbody tr.mark{border-left:6px solid var(--cat-2);font-weight:700}
```

## グラフ

`dataviz` スキルが別にある場合はそちらの構造規則に従い、**色の値と色数の上限だけをこのスキルで上書きする**。

- 折れ線：4本まで。線種（実線／破線／点線）とマーカー形を色と重ねる
- 棒：1色でよい。強調する1本だけ `--cat-2` にする
- 円：使わない。角度の比較は色分けを必要とし、色数が増える。棒に置き換える
- ヒートマップ：色相ではなく**明度の連続変化**で作る。1色相の濃淡なら全色覚タイプで順序が保たれる

## ボタンと操作

```css
.btn-primary{background:var(--cat-1);color:#fff;font-weight:700}   /* 6.6:1 */
.btn-danger {background:var(--ink-alert);color:#fff;font-weight:700}/* 5.6:1 */
.btn-quiet  {background:#fff;color:var(--ink);border:2px solid var(--line)}
```

危険な操作（削除・提出取消）は色だけで区別しない。**語を変える**（「削除する」と「やめる」）。児童は色より語を読む。

## フォーカスと選択

キーボード操作と、児童がタッチで選んだ状態の両方に必要。

```css
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.card[aria-selected="true"]{border-width:4px;border-color:var(--cat-1);background:var(--fill-a)}
.card[aria-selected="true"]::after{content:"選択中";font-weight:700;color:var(--cat-1)}
```

枠線の**太さの変化**（2px→4px）は色覚に依存しない。色の変化だけで選択を示さない。

## ダークモード

児童機では既定で使われないが、教員が切り替える場合がある。**色相は変えず明度だけ入れ替える。** 暗背景では `--cat-3`（茶 #6E4310）が背景に沈むため、暗背景用は別トークンを用意して検証スクリプトに `--bg` を渡し直す。

```bash
# 暗背景で検証を通した4色（--cat-1〜4 の暗背景版）
node scripts/check-palette.mjs --bg "#1A1A1A" "#8FBEE8,#F0B040,#A9773C,#828A93"
```

明背景のトークンをそのまま暗背景に流用すると落ちる。実測では `#6FA8DC`（青）と `#A9AEB5`（灰）が1型でΔE00 15.7まで落ちた。**暗背景は別トークンを起こし、`--bg` を渡して検証し直す。**

## 印刷される画面

このスキルは画面（sRGB）専用。印刷を前提とするページは、モノクロ印刷で全ての区別が残るかを別途確かめる。**明度差だけで組んであれば、モノクロ印刷でもそのまま通る。**
