/**
 * 사이트 관리 화면
 *
 * 설정을 바꾸면 오른쪽 미리보기에 바로 보이고, [저장]을 눌러야 실제 신청 화면에 반영됩니다.
 * 서버(Apps Script)의 getSite / adminLogin / saveSite 를 씁니다 (site-settings.gs).
 */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SITE = window.SITE;
  const TOKEN_KEY = 'ssu-admin-token';
  const SITE_CACHE = 'ssu-site-v1';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const PRESETS = [
    { name: '숭실 블루', hex: '#006694' },
    { name: '남색', hex: '#0B2D57' },
    { name: '청록', hex: '#00707A' },
    { name: '하늘', hex: '#0077B6' },
    { name: '진회색', hex: '#3D4852' }
  ];

  let adminToken = '';
  let saved = null;   // 서버에 저장된 설정
  let draft = null;   // 화면에서 고치는 중인 설정
  let pendingDraft = null; // 로그인이 만료됐을 때 고치던 내용 (다시 로그인하면 되살립니다)

  /* ================= 서버 ================= */

  function apiReady() {
    return CFG.API_URL && !/여기에_배포_ID/.test(CFG.API_URL);
  }

  async function api(action, data) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CFG.TIMEOUT_MS || 30000);
    try {
      const res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action }, data || {})),
        redirect: 'follow',
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /* ================= 알림 ================= */

  let toastTimer = null;
  function toast(msg, isAlert) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('is-alert', !!isAlert);
    el.classList.add('is-up');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-up'), 4200);
  }

  function busy(btn, on, label) {
    btn.classList.toggle('is-busy', on);
    btn.disabled = !!on;
    if (label !== undefined) btn.textContent = label;
  }

  /* ================= 로그인 ================= */

  function showLogin(msg) {
    $('#viewApp').hidden = true;
    $('#viewLogin').hidden = false;
    const err = $('#loginError');
    err.textContent = msg || '';
    err.hidden = !msg;
    setTimeout(() => $('#loginPassword').focus(), 50);
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#btnLogin');
    const pw = $('#loginPassword').value;
    if (!apiReady()) { showLogin('config.js 에 API 주소가 설정되지 않았습니다.'); return; }
    if (!pw) { showLogin('비밀번호를 입력해 주세요.'); return; }
    busy(btn, true, '확인 중');
    let r;
    try { r = await api('adminLogin', { password: pw }); } catch (err) {
      busy(btn, false, '로그인');
      showLogin('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    busy(btn, false, '로그인');
    if (!r || !r.ok) { showLogin((r && r.message) || '로그인하지 못했습니다.'); $('#loginPassword').select(); return; }
    adminToken = r.adminToken;
    try { sessionStorage.setItem(TOKEN_KEY, adminToken); } catch (err) { /* 넘어갑니다 */ }
    $('#loginPassword').value = '';
    enterApp();
  });

  $('#btnLogout').addEventListener('click', async () => {
    if (isDirty() && !confirm('저장하지 않은 변경 사항이 있습니다. 그래도 로그아웃할까요?')) return;
    try { await api('adminLogout', { adminToken }); } catch (e) { /* 넘어갑니다 */ }
    adminToken = '';
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* 넘어갑니다 */ }
    saved = draft = null;
    showLogin('로그아웃했습니다.');
    $('#loginError').hidden = true;
  });

  /* ================= 시작 ================= */

  async function start() {
    if (!SITE) { showLogin('site.js 를 불러오지 못했습니다. 파일이 같은 폴더에 있는지 확인해 주세요.'); return; }
    if (!apiReady()) { showLogin('config.js 에 API 주소가 설정되지 않았습니다. 관리 기능을 쓰려면 먼저 서버 주소를 넣어 주세요.'); return; }
    try { adminToken = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { adminToken = ''; }
    if (!adminToken) { showLogin(); return; }
    try {
      const r = await api('adminCheck', { adminToken });
      if (r && r.ok) { enterApp(); return; }
    } catch (e) { /* 아래에서 로그인 화면으로 */ }
    showLogin();
  }

  async function enterApp() {
    $('#viewLogin').hidden = true;
    $('#viewApp').hidden = false;
    $('#editorLoading').hidden = false;
    $('#editorBody').hidden = true;
    let r;
    try { r = await api('getSite'); } catch (e) { r = null; }
    if (!r || !r.ok) {
      $('#editorLoading').textContent = '설정을 불러오지 못했습니다. 새로고침해 주세요.';
      return;
    }
    saved = SITE.clean(r.site);
    draft = clone(saved);
    if (pendingDraft) {
      draft = pendingDraft;
      pendingDraft = null;
      toast('고치던 내용을 되살렸습니다. 다시 저장해 주세요.');
    }
    $('#editorLoading').hidden = true;
    $('#editorBody').hidden = false;
    renderForm();
    pushPreview();
    fitPreview();
  }

  /* ================= 값 읽기 · 쓰기 ================= */

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
    target[last] = value;
  }

  function isDirty() {
    return !!(saved && draft) && JSON.stringify(SITE.clean(draft)) !== JSON.stringify(saved);
  }

  function changed() {
    pushPreviewSoon();
    paintSaveBar();
  }

  function paintSaveBar() {
    const dirty = isDirty();
    const st = $('#saveStatus');
    st.textContent = dirty ? '저장하지 않은 변경 사항이 있습니다' : '변경 사항 없음';
    st.classList.toggle('is-dirty', dirty);
    $('#btnSave').disabled = !dirty;
    $('#btnRevert').disabled = !dirty;
  }

  /* ================= 화면 채우기 ================= */

  function renderForm() {
    $$('[data-path]').forEach((el) => {
      const v = getPath(draft, el.dataset.path);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = el.value === v;
      else el.value = v == null ? '' : v;
    });
    $$('[data-links]').forEach(renderLinks);
    renderLogo();
    renderColor();
    paintSaveBar();
  }

  // 일반 입력란
  $$('[data-path]').forEach((el) => {
    const evt = el.type === 'checkbox' || el.type === 'radio' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      if (!draft) return;
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'radio') { if (!el.checked) return; v = el.value; }
      else if (el.type === 'range') v = Number(el.value);
      else v = el.value;
      setPath(draft, el.dataset.path, v);
      if (el.id === 'logoHeight') $('#logoHeightOut').textContent = v + 'px';
      if (el.type === 'url') checkUrlInput(el);
      changed();
    });
  });

  function urlOk(v) {
    return !v || (/^(https?:\/\/|\/|#|tel:|mailto:)/i.test(v.trim()) && !/[\s<>"']/.test(v.trim()));
  }

  function checkUrlInput(el) {
    const ok = urlOk(el.value);
    el.classList.toggle('is-error', !ok);
    el.title = ok ? '' : 'https:// 로 시작하는 주소를 넣어 주세요';
  }

  /* ---------- 링크 목록 ---------- */

  const ICON = {
    up: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    del: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
  };

  function renderLinks(box) {
    const path = box.dataset.links;
    const max = Number(box.dataset.max) || 4;
    let list = getPath(draft, path);
    if (!Array.isArray(list)) { list = []; setPath(draft, path, list); }
    box.innerHTML = '';

    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'links-empty';
      p.textContent = '아직 링크가 없습니다.';
      box.appendChild(p);
    }

    list.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'link-row';

      const no = document.createElement('span');
      no.className = 'link-no';
      no.textContent = i + 1;

      const label = document.createElement('input');
      label.type = 'text';
      label.className = 'f-label';
      label.maxLength = 20;
      label.placeholder = '이름';
      label.value = item.label || '';
      label.setAttribute('aria-label', (i + 1) + '번 링크 이름');
      label.addEventListener('input', () => { item.label = label.value; changed(); });

      const url = document.createElement('input');
      url.type = 'url';
      url.className = 'f-url';
      url.maxLength = 300;
      url.placeholder = 'https://';
      url.value = item.url || '';
      url.setAttribute('aria-label', (i + 1) + '번 링크 주소');
      url.addEventListener('input', () => { item.url = url.value; checkUrlInput(url); changed(); });

      const tab = document.createElement('label');
      tab.className = 'check';
      const tabIn = document.createElement('input');
      tabIn.type = 'checkbox';
      tabIn.checked = !!item.newTab;
      tabIn.addEventListener('change', () => { item.newTab = tabIn.checked; changed(); });
      tab.append(tabIn, document.createTextNode('새 창'));

      const tools = document.createElement('div');
      tools.className = 'icon-btns';
      [['up', '위로', i === 0], ['down', '아래로', i === list.length - 1], ['del', '삭제', false]].forEach(([k, name, disabled]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-btn' + (k === 'del' ? ' is-danger' : '');
        b.innerHTML = ICON[k];
        b.disabled = disabled;
        b.setAttribute('aria-label', (i + 1) + '번 링크 ' + name);
        b.addEventListener('click', () => {
          if (k === 'del') list.splice(i, 1);
          else {
            const j = k === 'up' ? i - 1 : i + 1;
            [list[i], list[j]] = [list[j], list[i]];
          }
          renderLinks(box);
          changed();
        });
        tools.appendChild(b);
      });

      row.append(no, label, url, tab, tools);
      box.appendChild(row);
    });

    if (list.length < max) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'link-add';
      add.textContent = '+ 링크 추가';
      add.addEventListener('click', () => {
        list.push({ label: '', url: '', newTab: false });
        renderLinks(box);
        const inputs = $$('.f-label', box);
        inputs[inputs.length - 1].focus();
        changed();
      });
      box.appendChild(add);
    }
  }

  /* ---------- 로고 ---------- */

  function renderLogo() {
    const logo = draft.brand.logo;
    const img = $('#logoPreview');
    if (logo) { img.src = logo; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
    $('#logoEmpty').hidden = !!logo;
    $('#btnLogoRemove').hidden = !logo;
    $('#rowLogoHeight').hidden = !logo;
    $('#rowShowOrg').hidden = !logo;
    $('#logoHeightOut').textContent = draft.brand.logoHeight + 'px';
  }

  function logoError(msg) {
    const el = $('#logoError');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
      img.src = src;
    });
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  /** 투명한 가장자리를 잘라 냅니다 (로고 주변 여백 때문에 작아 보이는 것을 막습니다). */
  function trimCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let top = height, left = width, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (right < 0) return canvas;
    const pad = 2;
    left = Math.max(0, left - pad); top = Math.max(0, top - pad);
    right = Math.min(width - 1, right + pad); bottom = Math.min(height - 1, bottom + pad);
    const out = document.createElement('canvas');
    out.width = right - left + 1;
    out.height = bottom - top + 1;
    out.getContext('2d').drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  async function rasterToDataUrl(file) {
    const objUrl = URL.createObjectURL(file);
    try {
      const img = await loadImage(objUrl);
      const full = document.createElement('canvas');
      full.width = img.naturalWidth;
      full.height = img.naturalHeight;
      full.getContext('2d').drawImage(img, 0, 0);
      const trimmed = trimCanvas(full);

      // 화면에서 최대 64px 높이로 쓰므로, 선명하게 보이도록 3배(192px)까지만 남깁니다
      for (const targetH of [192, 144, 112]) {
        const scale = Math.min(1, targetH / trimmed.height, 1200 / trimmed.width);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(trimmed.width * scale));
        c.height = Math.max(1, Math.round(trimmed.height * scale));
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(trimmed, 0, 0, c.width, c.height);
        const png = c.toDataURL('image/png');
        if (png.length <= SITE.MAX_LOGO_CHARS) return png;
        const webp = c.toDataURL('image/webp', 0.9);
        if (webp.startsWith('data:image/webp') && webp.length <= SITE.MAX_LOGO_CHARS) return webp;
      }
      throw new Error('이미지가 너무 복잡해 줄여도 용량이 큽니다. 더 단순한 로고 파일을 써 주세요.');
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  }

  async function svgToDataUrl(file) {
    const text = await file.text();
    if (!/<svg[\s>]/i.test(text)) throw new Error('SVG 파일이 아닙니다.');
    if (/<script|\son\w+\s*=|javascript:/i.test(text)) throw new Error('이 SVG에는 실행 코드가 들어 있어 쓸 수 없습니다. 디자인 프로그램에서 다시 내보내 주세요.');
    const dataUrl = 'data:image/svg+xml;base64,' + utf8ToBase64(text);
    if (dataUrl.length > SITE.MAX_LOGO_CHARS) throw new Error('SVG 파일이 너무 큽니다 (최대 약 120KB). PNG로 올려 주세요.');
    await loadImage(dataUrl); // 열리는지 확인
    return dataUrl;
  }

  $('#logoFile').addEventListener('change', async function () {
    const file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    logoError('');
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) { logoError('PNG, JPG, WEBP, SVG 파일만 올릴 수 있습니다.'); return; }
    if (file.size > 5 * 1024 * 1024) { logoError('5MB 이하 파일을 올려 주세요.'); return; }
    try {
      const dataUrl = file.type === 'image/svg+xml' ? await svgToDataUrl(file) : await rasterToDataUrl(file);
      draft.brand.logo = dataUrl;
      // 로고를 처음 올리면, 로고에 학교 이름이 들어 있는 경우가 많아 글자 표시는 끕니다
      if (!saved.brand.logo) draft.brand.showOrgName = false;
      renderForm();
      changed();
      toast('로고를 올렸습니다. 미리보기를 확인한 뒤 저장해 주세요.');
    } catch (err) {
      logoError(err.message || '이미지를 처리하지 못했습니다.');
    }
  });

  $('#btnLogoRemove').addEventListener('click', () => {
    draft.brand.logo = '';
    draft.brand.showOrgName = true;
    renderForm();
    changed();
  });

  /* ---------- 색상 ---------- */

  function renderColor() {
    const hex = draft.theme.primary.toUpperCase();
    const box = $('#swatches');
    box.innerHTML = '';
    PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.setAttribute('aria-pressed', String(p.hex === hex));
      const dot = document.createElement('i');
      dot.style.background = p.hex;
      b.append(dot, document.createTextNode(p.name));
      b.addEventListener('click', () => setColor(p.hex));
      box.appendChild(b);
    });
    $('#colorPicker').value = hex.toLowerCase();
    if (document.activeElement !== $('#colorHex')) $('#colorHex').value = hex;
    const ratio = SITE.contrastWithWhite(hex);
    const warn = $('#colorWarn');
    warn.hidden = ratio >= 4.5;
    warn.textContent = '이 색은 흰 글자와 대비가 낮아(' + ratio.toFixed(1) + ':1) 버튼 글자가 잘 안 보일 수 있습니다. 더 진한 색을 권장합니다.';
  }

  function setColor(hex) {
    draft.theme.primary = hex.toUpperCase();
    renderColor();
    changed();
  }

  $('#colorPicker').addEventListener('input', function () { setColor(this.value); });
  $('#colorHex').addEventListener('input', function () {
    let v = this.value.trim();
    if (v && v[0] !== '#') v = '#' + v;
    const ok = /^#[0-9a-fA-F]{6}$/.test(v);
    this.classList.toggle('is-error', !ok && v.length >= 7);
    if (ok) setColor(v);
  });
  $('#colorHex').addEventListener('blur', function () { this.value = draft.theme.primary; this.classList.remove('is-error'); });

  /* ================= 미리보기 ================= */

  const iframe = $('#previewIframe');
  let previewReady = false;
  let pushTimer = null;

  function pushPreview() {
    if (!previewReady || !draft || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({ type: 'site-preview', site: SITE.clean(draft) }, location.origin);
  }

  function pushPreviewSoon() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushPreview, 60);
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'site-preview-ready') return;
    previewReady = true;
    pushPreview();
  });

  const DEVICES = { pc: { w: 1280, h: 860 }, mobile: { w: 390, h: 780 } };
  let device = 'pc';

  function fitPreview() {
    const stage = $('#previewStage');
    const frame = $('#previewFrame');
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    if (!W || !H) return;
    const d = DEVICES[device];
    const pad = device === 'mobile' ? 20 : 0;
    const scale = Math.min(1, (W - pad) / d.w);
    // PC는 너비에 맞추고 높이는 칸을 꽉 채웁니다. 휴대폰은 기기 모양 그대로 줄입니다.
    const h = device === 'mobile' ? Math.min(d.h, (H - pad) / scale) : H / scale;
    frame.style.width = d.w + 'px';
    frame.style.height = h + 'px';
    frame.style.transform = 'scale(' + scale + ')';
    frame.style.top = (device === 'mobile' ? pad / 2 : 0) + 'px';
  }

  $$('input[name="device"]').forEach((r) => r.addEventListener('change', function () {
    device = this.value;
    $('#preview').classList.toggle('is-mobile', device === 'mobile');
    fitPreview();
  }));

  if (window.ResizeObserver) new ResizeObserver(fitPreview).observe($('#previewStage'));
  window.addEventListener('resize', fitPreview);

  $('#btnPreviewOpen').addEventListener('click', () => {
    $('#preview').classList.add('is-open');
    fitPreview();
    $('#btnPreviewClose').focus();
  });
  $('#btnPreviewClose').addEventListener('click', () => {
    $('#preview').classList.remove('is-open');
    $('#btnPreviewOpen').focus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#preview').classList.contains('is-open')) $('#btnPreviewClose').click();
  });

  /* ================= 왼쪽 목차 ================= */

  const navLinks = $$('.sidenav a');
  if (window.IntersectionObserver) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === '#' + en.target.id));
      });
    }, { rootMargin: '-80px 0px -65% 0px' });
    $$('.sec').forEach((s) => io.observe(s));
  }

  /* ================= 저장 · 되돌리기 ================= */

  function firstProblem() {
    const bad = $$('#editorBody input.is-error')[0];
    if (bad) return { el: bad, msg: '주소 형식을 확인해 주세요. https:// 로 시작해야 합니다.' };
    const half = $$('.link-row').find((row) => {
      const l = $('.f-label', row).value.trim();
      const u = $('.f-url', row).value.trim();
      return (l && !u) || (!l && u);
    });
    if (half) {
      const l = $('.f-label', half);
      return { el: l.value.trim() ? $('.f-url', half) : l, msg: '링크는 이름과 주소를 모두 채워야 합니다. 빈 줄은 삭제해 주세요.' };
    }
    if (draft.notice.show && !draft.notice.text.trim()) {
      return { el: $('#f-noticeText'), msg: '공지 띠를 켜려면 공지 문구를 입력해 주세요.' };
    }
    return null;
  }

  $('#btnSave').addEventListener('click', async function () {
    const btn = this;
    const p = firstProblem();
    if (p) {
      toast(p.msg, true);
      p.el.focus();
      p.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    busy(btn, true, '저장 중');
    let r;
    try { r = await api('saveSite', { adminToken, site: SITE.clean(draft) }); } catch (e) {
      busy(btn, false, '저장');
      toast('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', true);
      return;
    }
    busy(btn, false, '저장');
    if (!r || !r.ok) {
      if (r && r.code === 'NOT_ADMIN') {
        try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* 넘어갑니다 */ }
        toast(r.message, true);
        // 고친 내용은 그대로 두고, 다시 로그인하면 이어서 저장할 수 있게 합니다
        pendingDraft = clone(draft);
        showLogin(r.message);
        return;
      }
      toast((r && r.message) || '저장하지 못했습니다.', true);
      return;
    }
    saved = SITE.clean(r.site);
    draft = clone(saved);
    try { localStorage.setItem(SITE_CACHE, JSON.stringify(saved)); } catch (e) { /* 넘어갑니다 */ }
    renderForm();
    pushPreview();
    toast('저장했습니다. 신청 화면에 바로 반영됩니다.');
  });

  $('#btnRevert').addEventListener('click', () => {
    if (!confirm('저장하지 않은 변경 사항을 모두 버리고 마지막 저장 상태로 돌아갈까요?')) return;
    draft = clone(saved);
    renderForm();
    pushPreview();
  });

  $('#btnDefaults').addEventListener('click', () => {
    if (!confirm('모든 항목을 처음 설정으로 바꿉니다. 로고도 지워집니다. [저장]을 눌러야 실제로 반영됩니다. 계속할까요?')) return;
    draft = SITE.defaults();
    renderForm();
    changed();
  });

  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  start();
})();
