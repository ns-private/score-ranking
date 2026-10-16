/**
 * スコアボード API (Google Apps Script)
 *
 * スプレッドシートを「データベース」として使い、Web アプリとして公開する。
 * 画面 (GitHub Pages) からは POST で JSON を送る: { action: '...', ... }
 *
 * 管理者パスワードはスクリプト プロパティ ADMIN_PASSWORD に保存する
 * (スプレッドシートのメニュー「スコアボード」→「管理者パスワードを設定」)。
 */

const SHEETS = {
  settings: { name: '設定', headers: ['key', 'value'] },
  judges: { name: '審査員', headers: ['id', 'name', 'pin'] },
  participants: { name: '参加者', headers: ['id', 'name'] },
  criteria: { name: '評価項目', headers: ['id', 'name', 'max'] },
  scores: { name: '得点', headers: ['judgeId', 'participantId', 'criterionId', 'value', 'updatedAt'] },
};

const LOCK_SECONDS = 600;
const JUDGE_MAX_FAILS = 5;
const ADMIN_MAX_FAILS = 10;

// ============================================================
// スプレッドシートのメニュー
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('スコアボード')
    .addItem('初期設定 (シートを作成)', 'setup')
    .addItem('管理者パスワードを設定', 'setAdminPassword')
    .addToUi();
}

function setup() {
  Object.keys(SHEETS).forEach(getSheet_);
}

function setAdminPassword() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('管理者パスワードを設定', '新しいパスワードを入力してください (8 文字以上を推奨)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const pw = res.getResponseText().trim();
  if (pw.length < 4) {
    ui.alert('4 文字以上で入力してください。');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD', pw);
  ui.alert('管理者パスワードを設定しました。');
}

// ============================================================
// Web アプリの入口
// ============================================================
function doPost(e) {
  let res;
  try {
    const req = JSON.parse(e.postData.contents);
    const fn = ACTIONS[req.action];
    if (!fn) throw userError_('不明な操作です。');
    res = { ok: true, data: fn(req) };
  } catch (ex) {
    res = { ok: false, error: ex.userMessage || 'サーバーでエラーが発生しました: ' + (ex.message || ex) };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

// ブラウザで URL を直接開いたときの動作確認用
function doGet() {
  return doPost({ postData: { contents: JSON.stringify({ action: 'config' }) } });
}

const ACTIONS = {
  // 誰でも取得できる情報 (PIN と得点は含めない)
  config: () => config_(),

  judgeLogin: (req) => {
    const judge = requireJudge_(req);
    return { judge: { id: judge.id, name: judge.name }, scores: judgeScores_(judge.id), config: config_() };
  },

  saveScores: (req) => withLock_(() => {
    const judge = requireJudge_(req);
    const cfg = config_();
    const participant = cfg.participants.find((p) => p.id === String(req.participantId));
    if (!participant) throw userError_('参加者が見つかりません。画面を更新してください。');

    const input = req.scores || {};
    const rows = read_('scores');
    const now = new Date().toISOString();
    cfg.criteria.forEach((c) => {
      if (!(c.id in input)) return;
      const raw = input[c.id];
      const idx = rows.findIndex((r) => r.judgeId === judge.id && r.participantId === participant.id && r.criterionId === c.id);
      if (raw === '' || raw === null || raw === undefined) {
        if (idx >= 0) rows.splice(idx, 1);
        return;
      }
      const v = Number(raw);
      if (!isFinite(v) || v < 0 || v > c.max) {
        throw userError_('「' + c.name + '」は 0〜' + c.max + ' の範囲で入力してください。');
      }
      const row = { judgeId: judge.id, participantId: participant.id, criterionId: c.id, value: String(v), updatedAt: now };
      if (idx >= 0) rows[idx] = row;
      else rows.push(row);
    });
    write_('scores', rows);
    return { scores: judgeScores_(judge.id), config: cfg };
  }),

  adminLogin: (req) => {
    requireAdmin_(req);
    return adminData_();
  },

  adminSave: (req) => withLock_(() => {
    requireAdmin_(req);
    const data = req.data || {};

    const usedIds = {};
    const cleanId = (id) => {
      let s = String(id || '');
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(s) || usedIds[s]) s = newId_();
      usedIds[s] = true;
      return s;
    };
    const cleanName = (name, label) => {
      const s = String(name || '').trim().slice(0, 40);
      if (!s) throw userError_(label + 'の名前が空欄です。');
      return s;
    };

    const usedPins = {};
    const judges = (data.judges || []).map((j) => {
      let pin = String(j.pin || '').trim();
      if (!/^\d{4}$/.test(pin)) pin = '';
      return { id: cleanId(j.id), name: cleanName(j.name, '審査員'), pin: pin };
    });
    judges.forEach((j) => { if (j.pin) usedPins[j.pin] = true; });
    judges.forEach((j) => {
      if (j.pin) return;
      do { j.pin = String(Math.floor(Math.random() * 10000)).padStart(4, '0'); } while (usedPins[j.pin]);
      usedPins[j.pin] = true;
    });

    const participants = (data.participants || []).map((p) => ({ id: cleanId(p.id), name: cleanName(p.name, '参加者') }));
    const criteria = (data.criteria || []).map((c) => {
      const max = Number(c.max);
      if (!isFinite(max) || max <= 0 || max > 10000) throw userError_('「' + c.name + '」の満点は 1 以上の数値にしてください。');
      return { id: cleanId(c.id), name: cleanName(c.name, '評価項目'), max: String(max) };
    });

    const title = String(data.title || '').trim().slice(0, 60) || 'コンテスト';
    const judgePin = data.judgePinRequired === false ? 'off' : 'on';
    write_('settings', [{ key: 'title', value: title }, { key: 'judgePin', value: judgePin }]);
    write_('judges', judges);
    write_('participants', participants);
    write_('criteria', criteria);

    // 削除された審査員・参加者・評価項目の得点も削除する
    const ids = (list) => list.reduce((m, x) => { m[x.id] = true; return m; }, {});
    const jIds = ids(judges), pIds = ids(participants), cIds = ids(criteria);
    write_('scores', read_('scores').filter((s) => jIds[s.judgeId] && pIds[s.participantId] && cIds[s.criterionId]));

    return adminData_();
  }),

  results: (req) => {
    requireAdmin_(req);
    return results_();
  },

  // ---------- 結果発表 ----------
  // 管理者の画面だけで発表する (参加者の画面には出さない)
  announcePreview: (req) => {
    requireAdmin_(req);
    return { steps: buildSteps_() };
  },

  // 参加者の画面にも同時に発表する: 1 ステップずつ公開し、閲覧者は live をポーリングする
  announceStart: (req) => withLock_(() => {
    requireAdmin_(req);
    const steps = buildSteps_();
    const state = { active: true, sessionId: newId_(), step: 0, total: steps.length, updatedAt: Date.now() };
    saveLive_(state, steps);
    return liveView_(state, steps);
  }),

  announceNext: (req) => withLock_(() => {
    requireAdmin_(req);
    const state = loadLive_();
    if (!state.active || state.sessionId !== req.sessionId) throw userError_('この結果発表は終了しています。もう一度「結果発表」を押してください。');
    if (state.step < state.total - 1) state.step++;
    state.updatedAt = Date.now();
    saveLive_(state);
    return liveView_(state, liveSteps_(state));
  }),

  announceEnd: (req) => withLock_(() => {
    requireAdmin_(req);
    const state = loadLive_();
    state.active = false;
    state.updatedAt = Date.now();
    saveLive_(state);
    return { active: false };
  }),

  // 誰でも取得できる: 公開済みのステップだけを返す (順位の先読みはできない)
  live: () => {
    const state = loadLive_();
    if (!state.active) return { active: false, sessionId: state.sessionId || null };
    return liveView_(state, liveSteps_(state));
  },
};

// ============================================================
// データの組み立て
// ============================================================
function config_() {
  const settings = settings_();
  return {
    title: settings.title || 'コンテスト',
    // 審査員ログインで PIN を確認するか (既定はオン)
    judgePinRequired: settings.judgePin !== 'off',
    judges: read_('judges').map((j) => ({ id: j.id, name: j.name })),
    participants: read_('participants').map((p) => ({ id: p.id, name: p.name })),
    criteria: read_('criteria').map((c) => ({ id: c.id, name: c.name, max: Number(c.max) || 10 })),
  };
}

// { participantId: { criterionId: 値 } }
function judgeScores_(judgeId) {
  const out = {};
  read_('scores').forEach((s) => {
    if (s.judgeId !== judgeId) return;
    (out[s.participantId] = out[s.participantId] || {})[s.criterionId] = Number(s.value);
  });
  return out;
}

function adminData_() {
  const cfg = config_();
  cfg.judges = read_('judges').map((j) => ({ id: j.id, name: j.name, pin: j.pin }));
  // 採点状況 (得点そのものは含めない): { judgeId: { participantId: 入力済み項目数 } }
  const progress = {};
  read_('scores').forEach((s) => {
    const byJudge = (progress[s.judgeId] = progress[s.judgeId] || {});
    byJudge[s.participantId] = (byJudge[s.participantId] || 0) + 1;
  });
  cfg.progress = progress;
  return cfg;
}

// 各評価項目は「採点した審査員の平均」、合計はその和
function results_() {
  const cfg = config_();
  const scores = read_('scores');
  const judgeIds = {};
  cfg.judges.forEach((j) => { judgeIds[j.id] = true; });
  const round2 = (n) => Math.round(n * 100) / 100;

  const participants = cfg.participants.map((p) => {
    const mine = scores.filter((s) => s.participantId === p.id && judgeIds[s.judgeId]);
    const breakdown = cfg.criteria.map((c) => {
      const vals = mine.filter((s) => s.criterionId === c.id).map((s) => Number(s.value)).filter(isFinite);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      return { criterionId: c.id, name: c.name, avg: avg, count: vals.length };
    });
    const judgedBy = {};
    mine.forEach((s) => { judgedBy[s.judgeId] = true; });
    const total = breakdown.reduce((a, b) => a + b.avg, 0);
    return {
      id: p.id,
      name: p.name,
      total: round2(total),
      judgedBy: Object.keys(judgedBy).length,
      breakdown: breakdown.map((b) => ({ criterionId: b.criterionId, name: b.name, avg: round2(b.avg), count: b.count })),
    };
  });
  return { title: cfg.title, judgeCount: cfg.judges.length, criteria: cfg.criteria, participants: participants };
}

// ============================================================
// 結果発表のステップ
//   intro → lower (4位以下) → top (3位, 2位, 1位 / 同点は同時) → podium
// ============================================================
function buildSteps_() {
  const r = results_();
  const list = r.participants
    .map((p) => ({ name: p.name, total: p.total, breakdown: p.breakdown.map((b) => ({ name: b.name, value: b.avg })) }))
    .sort((a, b) => b.total - a.total);
  // 同点は同順位 (1, 1, 3 ...)
  list.forEach((e, i) => { e.rank = i > 0 && e.total === list[i - 1].total ? list[i - 1].rank : i + 1; });

  const steps = [{ type: 'intro', title: r.title, participantCount: list.length, judgeCount: r.judgeCount }];

  const lower = list.filter((e) => e.rank > 3);
  if (lower.length) steps.push({ type: 'lower', entries: lower.map((e) => ({ rank: e.rank, name: e.name, total: e.total })) });

  const top = list.filter((e) => e.rank <= 3);
  const ranks = top.map((e) => e.rank).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b - a);
  ranks.forEach((rank) => {
    // ドラムロールで流す名前 (画面に出るのと同じ範囲だけを渡す)
    const candidates = list.filter((e) => e.rank <= rank).map((e) => e.name);
    steps.push({
      type: 'top',
      rank: rank,
      winners: top.filter((e) => e.rank === rank),
      pool: candidates.length > 1 ? candidates : list.map((e) => e.name),
    });
  });

  if (top.length) {
    steps.push({
      type: 'podium',
      groups: ranks.slice().sort((a, b) => a - b).map((rank) => {
        const g = top.filter((e) => e.rank === rank);
        return { rank: rank, names: g.map((e) => e.name), total: g[0].total };
      }),
    });
  }
  return steps;
}

// ============================================================
// ライブ発表の状態 (状態はスクリプト プロパティ、ステップは 6 時間キャッシュ)
// ============================================================
const LIVE_TTL_SECONDS = 21600;

function loadLive_() {
  const cache = CacheService.getScriptCache();
  let raw = cache.get('live:state');
  if (!raw) {
    raw = PropertiesService.getScriptProperties().getProperty('LIVE_STATE') || '{"active":false}';
    cache.put('live:state', raw, LIVE_TTL_SECONDS);
  }
  const state = JSON.parse(raw);
  // 6 時間以上動きがない発表は終了扱い
  if (state.active && Date.now() - Number(state.updatedAt || 0) > LIVE_TTL_SECONDS * 1000) state.active = false;
  return state;
}

function saveLive_(state, steps) {
  const raw = JSON.stringify(state);
  PropertiesService.getScriptProperties().setProperty('LIVE_STATE', raw);
  const cache = CacheService.getScriptCache();
  cache.put('live:state', raw, LIVE_TTL_SECONDS);
  if (steps) cache.put('live:steps:' + state.sessionId, JSON.stringify(steps), LIVE_TTL_SECONDS);
}

function liveSteps_(state) {
  const cache = CacheService.getScriptCache();
  const raw = cache.get('live:steps:' + state.sessionId);
  if (raw) return JSON.parse(raw);
  // キャッシュが消えていたら作り直す (得点が変わっていなければ同じ内容になる)
  const steps = buildSteps_();
  cache.put('live:steps:' + state.sessionId, JSON.stringify(steps), LIVE_TTL_SECONDS);
  return steps;
}

function liveView_(state, steps) {
  return { active: true, sessionId: state.sessionId, step: state.step, total: state.total, payload: steps[state.step] };
}

// ============================================================
// 認証 (失敗が続いたら一定時間ロック)
// ============================================================
function requireAdmin_(req) {
  const pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!pw) throw userError_('管理者パスワードが未設定です。スプレッドシートのメニュー「スコアボード」から設定してください。');
  const key = 'fail:admin';
  checkLock_(key, ADMIN_MAX_FAILS);
  if (String(req.password || '') !== pw) {
    countFail_(key);
    throw userError_('パスワードが違います。');
  }
}

function settings_() {
  const settings = {};
  read_('settings').forEach((r) => { settings[r.key] = r.value; });
  return settings;
}

function requireJudge_(req) {
  const key = 'fail:judge:' + String(req.judgeId || '');
  checkLock_(key, JUDGE_MAX_FAILS);
  const pinRequired = settings_().judgePin !== 'off';
  const judge = read_('judges').find((j) => j.id === String(req.judgeId || ''));
  if (!judge) throw userError_('審査員が見つかりません。管理者に確認してください。');
  if (pinRequired && String(req.pin || '') !== judge.pin) {
    countFail_(key);
    throw userError_('PIN が違います。');
  }
  return judge;
}

function checkLock_(key, limit) {
  const n = Number(CacheService.getScriptCache().get(key) || 0);
  if (n >= limit) throw userError_('入力ミスが続いたため一時的にロックしました。10 分ほど待ってから再度お試しください。');
}

function countFail_(key) {
  const cache = CacheService.getScriptCache();
  cache.put(key, String(Number(cache.get(key) || 0) + 1), LOCK_SECONDS);
}

// ============================================================
// シート読み書き (すべて文字列として保存し、先頭の 0 などを保持する)
// ============================================================
function getSheet_(key) {
  const def = SHEETS[key];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    const range = sh.getRange(1, 1, 1, def.headers.length);
    range.setNumberFormat('@');
    range.setValues([def.headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function read_(key) {
  const headers = SHEETS[key].headers;
  return getSheet_(key).getDataRange().getValues().slice(1)
    .filter((r) => r.some((v) => v !== '' && v !== null && v !== undefined))
    .map((r) => {
      const o = {};
      headers.forEach((h, i) => { o[h] = r[i] === undefined || r[i] === null ? '' : String(r[i]).trim(); });
      return o;
    });
}

function write_(key, rows) {
  const sh = getSheet_(key);
  const headers = SHEETS[key].headers;
  const data = [headers].concat(rows.map((o) => headers.map((h) => (o[h] === undefined || o[h] === null ? '' : String(o[h])))));
  sh.clearContents();
  if (data.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), data.length - sh.getMaxRows());
  const range = sh.getRange(1, 1, data.length, headers.length);
  range.setNumberFormat('@');
  range.setValues(data);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function userError_(message) {
  const e = new Error(message);
  e.userMessage = message;
  return e;
}
