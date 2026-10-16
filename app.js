(() => {
  'use strict';

  const STORAGE_KEY = 'score-ranking-v1';
  const $ = (sel) => document.querySelector(sel);
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ============================================================
  // 状態管理
  // ============================================================
  const defaultState = () => ({
    title: 'コンテスト',
    criteria: [
      { id: uid(), name: 'プレゼン力', max: 10 },
      { id: uid(), name: 'コミュニケーション力', max: 10 },
    ],
    participants: [],
  });

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.criteria) && Array.isArray(s.participants)) return s;
      }
    } catch (_) { /* ストレージ不可でも動作させる */ }
    return defaultState();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  const toNum = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const totalOf = (p) => state.criteria.reduce((sum, c) => sum + toNum(p.scores[c.id]), 0);
  const maxTotal = () => state.criteria.reduce((sum, c) => sum + toNum(c.max), 0);
  const fmt = (n) => (Math.round(n * 100) / 100).toString();

  // ============================================================
  // 画面描画
  // ============================================================
  const table = $('#scoreTable');

  function render() {
    $('#contestTitle').value = state.title;
    document.title = `${state.title} | スコアボード`;
    $('#lockSummary').textContent =
      `競技者 ${state.participants.length} 名 ／ 評価項目 ${state.criteria.length} 件`;
    table.innerHTML = '';

    const hint = $('#emptyHint');
    if (state.participants.length === 0 && state.criteria.length === 0) {
      hint.textContent = '競技者と評価項目を追加してください。';
    } else if (state.participants.length === 0) {
      hint.textContent = '競技者を追加すると得点を入力できます。';
    } else if (state.criteria.length === 0) {
      hint.textContent = '評価項目を追加すると得点を入力できます。';
    } else {
      hint.textContent = '';
    }

    // ヘッダー
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    const thName = document.createElement('th');
    thName.className = 'name-col';
    thName.textContent = '競技者';
    hr.appendChild(thName);

    state.criteria.forEach((c) => {
      const th = document.createElement('th');
      const box = document.createElement('div');
      box.className = 'crit-head';

      const top = document.createElement('div');
      top.className = 'crit-top';
      const nameInput = document.createElement('input');
      nameInput.className = 'crit-name';
      nameInput.value = c.name;
      nameInput.setAttribute('aria-label', '項目名');
      nameInput.addEventListener('input', () => { c.name = nameInput.value; save(); });
      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.title = `「${c.name}」を削除`;
      del.textContent = '✕';
      del.addEventListener('click', () => removeCriterion(c.id));
      top.append(nameInput, del);

      const maxBox = document.createElement('label');
      maxBox.className = 'crit-max';
      maxBox.append('満点');
      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.min = '1';
      maxInput.value = c.max;
      maxInput.addEventListener('input', () => {
        c.max = toNum(maxInput.value);
        save();
        refreshScoreValidation();
        refreshTotals();
      });
      maxBox.appendChild(maxInput);

      box.append(top, maxBox);
      th.appendChild(box);
      hr.appendChild(th);
    });

    const thTotal = document.createElement('th');
    thTotal.innerHTML = `合計<br><span style="font-weight:400">/ <span id="maxTotal">${fmt(maxTotal())}</span></span>`;
    hr.appendChild(thTotal);
    thead.appendChild(hr);
    table.appendChild(thead);

    // 本体
    const tbody = document.createElement('tbody');
    state.participants.forEach((p) => {
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      tdName.className = 'name-col';
      const nameInput = document.createElement('input');
      nameInput.value = p.name;
      nameInput.setAttribute('aria-label', '競技者名');
      nameInput.addEventListener('input', () => { p.name = nameInput.value; save(); });
      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.title = `「${p.name}」を削除`;
      del.textContent = '✕';
      del.addEventListener('click', () => removeParticipant(p.id));
      const nameCell = document.createElement('div');
      nameCell.className = 'name-cell';
      nameCell.append(nameInput, del);
      tdName.appendChild(nameCell);
      tr.appendChild(tdName);

      state.criteria.forEach((c) => {
        const td = document.createElement('td');
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'score';
        inp.min = '0';
        inp.step = 'any';
        inp.inputMode = 'decimal';
        inp.value = p.scores[c.id] ?? '';
        inp.dataset.pid = p.id;
        inp.dataset.cid = c.id;
        inp.setAttribute('aria-label', `${p.name} の ${c.name}`);
        inp.addEventListener('input', () => {
          p.scores[c.id] = inp.value;
          save();
          refreshScoreValidation();
          refreshTotals();
        });
        td.appendChild(inp);
        tr.appendChild(td);
      });

      const tdTotal = document.createElement('td');
      tdTotal.className = 'total';
      tdTotal.dataset.pid = p.id;
      tr.appendChild(tdTotal);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    refreshScoreValidation();
    refreshTotals();
  }

  function refreshTotals() {
    state.participants.forEach((p) => {
      const td = table.querySelector(`td.total[data-pid="${p.id}"]`);
      if (td) td.textContent = fmt(totalOf(p));
    });
    const mt = $('#maxTotal');
    if (mt) mt.textContent = fmt(maxTotal());
    $('#announceBtn').disabled = state.participants.length === 0;
  }

  function refreshScoreValidation() {
    table.querySelectorAll('input.score').forEach((inp) => {
      const c = state.criteria.find((x) => x.id === inp.dataset.cid);
      const v = parseFloat(inp.value);
      inp.classList.toggle('over', Number.isFinite(v) && (v < 0 || (c && v > toNum(c.max))));
      if (c) inp.max = c.max;
    });
  }

  // ============================================================
  // 追加・削除
  // ============================================================
  $('#addParticipantForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#participantName');
    const name = input.value.trim();
    if (!name) return;
    state.participants.push({ id: uid(), name, scores: {} });
    input.value = '';
    save();
    render();
    input.focus();
  });

  $('#addCriterionForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = $('#criterionName');
    const name = nameInput.value.trim();
    if (!name) return;
    state.criteria.push({ id: uid(), name, max: toNum($('#criterionMax').value) || 10 });
    nameInput.value = '';
    save();
    render();
    nameInput.focus();
  });

  function removeParticipant(id) {
    const p = state.participants.find((x) => x.id === id);
    if (!p || !confirm(`競技者「${p.name}」を削除しますか？`)) return;
    state.participants = state.participants.filter((x) => x.id !== id);
    save();
    render();
  }

  function removeCriterion(id) {
    const c = state.criteria.find((x) => x.id === id);
    if (!c || !confirm(`評価項目「${c.name}」を削除しますか？\n(入力済みの得点も削除されます)`)) return;
    state.criteria = state.criteria.filter((x) => x.id !== id);
    state.participants.forEach((p) => { delete p.scores[id]; });
    save();
    render();
  }

  $('#contestTitle').addEventListener('input', (e) => {
    state.title = e.target.value;
    document.title = `${state.title} | スコアボード`;
    save();
  });

  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('すべての競技者・評価項目・得点を消去して初期状態に戻しますか？')) return;
    state = defaultState();
    save();
    render();
  });

  // ============================================================
  // 非表示モード (画面共有中に得点が見えないようにする)
  // 表示状態は保存せず、読み込み時は常に非表示から始める
  // ============================================================
  function setEditorVisible(visible) {
    $('#editor').hidden = !visible;
    $('#lockPanel').hidden = visible;
  }

  $('#showEditorBtn').addEventListener('click', () => {
    if (!confirm('競技者・評価項目・得点を表示します。\n画面共有中の場合は共有画面に映らないか確認してください。')) return;
    setEditorVisible(true);
  });
  $('#hideEditorBtn').addEventListener('click', () => setEditorVisible(false));

  // 保存・読込(JSON)
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.title || 'score'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#importInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const s = JSON.parse(await file.text());
      if (!Array.isArray(s.criteria) || !Array.isArray(s.participants)) throw new Error();
      s.participants.forEach((p) => { p.scores = p.scores || {}; });
      state = s;
      save();
      render();
    } catch (_) {
      alert('読み込めないファイルです。');
    }
    e.target.value = '';
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

  function burstConfetti(count, colors) {
    resizeCanvas();
    const W = canvas.width, H = canvas.height;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.3,
        y: H * 0.45,
        vx: (Math.random() - 0.5) * 26 * devicePixelRatio,
        vy: (-Math.random() * 22 - 8) * devicePixelRatio,
        w: (6 + Math.random() * 8) * devicePixelRatio,
        h: (4 + Math.random() * 6) * devicePixelRatio,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 0,
      });
    }
    if (!confettiRunning) { confettiRunning = true; requestAnimationFrame(tickConfetti); }
  }

  function rainConfetti(count, colors) {
    resizeCanvas();
    const W = canvas.width;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * W,
        y: -Math.random() * canvas.height * 0.6,
        vx: (Math.random() - 0.5) * 4 * devicePixelRatio,
        vy: (2 + Math.random() * 4) * devicePixelRatio,
        w: (6 + Math.random() * 8) * devicePixelRatio,
        h: (4 + Math.random() * 6) * devicePixelRatio,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 0,
      });
    }
    if (!confettiRunning) { confettiRunning = true; requestAnimationFrame(tickConfetti); }
  }

  function tickConfetti() {
    cctx.clearRect(0, 0, canvas.width, canvas.height);
    const g = 0.45 * devicePixelRatio;
    particles = particles.filter((p) => p.y < canvas.height + 40 && p.life < 900);
    particles.forEach((p) => {
      p.life++;
      p.vy += g;
      p.vx *= 0.985;
      p.vy = Math.min(p.vy, 7 * devicePixelRatio);
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
    else { confettiRunning = false; cctx.clearRect(0, 0, canvas.width, canvas.height); }
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

  // 同点は同順位 (1, 1, 3 ...)
  function computeRanking() {
    const list = state.participants
      .map((p) => ({ p, name: p.name || '(名前なし)', total: totalOf(p) }))
      .sort((a, b) => b.total - a.total);
    list.forEach((e, i) => {
      e.rank = i > 0 && e.total === list[i - 1].total ? list[i - 1].rank : i + 1;
    });
    return list;
  }

  const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function buildSteps() {
    const ranking = computeRanking();
    const top = ranking.filter((e) => e.rank <= 3);
    const lower = ranking.filter((e) => e.rank > 3);
    const s = [];

    s.push(async () => {
      stage.innerHTML = '';
      stage.append(el('div', 'spotlight'));
      stage.append(el('div', 'intro-title', '結果発表'));
      stage.append(el('div', 'intro-sub', `${state.title}  ／  参加者 ${ranking.length} 名`));
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
      state.criteria.forEach((c) => {
        bd.append(el('span', 'chip', `${c.name}: ${fmt(toNum(e.p.scores[c.id]))}`));
      });
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

  function openOverlay() {
    if (!state.participants.length) return;
    ctx(); // ユーザー操作中に AudioContext を有効化
    setEditorVisible(false); // 発表後に得点表が見えたままにならないよう隠す
    steps = buildSteps();
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

  $('#announceBtn').addEventListener('click', openOverlay);
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

  render();
  setEditorVisible(false);
})();
