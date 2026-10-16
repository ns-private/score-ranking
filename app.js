(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const API_URL = String(window.SCOREBOARD_API_URL || '').trim();
  const MOCK = new URLSearchParams(location.search).has('mock');
  const JUDGE_KEY = 'scoreboard-judge';

  // ============================================================
  // 共通
  // ============================================================
  const VIEWS = ['viewLoading', 'viewError', 'viewJudgeLogin', 'viewJudgeList', 'viewJudgeScore', 'viewAdminLogin', 'viewAdmin'];
  function show(id) {
    VIEWS.forEach((v) => { $('#' + v).hidden = v !== id; });
    window.scrollTo(0, 0);
  }

  function setMode(label) {
    $('#modeBadge').textContent = label + (MOCK ? '・デモ' : '');
  }

  function setTitle(title) {
    $('#appTitle').textContent = title || 'スコアボード';
    document.title = (title ? title + ' | ' : '') + 'スコアボード';
  }

  function showError(message) {
    $('#errorMessage').textContent = message;
    show('viewError');
  }

  let toastTimer = null;
  function toast(message, isError) {
    const t = $('#toast');
    t.textContent = message;
    t.classList.toggle('error', !!isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 2500);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const fmt = (n) => (Math.round(n * 100) / 100).toString();
  const hasValue = (v) => v !== undefined && v !== null && v !== '';

  function storageGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
  }
  function storageSet(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (_) { /* 保存できなくても動作は続ける */ }
  }

  // ボタンを処理中表示にして二重送信を防ぐ
  async function withBusy(btn, label, fn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try {
      return await fn();
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  // ============================================================
  // API (Google Apps Script)
  // ============================================================
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(src + ' を読み込めません'));
      document.head.appendChild(s);
    });
  }

  async function api(action, payload) {
    const body = Object.assign({ action }, payload || {});
    let res;
    if (MOCK) {
      res = await window.mockApi(body);
    } else {
      let r;
      try {
        // Content-Type を付けない (text/plain) ことで CORS のプリフライトを避ける
        r = await fetch(API_URL, { method: 'POST', body: JSON.stringify(body) });
      } catch (_) {
        throw new Error('サーバーに接続できません。通信状況を確認してください。');
      }
      if (!r.ok) throw new Error('サーバーエラーが発生しました (' + r.status + ')');
      try {
        res = await r.json();
      } catch (_) {
        throw new Error('サーバーの応答を読み取れません。API の URL と公開設定を確認してください。');
      }
    }
    if (!res.ok) throw new Error(res.error || 'エラーが発生しました');
    return res.data;
  }

  // ============================================================
  // 画面の切り替え (#admin で管理者画面)
  // ============================================================
  function route() {
    if (location.hash === '#admin') startAdmin();
    else startJudge();
  }

  window.addEventListener('hashchange', () => {
    if (location.hash !== '#admin' && adminDirty) {
      if (!confirm('管理者画面の未保存の変更は破棄されます。移動しますか？')) {
        location.hash = '#admin';
        return;
      }
      adminState = null;
      setDirty(false);
    }
    route();
  });

  window.addEventListener('beforeunload', (e) => {
    if (adminDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  $('#retryBtn').addEventListener('click', () => location.reload());

  // ============================================================
  // 審査員
  // ============================================================
  let config = null; // { title, judges[{id,name}], participants[], criteria[] }
  let judge = null; // { id, name, pin }
  let myScores = {}; // { participantId: { criterionId: 値 } }
  let currentPid = null;
  let draft = {};

  async function startJudge() {
    setMode('審査員');
    if (judge) {
      renderJudgeList();
      show('viewJudgeList');
      return;
    }
    show('viewLoading');
    const saved = storageGet(JUDGE_KEY);
    try {
      if (saved && saved.judgeId && saved.pin) {
        try {
          await judgeLogin(saved.judgeId, saved.pin);
          return;
        } catch (e) {
          storageSet(JUDGE_KEY, null);
          toast(e.message, true);
        }
      }
      config = await api('config');
      setTitle(config.title);
      showJudgeLogin();
    } catch (e) {
      showError(e.message);
    }
  }

  function showJudgeLogin() {
    const sel = $('#judgeSelect');
    sel.innerHTML = '';
    if (!config.judges.length) {
      const o = el('option', null, '審査員が登録されていません');
      o.value = '';
      sel.appendChild(o);
    } else {
      const o = el('option', null, '選択してください');
      o.value = '';
      sel.appendChild(o);
      config.judges.forEach((j) => {
        const opt = el('option', null, j.name);
        opt.value = j.id;
        sel.appendChild(opt);
      });
    }
    $('#judgePin').value = '';
    show('viewJudgeLogin');
  }

  async function judgeLogin(judgeId, pin) {
    const data = await api('judgeLogin', { judgeId, pin });
    judge = { id: data.judge.id, name: data.judge.name, pin };
    myScores = data.scores || {};
    config = data.config;
    setTitle(config.title);
    storageSet(JUDGE_KEY, { judgeId, pin });
    renderJudgeList();
    show('viewJudgeList');
  }

  $('#judgeLoginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const judgeId = $('#judgeSelect').value;
    const pin = $('#judgePin').value.trim();
    if (!judgeId) {
      toast('審査員を選択してください。', true);
      return;
    }
    withBusy(e.submitter || $('#judgeLoginForm button'), 'ログイン中…', async () => {
      try {
        await judgeLogin(judgeId, pin);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  function scoredCount(pid) {
    const s = myScores[pid] || {};
    return config.criteria.filter((c) => hasValue(s[c.id])).length;
  }

  function renderJudgeList() {
    $('#judgeName').textContent = judge.name;
    const grid = $('#participantGrid');
    grid.innerHTML = '';
    const total = config.criteria.length;

    if (!config.participants.length || !total) {
      $('#judgeProgress').textContent = !config.participants.length
        ? '参加者がまだ登録されていません。'
        : '評価項目がまだ登録されていません。';
      return;
    }

    let done = 0;
    config.participants.forEach((p) => {
      const n = scoredCount(p.id);
      if (n === total) done++;
      const card = el('button', 'p-card' + (n === total ? ' done' : ''));
      card.type = 'button';
      card.append(el('span', 'p-card-name', p.name));
      if (n === total) card.append(el('span', 'status done', '✓ 入力済み'));
      else if (n > 0) card.append(el('span', 'status partial', `一部入力 (${n}/${total})`));
      else card.append(el('span', 'status', '未入力'));
      card.addEventListener('click', () => openScore(p.id));
      grid.appendChild(card);
    });
    $('#judgeProgress').textContent = `参加者をタップして採点してください。(${config.participants.length} 名中 ${done} 名 入力済み)`;
  }

  function openScore(pid) {
    const p = config.participants.find((x) => x.id === pid);
    if (!p) return;
    currentPid = pid;
    draft = {};
    const saved = myScores[pid] || {};
    config.criteria.forEach((c) => { if (hasValue(saved[c.id])) draft[c.id] = saved[c.id]; });
    $('#scoreTarget').textContent = p.name;
    renderScoreFields();
    show('viewJudgeScore');
  }

  function renderScoreFields() {
    const box = $('#scoreFields');
    box.innerHTML = '';
    config.criteria.forEach((c) => {
      const field = el('div', 'crit-field');
      const head = el('div', 'crit-field-head');
      const name = el('span', 'crit-field-name', c.name);
      name.append(el('span', 'muted small', ` (満点 ${c.max})`));
      const value = el('span', 'crit-field-value', hasValue(draft[c.id]) ? `${draft[c.id]} 点` : '—');
      head.append(name, value);
      field.appendChild(head);

      const update = () => {
        value.textContent = hasValue(draft[c.id]) ? `${draft[c.id]} 点` : '—';
        updateScoreTotal();
      };

      if (Number.isInteger(c.max) && c.max <= 10) {
        // 満点が 10 以下ならボタンで選ぶ (もう一度押すと取り消し)
        const row = el('div', 'pick-row');
        for (let v = 0; v <= c.max; v++) {
          const b = el('button', 'pick' + (Number(draft[c.id]) === v && hasValue(draft[c.id]) ? ' on' : ''), String(v));
          b.type = 'button';
          b.addEventListener('click', () => {
            if (hasValue(draft[c.id]) && Number(draft[c.id]) === v) delete draft[c.id];
            else draft[c.id] = v;
            row.querySelectorAll('.pick').forEach((x, i) => x.classList.toggle('on', hasValue(draft[c.id]) && Number(draft[c.id]) === i));
            update();
          });
          row.appendChild(b);
        }
        field.appendChild(row);
      } else {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = '0';
        inp.max = String(c.max);
        inp.step = 'any';
        inp.inputMode = 'decimal';
        inp.value = hasValue(draft[c.id]) ? draft[c.id] : '';
        inp.setAttribute('aria-label', c.name);
        inp.addEventListener('input', () => {
          if (inp.value === '') delete draft[c.id];
          else draft[c.id] = Number(inp.value);
          update();
        });
        field.appendChild(inp);
      }
      box.appendChild(field);
    });
    updateScoreTotal();
  }

  function updateScoreTotal() {
    const total = config.criteria.reduce((sum, c) => sum + (hasValue(draft[c.id]) ? Number(draft[c.id]) : 0), 0);
    const max = config.criteria.reduce((sum, c) => sum + c.max, 0);
    $('#scoreTotal').textContent = fmt(total);
    $('#scoreMax').textContent = fmt(max);
  }

  function draftChanged() {
    const saved = myScores[currentPid] || {};
    return config.criteria.some((c) => String(hasValue(draft[c.id]) ? draft[c.id] : '') !== String(hasValue(saved[c.id]) ? saved[c.id] : ''));
  }

  $('#scoreForm').addEventListener('submit', (e) => {
    e.preventDefault();
    for (const c of config.criteria) {
      const v = draft[c.id];
      if (hasValue(v) && (!isFinite(v) || v < 0 || v > c.max)) {
        toast(`「${c.name}」は 0〜${c.max} の範囲で入力してください。`, true);
        return;
      }
    }
    const missing = config.criteria.filter((c) => !hasValue(draft[c.id]));
    if (missing.length && !confirm(`未入力の項目があります (${missing.map((c) => c.name).join('、')})。\nこのまま保存しますか？`)) return;

    const scores = {};
    config.criteria.forEach((c) => { scores[c.id] = hasValue(draft[c.id]) ? draft[c.id] : ''; });

    withBusy($('#scoreSaveBtn'), '保存中…', async () => {
      try {
        const data = await api('saveScores', { judgeId: judge.id, pin: judge.pin, participantId: currentPid, scores });
        myScores = data.scores || {};
        config = data.config;
        setTitle(config.title);
        toast('保存しました');
        renderJudgeList();
        show('viewJudgeList');
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  $('#scoreBackBtn').addEventListener('click', () => {
    if (draftChanged() && !confirm('保存していない入力は破棄されます。一覧に戻りますか？')) return;
    renderJudgeList();
    show('viewJudgeList');
  });

  $('#judgeRefreshBtn').addEventListener('click', (e) => {
    withBusy(e.currentTarget, '更新中…', async () => {
      try {
        await judgeLogin(judge.id, judge.pin);
        toast('最新の情報に更新しました');
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  $('#judgeLogoutBtn').addEventListener('click', () => {
    if (!confirm('ログアウトしますか？')) return;
    storageSet(JUDGE_KEY, null);
    judge = null;
    myScores = {};
    startJudge();
  });

  // ============================================================
  // 管理者
  // ============================================================
  let adminPassword = null;
  let adminState = null; // { title, judges[{id,name,pin}], participants[], criteria[], progress }
  let adminDirty = false;

  function setDirty(v) {
    adminDirty = v;
    $('#dirtyNote').hidden = !v;
  }

  function startAdmin() {
    setMode('管理者');
    if (adminPassword && adminState) {
      show('viewAdmin');
      return;
    }
    $('#adminPassword').value = '';
    show('viewAdminLogin');
    $('#adminPassword').focus();
  }

  function loadAdminState(data) {
    adminState = {
      title: data.title,
      judges: data.judges.map((j) => ({ id: j.id, name: j.name, pin: j.pin })),
      participants: data.participants.map((p) => ({ id: p.id, name: p.name })),
      criteria: data.criteria.map((c) => ({ id: c.id, name: c.name, max: c.max })),
      progress: data.progress || {},
    };
    setTitle(adminState.title);
    setDirty(false);
    renderAdmin();
  }

  $('#adminLoginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const password = $('#adminPassword').value;
    withBusy($('#adminLoginForm button'), 'ログイン中…', async () => {
      try {
        const data = await api('adminLogin', { password });
        adminPassword = password;
        loadAdminState(data);
        show('viewAdmin');
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  function renderAdmin() {
    $('#adminTitle').value = adminState.title;
    renderJudgeRows();
    renderParticipantRows();
    renderCriterionRows();
    renderProgress();
  }

  function deleteButton(label, onDelete) {
    const b = el('button', 'icon-btn', '✕');
    b.type = 'button';
    b.title = `${label}を削除`;
    b.setAttribute('aria-label', `${label}を削除`);
    b.addEventListener('click', onDelete);
    return b;
  }

  function nameInput(item, label) {
    const inp = document.createElement('input');
    inp.className = 'name';
    inp.maxLength = 40;
    inp.value = item.name;
    inp.setAttribute('aria-label', label);
    inp.addEventListener('input', () => { item.name = inp.value; setDirty(true); });
    return inp;
  }

  function renderJudgeRows() {
    const list = $('#judgeList');
    list.innerHTML = '';
    const showPins = $('#showPins').checked;
    adminState.judges.forEach((j, i) => {
      const row = el('div', 'item-row');
      const pin = document.createElement('input');
      pin.className = 'pin';
      pin.type = showPins ? 'text' : 'password';
      pin.inputMode = 'numeric';
      pin.maxLength = 4;
      pin.autocomplete = 'off';
      pin.placeholder = '自動';
      pin.value = j.pin || '';
      pin.setAttribute('aria-label', `${j.name} の PIN`);
      pin.addEventListener('input', () => { j.pin = pin.value.trim(); setDirty(true); });
      row.append(
        nameInput(j, '審査員名'),
        pin,
        deleteButton(`審査員「${j.name}」`, () => {
          if (!confirm(`審査員「${j.name}」を削除しますか？\n保存すると、この審査員の得点も削除されます。`)) return;
          adminState.judges.splice(i, 1);
          setDirty(true);
          renderJudgeRows();
          renderProgress();
        }),
      );
      list.appendChild(row);
    });
  }

  function renderParticipantRows() {
    const list = $('#participantList');
    list.innerHTML = '';
    adminState.participants.forEach((p, i) => {
      const row = el('div', 'item-row');
      row.append(
        nameInput(p, '参加者名'),
        deleteButton(`参加者「${p.name}」`, () => {
          if (!confirm(`参加者「${p.name}」を削除しますか？\n保存すると、この参加者の得点も削除されます。`)) return;
          adminState.participants.splice(i, 1);
          setDirty(true);
          renderParticipantRows();
          renderProgress();
        }),
      );
      list.appendChild(row);
    });
  }

  function renderCriterionRows() {
    const list = $('#criterionList');
    list.innerHTML = '';
    adminState.criteria.forEach((c, i) => {
      const row = el('div', 'item-row');
      const max = document.createElement('input');
      max.type = 'number';
      max.className = 'max';
      max.min = '1';
      max.value = c.max;
      max.setAttribute('aria-label', `${c.name} の満点`);
      max.addEventListener('input', () => { c.max = Number(max.value); setDirty(true); });
      row.append(
        nameInput(c, '項目名'),
        max,
        el('span', 'unit', '点満点'),
        deleteButton(`評価項目「${c.name}」`, () => {
          if (!confirm(`評価項目「${c.name}」を削除しますか？\n保存すると、この項目の得点も削除されます。`)) return;
          adminState.criteria.splice(i, 1);
          setDirty(true);
          renderCriterionRows();
          renderProgress();
        }),
      );
      list.appendChild(row);
    });
  }

  // 保存済みの審査員 × 参加者ごとの入力状況 (得点は表示しない)
  function countIncomplete() {
    const total = adminState.criteria.length;
    let incomplete = 0;
    adminState.judges.forEach((j) => {
      adminState.participants.forEach((p) => {
        const n = (adminState.progress[j.id] || {})[p.id] || 0;
        if (n < total) incomplete++;
      });
    });
    return incomplete;
  }

  function renderProgress() {
    const table = $('#progressTable');
    table.innerHTML = '';
    const judges = adminState.judges.filter((j) => j.id);
    const participants = adminState.participants.filter((p) => p.id);
    const total = adminState.criteria.filter((c) => c.id).length;
    if (!judges.length || !participants.length || !total) {
      const tr = el('tr');
      tr.append(el('td', 'muted', '審査員・参加者・評価項目を保存すると表示されます。'));
      table.appendChild(tr);
      return;
    }
    const head = el('tr');
    head.append(el('th', null, '参加者'));
    judges.forEach((j) => head.append(el('th', null, j.name)));
    const thead = el('thead');
    thead.appendChild(head);
    table.appendChild(thead);

    const tbody = el('tbody');
    participants.forEach((p) => {
      const tr = el('tr');
      tr.append(el('td', null, p.name));
      judges.forEach((j) => {
        const n = (adminState.progress[j.id] || {})[p.id] || 0;
        if (n >= total) tr.append(el('td', 'ok', '✓'));
        else if (n > 0) tr.append(el('td', 'part', `${n}/${total}`));
        else tr.append(el('td', 'none', '–'));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  $('#showPins').addEventListener('change', renderJudgeRows);
  $('#adminTitle').addEventListener('input', (e) => { adminState.title = e.target.value; setDirty(true); });

  $('#addJudgeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#newJudgeName').value.trim();
    if (!name) return;
    adminState.judges.push({ id: '', name, pin: '' });
    $('#newJudgeName').value = '';
    setDirty(true);
    renderJudgeRows();
  });

  $('#addParticipantForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#newParticipantName').value.trim();
    if (!name) return;
    adminState.participants.push({ id: '', name });
    $('#newParticipantName').value = '';
    setDirty(true);
    renderParticipantRows();
  });

  $('#addCriterionForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#newCriterionName').value.trim();
    const max = Number($('#newCriterionMax').value);
    if (!name) return;
    if (!(max > 0)) {
      toast('満点は 1 以上にしてください。', true);
      return;
    }
    adminState.criteria.push({ id: '', name, max });
    $('#newCriterionName').value = '';
    setDirty(true);
    renderCriterionRows();
  });

  $('#adminSaveBtn').addEventListener('click', (e) => {
    const bad = (list) => list.some((x) => !String(x.name).trim());
    if (bad(adminState.judges) || bad(adminState.participants) || bad(adminState.criteria)) {
      toast('名前が空欄の行があります。', true);
      return;
    }
    if (adminState.judges.some((j) => j.pin && !/^\d{4}$/.test(j.pin))) {
      toast('PIN は 4 桁の数字にしてください (空欄なら自動発行)。', true);
      return;
    }
    if (adminState.criteria.some((c) => !(c.max > 0))) {
      toast('満点は 1 以上にしてください。', true);
      return;
    }
    withBusy(e.currentTarget, '保存中…', async () => {
      try {
        const data = await api('adminSave', {
          password: adminPassword,
          data: {
            title: adminState.title,
            judges: adminState.judges,
            participants: adminState.participants,
            criteria: adminState.criteria,
          },
        });
        loadAdminState(data);
        toast('保存しました。審査員の画面には次の更新・保存時に反映されます。');
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  $('#progressRefreshBtn').addEventListener('click', (e) => {
    withBusy(e.currentTarget, '更新中…', async () => {
      try {
        const data = await api('adminLogin', { password: adminPassword });
        if (adminDirty) {
          // 編集中の内容は残し、採点状況だけ更新する
          adminState.progress = data.progress || {};
          renderProgress();
        } else {
          loadAdminState(data);
        }
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  $('#adminLogoutBtn').addEventListener('click', () => {
    if (adminDirty && !confirm('未保存の変更は破棄されます。ログアウトしますか？')) return;
    adminPassword = null;
    adminState = null;
    setDirty(false);
    location.hash = '';
  });

  // ============================================================
  // 効果音 (Web Audio で合成)
  // ============================================================
  let audioCtx = null;
  const soundOn = () => $('#soundToggle').checked;

  function ctx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function noiseBuffer(ac, seconds) {
    const buf = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ドラムロール: 短いノイズを高速で連打しながらクレッシェンド
  function playDrumroll(duration) {
    if (!soundOn()) return;
    const ac = ctx();
    if (!ac) return;
    const buf = noiseBuffer(ac, 0.08);
    const start = ac.currentTime;
    const interval = 0.045;
    for (let t = 0; t < duration; t += interval) {
      const src = ac.createBufferSource();
      src.buffer = buf;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 220;
      bp.Q.value = 0.8;
      const g = ac.createGain();
      const vol = 0.15 + 0.55 * (t / duration);
      g.gain.setValueAtTime(vol, start + t);
      g.gain.exponentialRampToValueAtTime(0.001, start + t + 0.07);
      src.connect(bp).connect(g).connect(ac.destination);
      src.start(start + t);
      src.stop(start + t + 0.08);
    }
  }

  // シンバル + ファンファーレ
  function playReveal(big) {
    if (!soundOn()) return;
    const ac = ctx();
    if (!ac) return;
    const now = ac.currentTime;

    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac, 1.5);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
    src.connect(hp).connect(g).connect(ac.destination);
    src.start(now);

    const notes = big ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
    notes.forEach((f, i) => {
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const og = ac.createGain();
      const t0 = now + i * 0.12;
      const len = big && i === notes.length - 1 ? 1.2 : 0.5;
      og.gain.setValueAtTime(0, t0);
      og.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      og.gain.exponentialRampToValueAtTime(0.001, t0 + len);
      o.connect(og).connect(ac.destination);
      o.start(t0);
      o.stop(t0 + len + 0.05);
    });
  }

  function playTick() {
    if (!soundOn()) return;
    const ac = ctx();
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.08);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.1);
  }

  // ============================================================
  // 紙吹雪
  // ============================================================
  const canvas = $('#confetti');
  const cctx = canvas.getContext('2d');
  let particles = [];
  let confettiRunning = false;

  function resizeCanvas() {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
  }
  addEventListener('resize', resizeCanvas);

  function addParticles(count, colors, spawn) {
    resizeCanvas();
    for (let i = 0; i < count; i++) {
      particles.push(Object.assign({
        w: (6 + Math.random() * 8) * devicePixelRatio,
        h: (4 + Math.random() * 6) * devicePixelRatio,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 0,
      }, spawn()));
    }
    if (!confettiRunning) {
      confettiRunning = true;
      requestAnimationFrame(tickConfetti);
    }
  }

  function burstConfetti(count, colors) {
    addParticles(count, colors, () => ({
      x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.3,
      y: canvas.height * 0.45,
      vx: (Math.random() - 0.5) * 26 * devicePixelRatio,
      vy: (-Math.random() * 22 - 8) * devicePixelRatio,
    }));
  }

  function rainConfetti(count, colors) {
    addParticles(count, colors, () => ({
      x: Math.random() * canvas.width,
      y: -Math.random() * canvas.height * 0.6,
      vx: (Math.random() - 0.5) * 4 * devicePixelRatio,
      vy: (2 + Math.random() * 4) * devicePixelRatio,
    }));
  }

  function tickConfetti() {
    cctx.clearRect(0, 0, canvas.width, canvas.height);
    const g = 0.45 * devicePixelRatio;
    particles = particles.filter((p) => p.y < canvas.height + 40 && p.life < 900);
    particles.forEach((p) => {
      p.life++;
      p.vy = Math.min(p.vy + g, 7 * devicePixelRatio);
      p.vx *= 0.985;
      p.x += p.vx + Math.sin(p.life / 12) * devicePixelRatio;
      p.y += p.vy;
      p.rot += p.vr;
      cctx.save();
      cctx.translate(p.x, p.y);
      cctx.rotate(p.rot);
      cctx.fillStyle = p.color;
      cctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 8)));
      cctx.restore();
    });
    if (particles.length) requestAnimationFrame(tickConfetti);
    else {
      confettiRunning = false;
      cctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  const GOLD = ['#ffe066', '#f5b700', '#fff3b0', '#ffffff', '#ff6b6b', '#4dabf7', '#69db7c'];
  const SILVER = ['#e5e9f0', '#b8c0cc', '#ffffff', '#a5d8ff'];
  const BRONZE = ['#f4c08a', '#cd7f32', '#ffd8a8', '#ffffff'];

  // ============================================================
  // 結果発表
  // ============================================================
  const overlay = $('#overlay');
  const stage = $('#stage');
  const nextBtn = $('#nextBtn');
  let steps = [];
  let stepIndex = 0;
  let busy = false;
  let timers = [];

  const wait = (ms) => new Promise((res) => timers.push(setTimeout(res, ms)));
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

  // 同点は同順位 (1, 1, 3 ...)
  function computeRanking(results) {
    const list = results.participants
      .map((p) => ({
        name: p.name.trim() ? `${p.name.trim()}さん` : '(名前なし)',
        total: p.total,
        breakdown: p.breakdown.map((b) => ({ name: b.name, value: b.avg })),
      }))
      .sort((a, b) => b.total - a.total);
    list.forEach((e, i) => {
      e.rank = i > 0 && e.total === list[i - 1].total ? list[i - 1].rank : i + 1;
    });
    return list;
  }

  function buildSteps(results) {
    const ranking = computeRanking(results);
    const top = ranking.filter((e) => e.rank <= 3);
    const lower = ranking.filter((e) => e.rank > 3);
    const s = [];

    s.push(async () => {
      stage.innerHTML = '';
      stage.append(el('div', 'spotlight'));
      stage.append(el('div', 'intro-title', '結果発表'));
      stage.append(el('div', 'intro-sub', `${results.title}  ／  参加者 ${ranking.length} 名  ／  審査員 ${results.judgeCount} 名`));
      playReveal(false);
    });

    if (lower.length) {
      s.push(async () => {
        stage.innerHTML = '';
        stage.append(el('div', 'rank-label', '4位以下の発表'));
        const listBox = el('div', 'lower-list');
        stage.append(listBox);
        // 下位から順に表示
        const rev = [...lower].reverse();
        for (const e of rev) {
          const row = el('div', 'lower-row');
          row.append(el('span', 'r', `${e.rank}位`), el('span', 'n', e.name), el('span', 's', `${fmt(e.total)} 点`));
          listBox.prepend(row);
          playTick();
          await wait(Math.max(180, 900 / rev.length));
        }
      });
    }

    // 3位 → 2位 → 1位 (同点なら同時発表)
    const topRanks = [...new Set(top.map((e) => e.rank))].sort((a, b) => b - a);
    topRanks.forEach((rank) => {
      const winners = top.filter((e) => e.rank === rank);
      s.push(() => revealTop(rank, winners, ranking));
    });

    if (top.length) s.push(() => showPodium(top));
    return s;
  }

  async function revealTop(rank, winners, ranking) {
    stage.innerHTML = '';
    const isFirst = rank === 1;
    if (isFirst) stage.append(el('div', 'spotlight'));
    const label = el('div', 'rank-label', `第 ${rank} 位 は…`);
    stage.append(label);
    const roll = el('div', 'drumroll-name', '');
    stage.append(roll);

    // ドラムロール: 名前をシャッフル表示
    const duration = isFirst ? 3600 : 2400;
    playDrumroll(duration / 1000);
    const candidates = ranking.filter((e) => e.rank <= rank).map((e) => e.name);
    const pool = candidates.length > 1 ? candidates : ranking.map((e) => e.name);
    const start = performance.now();
    let i = 0;
    while (performance.now() - start < duration) {
      roll.textContent = pool[i++ % pool.length];
      const progress = (performance.now() - start) / duration;
      await wait(60 + progress * 160);
      if (overlay.hidden) return;
    }

    roll.remove();
    label.textContent = winners.length > 1 ? `第 ${rank} 位 (同点 ${winners.length} 名)` : `第 ${rank} 位`;

    const wrap = el('div', '');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:32px;';
    winners.forEach((e) => {
      const card = el('div', `result-card rank-${rank}`);
      card.append(el('div', 'medal', MEDALS[rank]));
      card.append(el('div', 'name', e.name));
      card.append(el('div', 'score', `${fmt(e.total)} 点`));
      const bd = el('div', 'breakdown');
      e.breakdown.forEach((b) => bd.append(el('span', 'chip', `${b.name}: ${fmt(b.value)}`)));
      card.append(bd);
      wrap.append(card);
    });
    stage.append(wrap);
    stage.classList.add('shake');
    setTimeout(() => stage.classList.remove('shake'), 400);

    playReveal(isFirst);
    if (isFirst) {
      burstConfetti(260, GOLD);
      setTimeout(() => rainConfetti(200, GOLD), 600);
    } else if (rank === 2) {
      burstConfetti(120, SILVER);
    } else {
      burstConfetti(80, BRONZE);
    }
  }

  async function showPodium(top) {
    stage.innerHTML = '';
    stage.append(el('div', 'final-title', '🎉 おめでとうございます! 🎉'));
    const podium = el('div', 'podium');
    [1, 2, 3].forEach((rank) => {
      const group = top.filter((e) => e.rank === rank);
      if (!group.length) return;
      const col = el('div', `podium-col p${rank}`);
      col.append(el('div', 'p-name', group.map((e) => e.name).join(' / ')));
      col.append(el('div', 'p-score', `${fmt(group[0].total)} 点`));
      col.append(el('div', 'block', `${rank}`));
      podium.append(col);
    });
    stage.append(podium);
    rainConfetti(180, GOLD);
  }

  async function runStep() {
    if (busy || stepIndex >= steps.length) return;
    busy = true;
    nextBtn.disabled = true;
    await steps[stepIndex]();
    stepIndex++;
    busy = false;
    if (overlay.hidden) return;
    nextBtn.disabled = false;
    nextBtn.textContent = stepIndex >= steps.length ? '閉じる' : '次へ ▶';
  }

  function openOverlay(results) {
    steps = buildSteps(results);
    stepIndex = 0;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    runStep();
  }

  function closeOverlay() {
    clearTimers();
    overlay.hidden = true;
    busy = false;
    particles = [];
    stage.innerHTML = '';
    document.body.style.overflow = '';
  }

  $('#announceBtn').addEventListener('click', (e) => {
    if (adminDirty) {
      toast('未保存の変更があります。先に「保存して全員に反映」を押してください。', true);
      return;
    }
    if (!adminState.participants.length) {
      toast('参加者が登録されていません。', true);
      return;
    }
    const incomplete = countIncomplete();
    if (incomplete && !confirm(`採点が終わっていない組み合わせが ${incomplete} 件あります。\nこのまま結果発表しますか？`)) return;
    ctx(); // ユーザー操作中に AudioContext を有効化
    withBusy(e.currentTarget, '集計中…', async () => {
      try {
        openOverlay(await api('results', { password: adminPassword }));
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  $('#closeOverlay').addEventListener('click', closeOverlay);
  nextBtn.addEventListener('click', () => {
    if (stepIndex >= steps.length) closeOverlay();
    else runStep();
  });
  document.addEventListener('keydown', (e) => {
    if (overlay.hidden) return;
    if (e.key === 'Escape') closeOverlay();
    else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (!nextBtn.disabled) nextBtn.click();
    }
  });

  // ============================================================
  // 起動
  // ============================================================
  async function init() {
    // 画面共有に備え、再読み込み時にブラウザが復元したチェック状態を戻して PIN は常に隠した状態から始める
    $('#showPins').checked = false;
    if (MOCK) {
      try {
        await loadScript('mock-gas.js');
        await loadScript('apps-script/Code.js');
      } catch (e) {
        showError(e.message);
        return;
      }
    } else if (!API_URL) {
      showError('データの保存先 (Google Apps Script の URL) が設定されていません。README の手順で config.js を設定してください。');
      return;
    }
    route();
  }

  init();
})();
