(() => {
  'use strict';
  const D = window.HSK_DATA;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Dữ liệu ----------
  const WORDS = [];
  const BY_ID = {};
  for (const l of [1, 2, 3, 4]) {
    for (const row of D.vocab[l].split('\n')) {
      const [h, p, m] = row.split('|');
      const w = { id: l + h, h, p, m, l };
      WORDS.push(w); BY_ID[w.id] = w;
    }
  }
  const LV_TOTAL = { 1: 0, 2: 0, 3: 0, 4: 0 };
  WORDS.forEach((w) => LV_TOTAL[w.l]++);
  const IV = [0, 1, 3, 7, 14, 30, 60]; // khoảng cách ôn (ngày) theo hộp
  const MASTER = 3; // từ hộp này trở lên coi là đã thuộc
  const STROKES = window.HSK_STROKES || {};
  const canWrite = (w) => !!window.HanziWriter && [...w.h].every((c) => STROKES[c]);

  // ---------- Trạng thái ----------
  const KEY = 'chainies-v1';
  const DEF = { name: '', pal: 'mint', mode: 'auto', goal: 10, exam: '', pinyin: true, kai: false, lv: [1], w: {}, wr: {}, days: {}, quiz: [], t: 0, v: 2 };
  let S = { ...DEF };
  try { const raw = localStorage.getItem(KEY); if (raw) S = { ...DEF, ...JSON.parse(raw) }; } catch (e) {}

  function migrate() {
    // Bản đầu chọn sẵn cả 4 cấp. Người mới bắt đầu thì tập trung HSK 1 trước.
    if (S.v !== 2) { S.v = 2; if (!Object.keys(S.w).some((id) => id[0] !== '1')) S.lv = [1]; }
    if (!S.wr) S.wr = {};
  }
  migrate();
  let cloudRef = null, cloudBusy = false, cloudDirty = false, cloudTimer = 0, cloudState = 'local';
  function save() {
    S.t = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    if (cloudRef) { clearTimeout(cloudTimer); cloudTimer = setTimeout(pushCloud, 1500); }
  }
  async function pushCloud() {
    if (!cloudRef) return;
    if (cloudBusy) { cloudDirty = true; return; }
    cloudBusy = true;
    try { await cloudRef.set({ json: JSON.stringify(S), t: S.t }); cloudState = 'synced'; } catch (e) { cloudState = 'error'; }
    cloudBusy = false;
    if (cloudDirty) { cloudDirty = false; pushCloud(); }
  }
  async function initCloud() {
    try {
      if (!window.claude || !window.claude.use) return;
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db || !user) return;
      const id = await user.id();
      if (!id) return;
      const ref = db.collection('data/users/' + id).doc('state');
      const snap = await ref.get();
      cloudRef = ref; cloudState = 'synced';
      if (snap.exists) {
        const r = snap.data();
        if ((r.t || 0) > (S.t || 0)) {
          S = { ...DEF, ...JSON.parse(r.json) }; migrate();
          try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
          applyLook(); render();
        } else if ((S.t || 0) > (r.t || 0)) pushCloud();
      } else if (S.t) pushCloud();
      if (route() === 'tuy-chinh') render();
    } catch (e) {}
  }

  // ---------- Ngày tháng ----------
  const pad = (n) => String(n).padStart(2, '0');
  const ds = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => ds(new Date());
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ds(d); };
  const day = () => (S.days[today()] = S.days[today()] || { n: 0, r: 0, q: 0, t: 0, w: 0 });
  const active = (k) => { const d = S.days[k]; return !!d && (d.n + d.r + d.q + d.t + (d.w || 0)) > 0; };
  function streak() {
    const d = new Date(); let n = 0;
    if (!active(ds(d))) d.setDate(d.getDate() - 1);
    while (active(ds(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  // ---------- Số liệu ----------
  const inLv = (w) => S.lv.includes(w.l);
  const learned = () => Object.keys(S.w).filter((id) => BY_ID[id]);
  const dueWords = () => WORDS.filter((w) => S.w[w.id] && S.w[w.id][1] <= today());
  const newLeft = () => Math.max(0, S.goal - day().n);
  const newWords = (n) => WORDS.filter((w) => !S.w[w.id] && inLv(w)).slice(0, n);
  const status = (w) => { const s = S.w[w.id]; return !s ? 'new' : s[1] <= today() ? 'due' : s[0] >= MASTER ? 'done' : 'learning'; };
  const mastered = () => learned().filter((id) => S.w[id][0] >= MASTER).length;
  const lvDone = (l) => WORDS.filter((w) => w.l === l && S.w[w.id]).length;
  const quizAvg = () => { const q = S.quiz.slice(-5); return q.length ? Math.round(q.reduce((a, b) => a + b, 0) / q.length) : null; };
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- Phát âm ----------
  let claudeTts = null;
  function speak(text) {
    try {
      const ss = window.speechSynthesis;
      if (ss && typeof SpeechSynthesisUtterance !== 'undefined') {
        const vs = ss.getVoices();
        const zh = vs.find((v) => /^zh[-_](CN|Hans)/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang));
        if (zh || !claudeTts) {
          ss.cancel();
          const u = new SpeechSynthesisUtterance(text);
          u.lang = 'zh-CN'; if (zh) u.voice = zh; u.rate = 0.85;
          ss.speak(u); return;
        }
      }
      if (claudeTts) { claudeTts.speak(text, { language: 'zh', rate: 0.85 }).catch(() => {}); return; }
      toast('Thiết bị này chưa hỗ trợ đọc tiếng Trung');
    } catch (e) {}
  }
  try { if (window.speechSynthesis) window.speechSynthesis.getVoices(); } catch (e) {}

  // ---------- Giao diện chung ----------
  const I = {
    home: '<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="2.6"/><circle cx="16" cy="8" r="2.6"/><circle cx="8" cy="16" r="2.6"/><circle cx="16" cy="16" r="2.6"/></svg>',
    cards: '<svg viewBox="0 0 24 24"><rect x="4" y="7" width="13" height="13" rx="3"/><path d="M8 4h9a3 3 0 0 1 3 3v9"/></svg>',
    quiz: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5.5"/></svg>',
    talk: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z"/></svg>',
    book: '<svg viewBox="0 0 24 24"><path d="M12 6c-2-1.5-4.5-2-8-2v14c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2V4c-3.5 0-6 .5-8 2Zm0 0v14"/></svg>',
    pen: '<svg viewBox="0 0 24 24"><path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5 4 20Zm10-13.5 3 3"/></svg>',
    set: '<svg viewBox="0 0 24 24"><path d="M5 7h9m4 0h1M5 17h3m4 0h7"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
    say: '<svg class="ic" viewBox="0 0 24 24"><path d="M4 9.500v5h3.500L12 18V6L7.5 9.500H4Zm12-.5a4.200 4.2 0 0 1 0 6m2.5-8.500a8 8 0 0 1 0 11"/></svg>',
    go: '<svg class="ic" viewBox="0 0 24 24"><path d="M8 16 16 8m-6 0h6v6"/></svg>',
    prev: '<svg class="ic" viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg>',
    next: '<svg class="ic" viewBox="0 0 24 24"><path d="m10 6 6 6-6 6"/></svg>',
    ok: '<svg class="ic" viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9"/></svg>'
  };
  const NAV = [['home', 'Tổng quan', I.home], ['hoc', 'Thẻ từ', I.cards], ['viet', 'Luyện viết', I.pen], ['quiz', 'Kiểm tra', I.quiz], ['giao-tiep', 'Giao tiếp', I.talk], ['kho-tu', 'Tiến độ', I.book], ['tuy-chinh', 'Tuỳ chỉnh', I.set]];
  const route = () => { const r = location.hash.slice(1); return NAV.some((n) => n[0] === r) ? r : 'home'; };

  function applyLook() {
    const r = document.documentElement;
    if (S.pal === 'mint') r.removeAttribute('data-pal'); else r.setAttribute('data-pal', S.pal);
    if (S.kai) r.setAttribute('data-kai', '1'); else r.removeAttribute('data-kai');
    if (S.mode === 'light' || S.mode === 'dark') r.setAttribute('data-theme', S.mode);
  }
  let toastT = 0;
  function toast(msg) {
    let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- Tổng quan ----------
  let calM = null;
  function calendar() {
    const now = new Date();
    if (!calM) calM = { y: now.getFullYear(), m: now.getMonth() };
    const first = new Date(calM.y, calM.m, 1);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (i >= 35 && d.getMonth() !== calM.m) break;
      const k = ds(d);
      const cls = [d.getMonth() !== calM.m ? 'out' : '', active(k) ? 'done' : '', k === today() ? 'today' : '', k === S.exam ? 'exam' : ''].join(' ');
      cells += `<i class="${cls}">${d.getDate()}</i>`;
    }
    return `<div class="card cal">
      <div class="cal-head"><strong>Tháng ${calM.m + 1}, ${calM.y}</strong>
        <div><button class="icon-btn" data-a="cal" data-v="-1" aria-label="Tháng trước">${I.prev}</button><button class="icon-btn" data-a="cal" data-v="1" aria-label="Tháng sau">${I.next}</button></div></div>
      <div class="cal-grid">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((d) => `<span>${d}</span>`).join('')}${cells}</div>
      <div class="legend"><span><i></i>Ngày có học</span><span><i class="t"></i>Hôm nay</span>${S.exam ? '<span><i class="e"></i>Ngày thi</span>' : ''}</div>
    </div>`;
  }
  function goals() {
    const d = day(), due = dueWords().length, has = learned().length > 0;
    return [
      { ok: d.n >= S.goal, t: `Học ${S.goal} từ mới`, s: `${Math.min(d.n, S.goal)}/${S.goal} từ`, to: 'hoc' },
      { ok: has && due === 0, t: 'Ôn thẻ đến hạn', s: !has ? 'Chưa có thẻ nào, học từ mới trước' : due ? `Còn ${due} thẻ` : 'Đã ôn hết', to: 'hoc' },
      { ok: (d.w || 0) >= 3, t: 'Luyện viết 3 chữ', s: `${Math.min(d.w || 0, 3)}/3 chữ, theo đúng thứ tự nét`, to: 'viet' },
      { ok: d.q > 0, t: 'Làm một bài kiểm tra', s: d.q ? `Đã làm ${d.q} bài` : '10 câu, khoảng 3 phút', to: 'quiz' },
      { ok: d.t > 0, t: 'Luyện nói một chủ đề', s: d.t ? 'Đã luyện hôm nay' : 'Nghe và nhắc lại từng câu', to: 'giao-tiep' }
    ];
  }
  function vHome() {
    const g = goals(), left = g.filter((x) => !x.ok).length, due = dueWords().length, avg = quizAvg();
    let sub = 'Đặt ngày thi HSK4 trong phần Tuỳ chỉnh để đếm ngược.';
    if (S.exam) {
      const n = Math.round((new Date(S.exam + 'T00:00') - new Date(today() + 'T00:00')) / 864e5);
      sub = n > 0 ? `Còn ${n} ngày đến kỳ thi HSK4. 加油!` : n === 0 ? 'Hôm nay là ngày thi. 祝你成功!' : 'Kỳ thi đã qua. Đặt mục tiêu mới nhé.';
    }
    const cc = ['c1', 'c2', 'c4', 'c3'];
    return `<div class="top"><div><h1>Chào mừng trở lại${S.name ? ', ' + esc(S.name) : ''} 👋</h1><p>${sub}</p></div>
      <span class="chip">Chuỗi <b class="num">${streak()}</b> ngày</span>
      <a class="avatar han" href="#tuy-chinh" aria-label="Tuỳ chỉnh">${esc((S.name || '学').trim().charAt(0).toUpperCase())}</a></div>
    <div class="cols"><div class="col">
      <h2>Việc hôm nay <small>(${left})</small></h2>
      <div class="grid g3">
        <a class="card act c1" href="#hoc"><span class="big num">${due}</span><strong>Ôn tập</strong><small>thẻ đến hạn</small><span class="go">${I.go}</span></a>
        <a class="card act c2" href="#hoc"><span class="big num">${Math.min(newLeft(), newWords(99).length)}</span><strong>Từ mới</strong><small>mục tiêu ${S.goal} từ/ngày</small><span class="go">${I.go}</span></a>
        <a class="card act c3" href="#viet"><span class="big num">${Object.keys(S.wr).length}</span><strong>Luyện viết</strong><small>chữ đã viết đúng</small><span class="go">${I.go}</span></a>
      </div>
      <h2>Tiến độ học</h2>
      <div class="grid g3 keep">
        <a class="card stat c1" href="#kho-tu"><small>Đã thuộc</small><b class="num">${mastered()}</b></a>
        <a class="card stat c2" href="#kho-tu"><small>Cần ôn</small><b class="num">${due}</b></a>
        <a class="card stat c3" href="#quiz"><small>Kiểm tra</small><b class="num">${avg === null ? '–' : avg}</b></a>
      </div>
      <div class="grid g2">${[1, 2, 3, 4].map((l, i) => {
        const n = lvDone(l), tot = LV_TOTAL[l];
        return `<div class="card lvl ${cc[i]}"><div class="row"><strong>HSK ${l}</strong><small class="num">${n}/${tot} từ</small></div><div class="bar"><i style="width:${(n / tot) * 100}%"></i></div></div>`;
      }).join('')}</div>
    </div><div class="col">
      <h2>Lịch học</h2>${calendar()}
      ${g.map((x) => `<a class="todo ${x.ok ? 'ok' : ''}" href="#${x.to}"><span class="dot">${x.ok ? I.ok : I.go}</span><div><strong>${x.t}</strong><small>${x.s}</small></div></a>`).join('')}
    </div></div>`;
  }

  // ---------- Thẻ từ ----------
  let sess = null;
  const lvSeg = () => `<div class="seg" role="group" aria-label="Cấp độ">${[1, 2, 3, 4].map((l) => `<button data-a="lv" data-v="${l}" aria-pressed="${S.lv.includes(l)}">HSK ${l}</button>`).join('')}</div>`;
  function startSess(extra) {
    const q = shuffle(dueWords()).concat(newWords(extra ? S.goal : newLeft()));
    sess = { q: q.map((w) => w.id), i: 0, flip: false, total: q.length, done: 0 };
  }
  function vCards() {
    if (!sess) startSess(false);
    const head = `<div class="rowx"><h1>Thẻ từ</h1>${lvSeg()}</div>`;
    if (sess.i >= sess.q.length) {
      const fin = sess.total > 0;
      return `<div class="page">${head}<div class="card empty c1"><div class="h">${fin ? '太棒了' : '休息'}</div>
        <h2>${fin ? 'Xong phiên học này!' : 'Hôm nay không còn thẻ nào'}</h2>
        <p class="mute">${fin ? `Bạn vừa đi qua ${sess.total} thẻ.` : 'Bạn đã học đủ từ mới và ôn hết thẻ đến hạn.'} Muốn học thêm thì lấy thêm ${S.goal} từ mới.</p>
        <div class="rowx"><button class="btn" data-a="more">Học thêm ${S.goal} từ</button><a class="btn ghost" href="#quiz">Làm bài kiểm tra</a></div></div></div>`;
    }
    const w = BY_ID[sess.q[sess.i]], isNew = !S.w[w.id];
    const col = ['c1', 'c2', 'c3', 'c4'][w.l - 1];
    return `<div class="page">${head}
      <div class="prog" aria-hidden="true"><i style="width:${(sess.done / Math.max(1, sess.total)) * 100}%"></i></div>
      <div class="flash card ${col}" data-a="flip" role="button" tabindex="0" aria-label="Lật thẻ">
        <span class="tag">HSK ${w.l} · ${isNew ? 'Từ mới' : 'Ôn tập'}</span>
        <button class="icon-btn say" data-a="say" data-v="${esc(w.h)}" aria-label="Nghe phát âm">${I.say}</button>
        <div class="h">${esc(w.h)}</div>
        ${sess.flip || (S.pinyin && isNew) ? `<div class="p">${esc(w.p)}</div>` : ''}
        ${sess.flip ? `<div class="m">${esc(w.m)}</div>` : '<div class="hint">Chạm để xem nghĩa</div>'}
      </div>
      ${sess.flip ? `<div class="rate">
        <button class="card c2" data-a="rate" data-v="0">Chưa nhớ<small>hỏi lại ngay</small></button>
        <button class="card c3" data-a="rate" data-v="1">Hơi nhớ<small>ôn lại sớm</small></button>
        <button class="card c1" data-a="rate" data-v="2">Nhớ rồi<small>giãn lịch ôn</small></button>
      </div>${canWrite(w) ? `<button class="btn ghost" data-a="towrite" data-v="${w.id}">${I.pen.replace('<svg', '<svg class="ic"')} Luyện viết chữ này</button>` : ''}` : `<button class="btn" data-a="flip">Xem nghĩa</button>`}
      <p class="mute num" style="text-align:center;margin:0">${sess.done}/${sess.total} thẻ</p></div>`;
  }
  function rate(v) {
    const id = sess.q[sess.i], cur = S.w[id], d = day();
    if (!cur) d.n++; else d.r++;
    let box = cur ? cur[0] : 0;
    if (v === 0) { box = 1; sess.q.push(id); S.w[id] = [box, today()]; }
    else {
      box = v === 2 ? Math.min(6, box + 1) : Math.max(1, box);
      S.w[id] = [box, addDays(v === 2 ? IV[box] : 1)];
      sess.done++;
    }
    sess.i++; sess.flip = false; save(); render();
  }

  // ---------- Luyện viết ----------
  let wr = { id: null, c: 0, mode: 'anim' }, writer = null;
  const writeList = () => WORDS.filter((w) => inLv(w) && canWrite(w));
  function cssColor(name) {
    try {
      const c = document.createElement('canvas').getContext('2d');
      c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return c.fillStyle;
    } catch (e) { return '#222222'; }
  }
  function vWrite() {
    const list = writeList();
    const head = `<div class="rowx"><h1>Luyện viết</h1><span class="chip">Đã viết đúng <b class="num" id="wcount">${Object.keys(S.wr).length}</b> chữ</span></div>`;
    if (!list.length) {
      return `<div class="page">${head}<div class="card empty c4"><div class="h">写字</div><h2>${window.HanziWriter ? 'Chưa có dữ liệu nét cho cấp độ đang chọn' : 'Không tải được công cụ vẽ nét'}</h2>
        <p class="mute">${window.HanziWriter ? 'Hiện phần luyện viết có đủ 174 chữ của HSK 1. Hãy bật HSK 1 ở trang Thẻ từ.' : 'Kiểm tra kết nối mạng rồi mở lại trang.'}</p><a class="btn" href="#hoc">Tới Thẻ từ</a></div></div>`;
    }
    let i = list.findIndex((w) => w.id === wr.id);
    if (i < 0) { i = Math.max(0, list.findIndex((w) => [...w.h].some((c) => !S.wr[c]))); wr.id = list[i].id; wr.c = 0; }
    const w = list[i], chars = [...w.h];
    if (wr.c >= chars.length) wr.c = 0;
    const ch = chars[wr.c], n = STROKES[ch].strokes.length;
    return `<div class="page">${head}
      <div class="card write c4">
        <div class="winfo"><div><span class="han wword">${esc(w.h)}</span><p>${esc(w.p)} · ${esc(w.m)}</p></div>
          <button class="icon-btn say" data-a="say" data-v="${esc(w.h)}" aria-label="Nghe phát âm" style="position:static;background:var(--shell)">${I.say}</button></div>
        ${chars.length > 1 ? `<div class="seg" role="group" aria-label="Chọn chữ">${chars.map((c, k) => `<button class="han" data-a="wchar" data-v="${k}" aria-pressed="${k === wr.c}">${esc(c)}${S.wr[c] ? ' ✓' : ''}</button>`).join('')}</div>` : ''}
        <div class="tian" id="hz" data-c="${esc(ch)}" aria-label="Ô viết chữ ${esc(ch)}"></div>
        <p id="wst" class="num" role="status">${wr.mode === 'quiz' ? `Viết nét 1/${n} bằng ngón tay hoặc chuột` : `${n} nét${S.wr[ch] ? ` · đã viết đúng ${S.wr[ch]} lần` : ''}`}</p>
        <div class="seg"><button data-a="wmode" data-v="anim" aria-pressed="${wr.mode === 'anim'}">Xem thứ tự nét</button><button data-a="wmode" data-v="quiz" aria-pressed="${wr.mode === 'quiz'}">Tự viết</button></div>
      </div>
      <div class="rowx"><button class="btn ghost" data-a="wnav" data-v="-1">${I.prev} Từ trước</button><span class="mute num">${i + 1}/${list.length}</span><button class="btn" data-a="wnav" data-v="1">Từ sau ${I.next}</button></div>
      <details class="card"><summary>Chọn chữ khác</summary><div class="pick">${list.map((x) => `<button class="han ${[...x.h].every((c) => S.wr[c]) ? 'ok' : ''}" data-a="wpick" data-v="${x.id}" ${x.id === w.id ? 'aria-current="true"' : ''}>${esc(x.h)}</button>`).join('')}</div></details></div>`;
  }
  function mountWriter() {
    const box = $('#hz'); writer = null;
    if (!box || !window.HanziWriter) return;
    const ch = box.dataset.c, size = Math.min(300, box.clientWidth), st = $('#wst'), n = STROKES[ch].strokes.length;
    writer = window.HanziWriter.create(box, ch, {
      width: size, height: size, padding: 14, showOutline: true, showCharacter: wr.mode !== 'quiz',
      strokeColor: cssColor('--ink'), outlineColor: cssColor('--line'), drawingColor: cssColor('--ink'), highlightColor: cssColor('--bad'),
      drawingWidth: 26, strokeAnimationSpeed: 1, delayBetweenStrokes: 220, showHintAfterMisses: 2,
      charDataLoader: (c, done) => done(STROKES[c])
    });
    if (wr.mode === 'anim') writer.animateCharacter();
    else {
      let miss = 0;
      writer.quiz({
        onMistake: () => { miss++; st.textContent = 'Chưa đúng nét, thử lại. Sai 2 lần sẽ có gợi ý.'; },
        onCorrectStroke: (d) => { if (d.strokesRemaining) st.textContent = `Đúng rồi. Viết nét ${d.strokeNum + 2}/${n}`; },
        onComplete: () => {
          S.wr[ch] = (S.wr[ch] || 0) + 1; const d = day(); d.w = (d.w || 0) + 1; save();
          st.textContent = miss ? `Hoàn thành, sai ${miss} nét. Viết lại lần nữa cho nhớ nhé.` : 'Hoàn hảo, không sai nét nào!';
          const c = $('#wcount'); if (c) c.textContent = Object.keys(S.wr).length;
        }
      });
    }
  }

  // ---------- Kiểm tra ----------
  let quiz = null;
  function startQuiz() {
    let pool = learned().map((id) => BY_ID[id]);
    if (pool.length < 10) pool = WORDS.filter(inLv);
    if (pool.length < 4) pool = WORDS;
    const qs = shuffle(pool).slice(0, 10).map((w, i) => {
      const same = WORDS.filter((x) => x.l === w.l && x.h !== w.h && x.m !== w.m);
      return { w, type: i % 2, opts: shuffle(shuffle(same).slice(0, 3).concat(w)), pick: null };
    });
    quiz = { qs, i: 0, right: 0 };
  }
  function vQuiz() {
    if (!quiz) {
      const n = learned().length;
      return `<div class="page"><h1>Kiểm tra</h1><div class="card empty c3"><div class="h">考试</div><h2>10 câu trắc nghiệm</h2>
        <p class="mute">${n >= 10 ? `Câu hỏi lấy từ ${n} từ bạn đã học.` : 'Bạn chưa học đủ 10 từ nên câu hỏi lấy từ các cấp độ đang chọn.'} Từ trả lời sai sẽ quay lại hàng ôn tập.</p>
        <button class="btn" data-a="qstart">Bắt đầu</button>
        ${S.quiz.length ? `<p class="mute num">Các lần gần đây: ${S.quiz.slice(-5).join(' · ')} điểm</p>` : ''}</div></div>`;
    }
    if (quiz.i >= quiz.qs.length) {
      const sc = quiz.right * 10;
      return `<div class="page"><h1>Kiểm tra</h1><div class="card empty ${sc >= 60 ? 'c1' : 'c2'}"><div class="h num">${sc}</div>
        <h2>${sc >= 90 ? 'Xuất sắc!' : sc >= 60 ? 'Đạt rồi, tiếp tục nhé' : 'Cần ôn thêm một chút'}</h2>
        <p class="mute">Đúng ${quiz.right}/10 câu. HSK4 cần 180/300 điểm, tức khoảng 60%.</p>
        <div class="rowx"><button class="btn" data-a="qstart">Làm bài mới</button><a class="btn ghost" href="#hoc">Ôn thẻ từ</a></div></div></div>`;
    }
    const q = quiz.qs[quiz.i], w = q.w;
    return `<div class="page"><div class="rowx"><h1>Kiểm tra</h1><span class="chip num">Câu <b>${quiz.i + 1}</b>/10</span></div>
      <div class="prog" aria-hidden="true"><i style="width:${quiz.i * 10}%"></i></div>
      <div class="flash card c4" style="min-height:210px">
        ${q.type === 0 ? `<button class="icon-btn say" data-a="say" data-v="${esc(w.h)}" aria-label="Nghe phát âm">${I.say}</button><div class="h">${esc(w.h)}</div>${q.pick !== null ? `<div class="p">${esc(w.p)}</div>` : ''}`
        : `<div class="m" style="font-size:1.6rem">${esc(w.m)}</div><div class="hint">Chọn chữ Hán đúng</div>`}
      </div>
      <div class="opts">${q.opts.map((o, k) => {
        const cls = q.pick === null ? '' : o === w ? 'right' : k === q.pick ? 'wrong' : '';
        return `<button class="${q.type ? 'han ' : ''}${cls}" data-a="pick" data-v="${k}" ${q.pick !== null ? 'disabled' : ''}>${esc(q.type ? o.h : o.m)}</button>`;
      }).join('')}</div>
      ${q.pick !== null ? `<button class="btn" data-a="qnext">${quiz.i === 9 ? 'Xem kết quả' : 'Câu tiếp'}</button>` : ''}</div>`;
  }

  // ---------- Giao tiếp ----------
  let topic = null;
  function vTalk() {
    const cc = ['c1', 'c2', 'c3', 'c4'];
    if (!topic) {
      return `<div class="page"><h1>Giao tiếp</h1><p class="mute" style="margin:0">Chọn một chủ đề, chạm vào từng câu để nghe rồi nhắc lại thành tiếng.</p>
        <div class="grid">${D.talks.map((t, i) => `<button class="card topic ${cc[i % 4]}" data-a="topic" data-v="${t.id}"><span class="dot">H${t.level}</span><div><strong>${esc(t.title)}</strong><small>${t.lines.length} câu · HSK ${t.level}</small></div><span class="go" style="position:static;margin-left:auto">${I.go}</span></button>`).join('')}</div></div>`;
    }
    const t = D.talks.find((x) => x.id === topic);
    return `<div class="page"><div class="rowx"><div><button class="chip" data-a="topic" data-v="">${I.prev} Chủ đề</button></div>
      <div class="seg"><button data-a="tpin" aria-pressed="${S.pinyin}">Pinyin</button><button data-a="tvi" aria-pressed="${S.vi !== false}">Nghĩa</button></div></div>
      <h1>${esc(t.title)}</h1>
      <div class="grid">${t.lines.map((l) => `<button class="line" data-a="line" data-v="${esc(l[0])}">${I.say}<div><span class="han">${esc(l[0])}</span>${S.pinyin ? `<p>${esc(l[1])}</p>` : ''}${S.vi !== false ? `<p class="mute">${esc(l[2])}</p>` : ''}</div></button>`).join('')}</div></div>`;
  }

  // ---------- Kho từ ----------
  let find = '', findLv = S.lv.length === 1 ? S.lv[0] : 0, findSt = '';
  function wordList() {
    const f = find.trim().toLowerCase();
    const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
    const fs = strip(f);
    const list = WORDS.filter((w) => (!findLv || w.l === findLv) && (!findSt || status(w) === findSt) && (!f || w.h.includes(f) || strip(w.p).replace(/\s/g, '').includes(fs.replace(/\s/g, '')) || strip(w.m).includes(fs)));
    const shown = list.slice(0, 240);
    if (!list.length) return '<p class="mute" style="margin:0">Không có từ nào ở mục này.</p>';
    return `<p class="mute num" style="margin:0">${list.length} từ${list.length > 240 ? ', đang hiện 240 từ đầu' : ''}. Chạm vào từ để nghe.</p>
      <div class="words">${shown.map((w) => {
        return `<button class="word st-${status(w)}" data-a="say" data-v="${esc(w.h)}"><span class="han">${esc(w.h)}</span><div>${esc(w.p)}<em>${esc(w.m)}</em></div></button>`;
      }).join('')}</div>`;
  }
  function vList() {
    return `<div class="page wide"><div class="rowx"><h1>Tiến độ</h1>
      <div class="seg" role="group" aria-label="Lọc cấp độ">${[0, 1, 2, 3, 4].map((l) => `<button data-a="flv" data-v="${l}" aria-pressed="${findLv === l}">${l ? 'HSK ' + l : 'Tất cả'}</button>`).join('')}</div></div>
      <div class="grid g4">${[['done', 'Đã thuộc', 'c1'], ['due', 'Cần ôn', 'c2'], ['learning', 'Đang học', 'c3'], ['new', 'Chưa học', '']].map(([k, t, c]) =>
        `<button class="card stat ${c}" data-a="fst" data-v="${k}" aria-pressed="${findSt === k}"><small>${t}</small><b class="num">${WORDS.filter((w) => (!findLv || w.l === findLv) && status(w) === k).length}</b></button>`).join('')}</div>
      <p class="mute" style="margin:0">Một từ được tính là đã thuộc sau 3 lần bạn chấm "Nhớ rồi". Từ cần ôn là từ đã đến hạn ôn lại hoặc vừa trả lời sai.</p>
      <input class="search" id="find" type="search" placeholder="Tìm chữ Hán, pinyin hoặc nghĩa (vd: xuexi, cảm ơn)" value="${esc(find)}" aria-label="Tìm từ">
      <div id="wl" class="set" style="gap:14px">${wordList()}</div></div>`;
  }

  // ---------- Tuỳ chỉnh ----------
  let resetAsk = false;
  function vSet() {
    const pals = [['mint', 165, 'Bạc hà'], ['peach', 340, 'Hồng đào'], ['butter', 40, 'Bơ'], ['lilac', 262, 'Oải hương'], ['sky', 208, 'Da trời']];
    const seg = (a, cur, opts) => `<div class="seg">${opts.map(([v, t]) => `<button data-a="${a}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${t}</button>`).join('')}</div>`;
    const sync = cloudState === 'synced' ? 'Tiến độ được lưu vào tài khoản Claude của bạn và trên thiết bị này.' : cloudState === 'error' ? 'Không lưu được lên tài khoản, tiến độ vẫn được giữ trên thiết bị này.' : 'Tiến độ được lưu trên trình duyệt của thiết bị này.';
    return `<div class="page"><h1>Tuỳ chỉnh</h1>
      <div class="card set"><label for="name">Tên của bạn</label><input id="name" type="text" maxlength="24" placeholder="Nhập tên để được chào" value="${esc(S.name)}">
        <label for="exam" style="margin-top:8px">Ngày thi HSK4</label><input id="exam" type="date" value="${esc(S.exam)}">
        <span class="lab" style="margin-top:8px">Từ mới mỗi ngày</span>${seg('goal', S.goal, [[5, '5'], [10, '10'], [15, '15'], [20, '20'], [30, '30']])}
        <small class="mute">Với ${WORDS.length} từ trong kho, ${S.goal} từ/ngày sẽ đi hết trong khoảng ${Math.ceil((WORDS.length - learned().length) / S.goal)} ngày.</small></div>
      <div class="card set"><span class="lab">Màu chủ đạo</span>
        <div class="sw">${pals.map(([v, h, t]) => `<button data-a="pal" data-v="${v}" aria-pressed="${S.pal === v}" aria-label="${t}" title="${t}" style="background:hsl(${h} 45% 76%)"></button>`).join('')}</div>
        <span class="lab" style="margin-top:8px">Nền</span>${seg('mode', S.mode, [['auto', 'Tự động'], ['light', 'Sáng'], ['dark', 'Tối']])}
        <span class="lab" style="margin-top:8px">Kiểu chữ Hán</span>${seg('kai', S.kai ? 1 : 0, [[0, '<span class="han" style="font-family:PingFang SC,Noto Sans SC,sans-serif">学习 Hiện đại</span>'], [1, '<span style="font-family:Kaiti SC,STKaiti,KaiTi,serif">学习 Khải thư</span>']])}
        <span class="lab" style="margin-top:8px">Hiện pinyin trên thẻ từ mới</span>${seg('pin', S.pinyin ? 1 : 0, [[1, 'Có'], [0, 'Ẩn để tự đoán']])}</div>
      <div class="card set"><span class="lab">Dữ liệu học</span><small class="mute">${sync}</small>
        ${resetAsk ? `<div class="rowx" style="justify-content:flex-start"><button class="btn warn" data-a="reset2">Xoá hết ${learned().length} từ đã học</button><button class="btn ghost" data-a="reset0">Giữ lại</button></div>` : `<div><button class="btn ghost" data-a="reset1">Học lại từ đầu</button></div>`}</div></div>`;
  }

  // ---------- Vẽ & sự kiện ----------
  const VIEWS = { home: vHome, hoc: vCards, viet: vWrite, quiz: vQuiz, 'giao-tiep': vTalk, 'kho-tu': vList, 'tuy-chinh': vSet };
  function render() {
    const r = route();
    $('#app').innerHTML = `<div class="shell"><nav class="rail" aria-label="Điều hướng"><div class="logo" aria-hidden="true">学</div>
      ${NAV.map(([id, t, ic]) => `<a href="#${id}" title="${t}" aria-label="${t}" ${id === r ? 'aria-current="page"' : ''}>${ic}</a>`).join('')}</nav>
      <main>${VIEWS[r]()}</main></div>`;
    if (r === 'viet') mountWriter();
  }
  const A = {
    cal(v) { calM.m += +v; if (calM.m < 0) { calM.m = 11; calM.y--; } if (calM.m > 11) { calM.m = 0; calM.y++; } },
    lv(v) { v = +v; S.lv = S.lv.includes(v) ? S.lv.filter((x) => x !== v) : S.lv.concat(v).sort(); if (!S.lv.length) S.lv = [v]; sess = null; save(); },
    flip() { sess.flip = !sess.flip; if (sess.flip) speak(BY_ID[sess.q[sess.i]].h); },
    say(v) { speak(v); return false; },
    rate(v) { rate(+v); return false; },
    more() { startSess(true); },
    qstart() { startQuiz(); },
    pick(v) {
      const q = quiz.qs[quiz.i]; q.pick = +v;
      const ok = q.opts[q.pick] === q.w;
      if (ok) quiz.right++; else if (S.w[q.w.id]) { S.w[q.w.id] = [1, today()]; sess = null; }
      speak(q.w.h);
    },
    qnext() {
      quiz.i++;
      if (quiz.i >= quiz.qs.length) { S.quiz = S.quiz.concat(quiz.right * 10).slice(-20); day().q++; save(); }
    },
    topic(v) { topic = v || null; },
    tpin() { S.pinyin = !S.pinyin; save(); },
    tvi() { S.vi = S.vi === false; save(); },
    line(v) { speak(v); const d = day(); if (!d.t) { d.t = 1; save(); } return false; },
    flv(v) { findLv = +v; },
    fst(v) { findSt = findSt === v ? '' : v; },
    towrite(v) { wr.id = v; wr.c = 0; wr.mode = 'anim'; location.hash = 'viet'; return false; },
    wmode(v) { wr.mode = v; },
    wchar(v) { wr.c = +v; },
    wpick(v) { wr.id = v; wr.c = 0; },
    wnav(v) { const l = writeList(), i = l.findIndex((w) => w.id === wr.id); wr.id = l[(i + +v + l.length) % l.length].id; wr.c = 0; },
    goal(v) { S.goal = +v; sess = null; save(); },
    pal(v) { S.pal = v; save(); applyLook(); },
    mode(v) { S.mode = v; if (v === 'auto') document.documentElement.removeAttribute('data-theme'); save(); applyLook(); },
    kai(v) { S.kai = v === '1'; save(); applyLook(); },
    pin(v) { S.pinyin = v === '1'; save(); },
    reset1() { resetAsk = true; },
    reset0() { resetAsk = false; },
    reset2() { S.w = {}; S.wr = {}; S.days = {}; S.quiz = []; sess = null; quiz = null; resetAsk = false; save(); toast('Đã xoá tiến độ học'); }
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const fn = A[el.dataset.a]; if (!fn) return;
    if (el.dataset.a === 'say') e.stopPropagation();
    if (fn(el.dataset.v) !== false) render();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.flash[data-a]')) { e.preventDefault(); A.flip(); render(); }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'find') { find = t.value; $('#wl').innerHTML = wordList(); }
    if (t.id === 'name') { S.name = t.value; save(); }
    if (t.id === 'exam') { S.exam = t.value; save(); }
  });
  window.addEventListener('hashchange', () => { resetAsk = false; if (route() === 'hoc') sess = null; render(); window.scrollTo(0, 0); });

  applyLook(); render();
  initCloud();
  if (window.claude && window.claude.use) window.claude.use('tts').then((t) => { claudeTts = t; }).catch(() => {});
})();
