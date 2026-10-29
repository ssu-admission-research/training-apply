/**
 * 입학사정관 연수 신청 — 화면 동작
 *
 * 서버(Apps Script)와는 api(action, data) 하나로만 이야기합니다.
 * 화면은 내부 수강자번호를 모르며, 서버가 준 참조값(ref)과 확인 증표(claim)만 들고 다닙니다.
 */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};

  /* ================= 상태 ================= */

  const S = {
    token: null,
    year: '',
    contact: CFG.CONTACT || '02-820-0054',
    doneText: '',
    prefillEnabled: true,
    universities: [],
    courses: [],
    jobTypes: [],
    careerBands: [],

    consent: false,
    univ: null,            // { code, name, campus, display, pending }
    name: '',
    phone: '',

    identityKey: '',       // 확인을 마친 성명|번호 — 바뀌면 처음부터 다시 확인합니다
    ref: null,             // 서버 참조값
    claim: null,           // 뒤 네 자리 확인 증표
    recordMode: null,      // 'direct' | 'verified'
    profile: null,         // 마스킹된 이전 기록 요약
    pickedCandidate: null,
    prefilled: false,
    orgChanged: false,

    emailMode: 'new',      // 'keep' = 등록된 이메일 사용
    email: '',
    jobType: null,
    isManager: false,
    career: null,
    course: null,
    submitted: false
  };

  const STEP = {
    consent: [1, '개인정보 동의'],
    applicant: [2, '신청자 확인'], record: [2, '신청자 확인'],
    candidates: [2, '신청자 확인'], verify: [2, '신청자 확인'],
    course: [3, '연수 정보'],
    confirm: [4, '최종 확인'], done: [4, '신청 완료']
  };

  /* ================= 도구 ================= */

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** 받침에 맞는 조사 — '숭실대학교로', '한양대학교(ERICA)는' */
  function josa(word, withBatchim, withoutBatchim) {
    const core = String(word || '').replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim() || String(word || '');
    const last = core.charCodeAt(core.length - 1);
    if (!(last >= 0xAC00 && last <= 0xD7A3)) return withoutBatchim;
    const jong = (last - 0xAC00) % 28;
    if (jong === 0) return withoutBatchim;
    if (jong === 8 && withBatchim === '으로') return withoutBatchim;
    return withBatchim;
  }

  function labelOf(list, code) {
    const hit = list.find((x) => x.code === code);
    return hit ? hit.label : '';
  }

  function canManage(code) {
    const t = S.jobTypes.find((x) => x.code === code);
    return !!(t && t.canManage);
  }

  function formatPhone(v) {
    const d = String(v || '').replace(/[^0-9]/g, '').slice(0, 11);
    if (d.length < 4) return d;
    if (d.length < 8) return d.slice(0, 3) + '-' + d.slice(3);
    if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
  }

  function phoneDigitsOk(d) {
    return (d.length === 11 && /^01[0-9]/.test(d)) || (d.length === 10 && /^01[1-9]/.test(d));
  }

  /* ================= 서버 ================= */

  async function api(action, data) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CFG.TIMEOUT_MS || 30000);
    try {
      const res = await fetch(CFG.API_URL, {
        method: 'POST',
        // text/plain 이어야 사전 요청 없이 Apps Script 로 바로 갑니다
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action, token: S.token }, data || {})),
        redirect: 'follow',
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 어느 화면에서나 같은 방식으로 처리하는 응답입니다.
   * 처리했으면 true 를 돌려주고, 부른 쪽은 더 진행하지 않습니다.
   */
  function handledCommon(r) {
    if (!r) { toast('서버 응답이 없습니다. 잠시 후 다시 시도해 주세요.', true); return true; }
    if (r.code === 'BAD_SESSION') {
      showFatal(r.message, '새로고침', () => location.reload());
      return true;
    }
    if (r.code === 'RATE_LIMIT' || r.code === 'BUSY' || r.code === 'ERROR') {
      toast(r.message, true);
      return true;
    }
    return false;
  }

  function netFail(btn, label) {
    busy(btn, false, label);
    toast('서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.', true);
  }

  /* ================= 화면 전환 · 안내 ================= */

  function show(panel) {
    clearErrors();
    $$('.panel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === panel));
    paintSteps(panel);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function paintSteps(panel) {
    const info = STEP[panel];
    $('.steps').hidden = !info;
    if (!info) return;
    const now = info[0];
    const finished = panel === 'done';
    $$('.steps-list li').forEach((li, i) => {
      li.classList.toggle('is-done', finished || i + 1 < now);
      li.classList.toggle('is-now', !finished && i + 1 === now);
      if (!finished && i + 1 === now) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    $('#stepNow').textContent = now;
    $('#stepLabel').textContent = info[1];
  }

  function showFatal(msg, btnLabel, onClick) {
    $('#fatalMessage').textContent = msg || '잠시 후 다시 시도해 주세요.';
    const b = $('#btnRetry');
    b.textContent = btnLabel || '다시 시도';
    b.onclick = onClick || (() => { show('loading'); boot(); });
    show('fatal');
  }

  function fieldInput(id) {
    return $('#' + id) || $('#input' + id.charAt(0).toUpperCase() + id.slice(1));
  }

  function setError(id, msg) {
    const el = $('#err-' + id);
    if (el) { el.textContent = msg; el.hidden = false; }
    const input = fieldInput(id);
    if (input && input.tagName === 'INPUT') input.classList.add('is-error');
  }

  function clearError(id) {
    const el = $('#err-' + id);
    if (el) { el.textContent = ''; el.hidden = true; }
    const input = fieldInput(id);
    if (input && input.tagName === 'INPUT') input.classList.remove('is-error');
  }

  function clearErrors() {
    $$('.field-error').forEach((e) => { e.textContent = ''; e.hidden = true; });
    $$('input.is-error').forEach((i) => i.classList.remove('is-error'));
    $('#errorSummary').hidden = true;
    $('#errorSummaryList').innerHTML = '';
  }

  /** errors = [{ field, msg, focus }] — 두 개 이상이면 위에 요약을 띄웁니다. */
  function reportErrors(errors) {
    clearErrors();
    if (!errors.length) return true;
    errors.forEach((e) => setError(e.field, e.msg));
    if (errors.length > 1) {
      const list = $('#errorSummaryList');
      errors.forEach((e) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = e.msg;
        b.addEventListener('click', () => focusTarget(e));
        li.appendChild(b);
        list.appendChild(li);
      });
      $('#errorSummary').hidden = false;
      $('#errorSummary').focus();
    } else {
      focusTarget(errors[0]);
    }
    return false;
  }

  function focusTarget(e) {
    const el = e.focus ? $(e.focus) : fieldInput(e.field);
    if (el && el.focus) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function showErrorOn(panel, field, msg, focus) {
    show(panel);
    setTimeout(() => reportErrors([{ field, msg, focus }]), 260);
  }

  let toastTimer = null;
  function toast(msg, isAlert) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('is-alert', !!isAlert);
    el.classList.add('is-up');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-up'), 5000);
  }

  function busy(btn, on, label) {
    if (!btn) return;
    btn.classList.toggle('is-busy', on);
    btn.disabled = !!on;
    if (label !== undefined) btn.textContent = label;
  }

  /* ================= 시작 ================= */

  async function boot() {
    if (!CFG.API_URL || /여기에_배포_ID/.test(CFG.API_URL)) {
      showFatal('config.js 에 API 주소가 설정되지 않았습니다. 관리자에게 문의해 주세요.');
      return;
    }
    let r;
    try {
      r = await api('bootstrap');
    } catch (err) {
      showFatal('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    if (!r || !r.ok) {
      showFatal((r && r.message) || '신청 정보를 불러오지 못했습니다.');
      return;
    }

    S.token = r.token;
    S.year = r.year;
    S.contact = r.contact || S.contact;
    S.doneText = r.doneText || '';
    S.prefillEnabled = r.prefillEnabled !== false;
    S.universities = (r.universities || []).map(prepUniv);
    S.courses = r.courses || [];
    S.jobTypes = r.jobTypes || [];
    S.careerBands = r.careerBands || [];

    document.title = r.year + '년 입학사정관 연수 신청 | 숭실대학교';
    $('#pageTitle').textContent = r.year + '년 연수 신청';
    $('#noticeText').textContent = r.notice || '';
    $('#confirmNote').textContent = '신청 후에는 직접 수정할 수 없습니다. 변경이 필요하면 교육 담당자(' + S.contact + ')에게 문의해 주세요.';
    $$('.js-tel').forEach((a) => { a.textContent = S.contact; a.href = 'tel:' + S.contact.replace(/[^0-9]/g, ''); });

    renderConsentTerms(r.consentTerms || []);

    if (!r.open) {
      $('#closedMessage').textContent = r.closedText;
      show('closed');
      return;
    }
    renderJobTypes();
    renderCareers();
    renderCourses();
    show('consent');
  }

  function renderConsentTerms(rows) {
    const dl = $('#consentTerms');
    dl.innerHTML = '';
    rows.forEach((row) => {
      if (!row.label) {
        const dd = document.createElement('dd');
        dd.style.gridColumn = '1 / -1';
        dd.textContent = row.value;
        dl.appendChild(dd);
        return;
      }
      const dt = document.createElement('dt');
      dt.textContent = row.label;
      const dd = document.createElement('dd');
      dd.textContent = row.value;
      dl.append(dt, dd);
    });
  }

  /* ================= 01 동의 ================= */

  $$('input[name="consent"]').forEach((r) => r.addEventListener('change', () => clearError('consent')));

  $('#btnConsentNext').addEventListener('click', () => {
    const picked = $('input[name="consent"]:checked');
    if (!picked) {
      reportErrors([{ field: 'consent', msg: '개인정보 수집·이용 동의 여부를 선택해 주세요.', focus: 'input[name="consent"]' }]);
      return;
    }
    if (picked.value === 'no') {
      reportErrors([{ field: 'consent', msg: '개인정보 수집·이용에 동의해야 연수를 신청할 수 있습니다.',
                      focus: 'input[name="consent"][value="yes"]' }]);
      return;
    }
    S.consent = true;
    show('applicant');
    setTimeout(() => (S.univ ? $('#inputName') : $('#univSearch')).focus(), 220);
  });

  /* ================= 02 학교 검색 ================= */

  const flat = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

  function prepUniv(u) {
    const display = u.cp ? u.n + ' (' + u.cp + ')' : u.n;
    return {
      code: u.c, name: u.n, campus: u.cp || '', display, pending: false,
      hay: flat(u.n + u.cp + ' ' + (u.a || '')),
      nameFlat: flat(u.n)
    };
  }

  function searchUniv(q) {
    const tokens = String(q || '').trim().split(/\s+/).map(flat).filter(Boolean);
    if (!tokens.length) return [];
    const whole = tokens.join('');
    return S.universities
      .filter((u) => tokens.every((t) => u.hay.includes(t)) || u.hay.includes(whole))
      .map((u) => ({ u, score: u.nameFlat.startsWith(whole) ? 0 : u.nameFlat.includes(tokens[0]) ? 1 : 2 }))
      .sort((a, b) => a.score - b.score || a.u.display.localeCompare(b.u.display, 'ko'))
      .slice(0, 30)
      .map((x) => x.u);
  }

  let activeIdx = -1;

  $('#univSearch').addEventListener('input', function () {
    activeIdx = -1;
    const q = this.value.trim();
    const list = $('#univResults');
    list.innerHTML = '';
    if (!q) {
      $('#univEmpty').hidden = true;
      this.setAttribute('aria-expanded', 'false');
      return;
    }
    const items = searchUniv(q);
    $('#univEmpty').hidden = items.length > 0;
    this.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    items.forEach((u) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span>' + esc(u.name) + '</span>' + (u.campus ? '<span class="campus">' + esc(u.campus) + '</span>' : '');
      b.addEventListener('click', () => pickUniv(u));
      li.appendChild(b);
      list.appendChild(li);
    });
  });

  $('#univSearch').addEventListener('keydown', function (e) {
    const items = $$('#univResults li');
    if (e.key === 'Escape') {
      $('#univResults').innerHTML = '';
      this.setAttribute('aria-expanded', 'false');
      return;
    }
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle('is-active', i === activeIdx));
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[Math.max(0, activeIdx)].querySelector('button').click();
    }
  });

  function pickUniv(u) {
    S.univ = { code: u.code, name: u.name, campus: u.campus, display: u.display, pending: !!u.pending };
    $('#univPickedName').textContent = u.display;
    $('#univPickedFlag').hidden = !u.pending;
    $('#univPicked').hidden = false;
    $('#univSearchBox').hidden = true;
    $('#univHelp').hidden = true;
    $('#univResults').innerHTML = '';
    $('#univEmpty').hidden = true;
    $('#univAddForm').hidden = true;
    $('#univSearch').value = '';
    $('#univSearch').setAttribute('aria-expanded', 'false');
    clearError('univ');
    checkManagerSlot();
    setTimeout(() => { if (!$('#inputName').value) $('#inputName').focus(); }, 60);
  }

  $('#btnUnivClear').addEventListener('click', () => {
    S.univ = null;
    $('#univPicked').hidden = true;
    $('#univSearchBox').hidden = false;
    $('#univHelp').hidden = false;
    $('#univSearch').focus();
  });

  /* --- 목록에 없는 학교 --- */

  $('#btnUnivAddOpen').addEventListener('click', () => {
    $('#univAddForm').hidden = false;
    $('#univEmpty').hidden = true;
    $('#addUnivName').value = $('#univSearch').value.trim();
    setTimeout(() => $('#addUnivName').focus(), 80);
  });

  $('#btnUnivAddCancel').addEventListener('click', () => {
    $('#univAddForm').hidden = true;
    $('#addUnivName').value = '';
    $('#addUnivCampus').value = '';
    clearError('addUnivName');
    $('#univSearch').focus();
  });

  $('#addUnivName').addEventListener('input', () => clearError('addUnivName'));

  $('#btnUnivAddSave').addEventListener('click', async function () {
    const btn = this;
    const name = $('#addUnivName').value.trim();
    const campus = $('#addUnivCampus').value.trim();
    if (name.length < 2) {
      reportErrors([{ field: 'addUnivName', msg: '학교명을 정확히 입력해 주세요.' }]);
      return;
    }
    busy(btn, true);
    let r;
    try { r = await api('requestUniversity', { name, campus }); } catch (e) { netFail(btn); return; }
    busy(btn, false);
    if (r.code === 'ALREADY_EXISTS' && r.univ) {
      $('#addUnivName').value = '';
      $('#addUnivCampus').value = '';
      pickUniv(r.univ);
      toast(r.message);
      return;
    }
    if (handledCommon(r)) return;
    if (!r.ok) {
      reportErrors([{ field: 'addUnivName', msg: r.message || '학교를 등록하지 못했습니다.' }]);
      return;
    }
    $('#addUnivName').value = '';
    $('#addUnivCampus').value = '';
    pickUniv(r.univ);
  });

  /* --- 담당자 정원 안내 --- */

  async function checkManagerSlot() {
    const box = $('#managerNotice');
    box.hidden = true;
    if (!S.univ) return;
    if (S.univ.pending) {
      box.textContent = '직접 입력한 학교는 관리자 확인 뒤 담당자 지정이 처리됩니다.';
      box.hidden = false;
      return;
    }
    const code = S.univ.code;
    try {
      const r = await api('managerInfo', { univCode: code });
      if (!r || !r.ok || !S.univ || S.univ.code !== code) return;
      if (r.isFull) {
        box.innerHTML = '이 학교는 교육 담당자가 이미 등록되어 있습니다. 담당자가 바뀌었다면 <strong>예</strong>를 선택해 주세요. 관리자 확인 후 처리됩니다.';
        box.hidden = false;
      }
    } catch (e) { /* 안내일 뿐이라 조용히 넘어갑니다 */ }
  }

  /* ================= 02 성명 · 휴대전화번호 ================= */

  function bindPhone(input, errKey) {
    input.addEventListener('input', () => {
      const pos = input.selectionStart;
      const before = input.value.length;
      input.value = formatPhone(input.value);
      if (pos !== null && document.activeElement === input) {
        const np = Math.max(0, pos + (input.value.length - before));
        input.setSelectionRange(np, np);
      }
      clearError(errKey);
    });
  }
  bindPhone($('#inputPhone'), 'phone');
  bindPhone($('#inputPhone2'), 'phone2');

  $('#inputName').addEventListener('input', function () {
    // 조합 중인 한글이 끊기지 않도록 완성형·자모·공백만 남깁니다
    const v = this.value.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣ\s]/g, '');
    if (v !== this.value) this.value = v;
    clearError('name');
  });

  function resetIdentity() {
    S.identityKey = '';
    S.ref = null;
    S.claim = null;
    S.recordMode = null;
    S.profile = null;
    S.pickedCandidate = null;
    S.prefilled = false;
    S.orgChanged = false;
    S.emailMode = 'new';
    setupEmailBlock();
  }

  $('#btnApplicantNext').addEventListener('click', async function () {
    const btn = this;
    const errs = [];
    if (!S.univ) errs.push({ field: 'univ', msg: '소속학교를 검색해 선택해 주세요.', focus: '#univSearch' });

    const name = $('#inputName').value.replace(/\s+/g, '');
    if (!name) errs.push({ field: 'name', msg: '성명을 입력해 주세요.', focus: '#inputName' });
    else if (!/^[가-힣]{2,10}$/.test(name)) errs.push({ field: 'name', msg: '성명은 한글 2~10자로 입력해 주세요.', focus: '#inputName' });

    const p1 = $('#inputPhone').value;
    const d1 = p1.replace(/[^0-9]/g, '');
    if (!d1) errs.push({ field: 'phone', msg: '휴대전화번호를 입력해 주세요.', focus: '#inputPhone' });
    else if (!phoneDigitsOk(d1)) errs.push({ field: 'phone', msg: '휴대전화번호를 정확하게 입력해 주세요.', focus: '#inputPhone' });
    else if (d1 !== $('#inputPhone2').value.replace(/[^0-9]/g, '')) {
      errs.push({ field: 'phone2', msg: '위에 입력한 휴대전화번호와 일치하지 않습니다.', focus: '#inputPhone2' });
    }
    if (!reportErrors(errs)) return;

    const key = name + '|' + d1;

    // 이미 확인을 마쳤고 성명·번호가 그대로면 다시 묻지 않습니다 (학교만 바꾼 경우)
    if (S.identityKey === key) {
      recomputeOrgChange();
      goCourse();
      return;
    }

    resetIdentity();
    S.name = name;
    S.phone = formatPhone(d1);

    busy(btn, true, '확인 중');
    let r;
    try { r = await api('lookup', { name, phone: S.phone }); } catch (e) { netFail(btn, '이력 확인'); return; }
    busy(btn, false, '이력 확인');
    if (handledCommon(r)) return;

    if (!r.ok) {
      const field = r.code === 'BAD_NAME' ? 'name' : 'phone';
      reportErrors([{ field, msg: r.message || '조회하지 못했습니다.', focus: field === 'name' ? '#inputName' : '#inputPhone' }]);
      return;
    }

    if (r.found) {
      S.identityKey = key;
      S.ref = r.ref;
      S.profile = r.profile;
      S.recordMode = 'direct';
      renderRecord();
      show('record');
      return;
    }
    await findCandidates(btn, key);
  });

  /* ================= 02-1 이력 확인 결과 ================= */

  function canUsePrevious() {
    return S.prefillEnabled && !!(S.profile && S.profile.hasPrevious);
  }

  function lastUniv() {
    return S.profile && S.profile.lastUniv ? S.profile.lastUniv : null;
  }

  function recomputeOrgChange() {
    const last = lastUniv();
    const was = S.orgChanged;
    S.orgChanged = !!(last && S.univ && String(last.code) !== String(S.univ.code));
    // 학교가 바뀌었으면 담당자 여부는 새로 정해야 합니다
    if (S.orgChanged && !was) setManager(false);
  }

  function renderRecord() {
    const p = S.profile || {};
    const direct = S.recordMode === 'direct';
    recomputeOrgChange();

    $('#h-record').textContent = direct ? '이전 수강 이력이 확인되었습니다' : '본인 확인이 완료되었습니다';
    $('#recordDesc').textContent = direct ? '아래 정보가 본인의 것이 맞는지 확인해 주세요.' : '이전 수강 이력과 연결해 신청합니다.';
    $('#recordLegend').textContent = direct ? '본인 정보가 맞습니까?' : '어떻게 진행할까요?';

    const rows = [];
    if (direct && p.maskedName) rows.push(['성명', p.maskedName]);
    const last = lastUniv();
    if (last) rows.push(['지난 소속', last.display + (last.year ? ' (' + last.year + '년)' : '')]);
    if (direct && p.maskedPhone) rows.push(['휴대전화번호', p.maskedPhone]);
    rows.push(['이메일', p.hasEmail ? p.maskedEmail : '등록된 이메일 없음']);

    let html = '<div class="record-body"><dl>' +
      rows.map((x) => '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>').join('') + '</dl></div>';
    if (p.history && p.history.length) {
      html += '<div class="record-trail"><p class="record-trail-title">수강 이력</p><ul>' +
        p.history.map((h) => '<li>' + esc(h) + '</li>').join('') + '</ul></div>';
    }
    $('#recordBox').innerHTML = html;

    const note = $('#recordOrgNote');
    if (S.orgChanged) {
      const now = S.univ.display, prev = last.display;
      note.innerHTML = '<strong>이번 신청은 ' + esc(now) + ' 소속으로 접수됩니다.</strong><br>' +
        '위의 ' + esc(prev) + josa(prev, '은', '는') + ' 지난 기록입니다. 신청이 끝나면 소속이 ' +
        esc(now) + josa(now, '으로', '로') + ' 바뀌고, 수강 이력은 그대로 이어집니다.';
      note.hidden = false;
    } else {
      note.hidden = true;
    }

    const canSame = canUsePrevious();
    $('#choiceSame').hidden = !canSame;
    $('#choiceNotMe').hidden = !direct;
    const oneCourse = S.courses.length === 1;
    if (S.orgChanged) {
      $('#labelSame').textContent = '네, ' + S.univ.display + ' 소속으로 신청합니다';
      $('#descSame').textContent = '직무·경력·이메일은 지난 내용 그대로 씁니다' + (oneCourse ? '' : ' (과정만 고르면 됩니다)');
    } else {
      $('#labelSame').textContent = '네, 지난 신청 내용 그대로 신청합니다';
      $('#descSame').textContent = oneCourse ? '지난 내용을 불러와 바로 최종 확인으로 넘어갑니다' : '지난 내용을 불러오고, 과정만 고르면 됩니다';
    }
    $('#labelChanged').textContent = canSame ? '네, 바뀐 정보가 있습니다' : '네, 본인입니다';
    $('#descChanged').textContent = canSame ? '지난 내용을 불러온 뒤 직접 고칩니다' : '이전 수강 이력과 연결해 신청합니다';

    $$('input[name="record"]').forEach((x) => { x.checked = false; });
  }

  $$('input[name="record"]').forEach((r) => r.addEventListener('change', () => clearError('record')));

  $('#btnRecordNext').addEventListener('click', async function () {
    const picked = $('input[name="record"]:checked');
    if (!picked) {
      reportErrors([{ field: 'record', msg: '진행 방법을 선택해 주세요.', focus: 'input[name="record"]' }]);
      return;
    }
    if (picked.value === 'no') {
      resetIdentity();
      showErrorOn('applicant', 'phone', '성명과 휴대전화번호를 다시 확인해 주세요. 계속 문제가 있으면 교육 담당자에게 문의해 주세요.', '#inputPhone');
      return;
    }
    S.emailMode = S.profile && S.profile.hasEmail ? 'keep' : 'new';
    setupEmailBlock();
    if (canUsePrevious()) await loadPrevious(this, picked.value === 'same');
    else goCourse();
  });

  /* ================= 지난 신청 내용 불러오기 ================= */

  async function loadPrevious(btn, toConfirm) {
    const label = btn.textContent;
    busy(btn, true, '불러오는 중');
    let r;
    try { r = await api('loadPrevious', { ref: S.ref, claim: S.claim }); } catch (e) { busy(btn, false, label); goCourse(); return; }
    busy(btn, false, label);

    if (r && r.code === 'NOT_VERIFIED') {
      resetIdentity();
      toast(r.message, true);
      show('applicant');
      return;
    }
    if (handledCommon(r)) return;
    if (!r.ok || !r.found || !r.profile) { goCourse(); return; }

    applyPrefill(r.profile);

    if (toConfirm && prefillComplete()) {
      renderSummary();
      show('confirm');
      toast('지난 신청 내용을 불러왔습니다. 확인 후 신청해 주세요.');
      return;
    }

    goCourse();
    const missing = [];
    if (!S.jobType) missing.push('직무 유형');
    if (!S.career) missing.push('경력');
    if (!S.course) missing.push('신청 과정');
    toast(missing.length
      ? '지난 내용을 불러왔습니다. ' + missing.join(', ') + josa(missing[missing.length - 1], '을', '를') + ' 선택해 주세요.'
      : '지난 내용을 불러왔습니다. 바뀐 부분을 고쳐 주세요.');
  }

  /**
   * 불러온 값을 채웁니다. 학교는 방금 고른 학교를 그대로 둡니다(올해 소속).
   * 학교가 바뀌었으면 담당자 여부는 '아니오'로 둡니다.
   */
  function applyPrefill(p) {
    S.prefilled = true;
    if (p.jobType && S.jobTypes.some((t) => t.code === p.jobType)) setJob(p.jobType);
    if (p.career && S.careerBands.some((b) => b.code === p.career)) setCareer(p.career);
    recomputeOrgChange();
    setManager(!S.orgChanged && !!p.isManager && canManage(S.jobType));
    if (S.isManager) {
      // 이미 이 학교 담당자인 사람에게 '담당자가 이미 있습니다' 안내는 맞지 않습니다
      $('#managerNotice').textContent = '현재 이 학교의 교육 담당자로 등록되어 있습니다. 계속 맡으시면 그대로 두세요.';
      $('#managerNotice').hidden = false;
    }
    if (S.courses.length === 1) setCourse(S.courses[0].code);
  }

  function prefillComplete() {
    const emailOk = S.emailMode === 'keep' || !!S.email;
    return !!(S.univ && emailOk && S.jobType && S.career && S.course);
  }

  /* ================= 02-2 후보 ================= */

  async function findCandidates(btn, key) {
    if (S.univ.pending) { startAsNew(key); return; }
    busy(btn, true, '확인 중');
    let r;
    try { r = await api('candidates', { name: S.name, univCode: S.univ.code }); } catch (e) { netFail(btn, '이력 확인'); return; }
    busy(btn, false, '이력 확인');
    if (handledCommon(r)) return;
    if (!r.ok || !r.candidates || !r.candidates.length) { startAsNew(key); return; }
    renderCandidates(r.candidates, key);
    show('candidates');
  }

  /** 이전 이력 없이 새로 신청합니다. */
  function startAsNew(key) {
    resetIdentity();
    S.identityKey = key || (S.name + '|' + S.phone.replace(/[^0-9]/g, ''));
    goCourse();
  }

  let candidateKey = '';

  function renderCandidates(list, key) {
    candidateKey = key;
    const box = $('#candidateList');
    box.innerHTML = '';
    S.pickedCandidate = null;

    list.forEach((c, i) => {
      const label = document.createElement('label');
      label.className = 'choice';
      const trail = c.history && c.history.length
        ? '<ul class="choice-history">' + c.history.map((h) => '<li>' + esc(h) + '</li>').join('') + '</ul>'
        : '<span class="choice-desc">' + (c.lastYear ? c.lastYear + '년 소속 기록' : '기존 명단에 있는 기록') + '</span>';
      label.innerHTML = '<input type="radio" name="candidate" value="' + i + '">' +
        '<span class="choice-body"><strong>' + esc(S.univ.display) + ' · ' + esc(S.name) + '</strong>' +
        '<span class="choice-meta">' + (c.maskedEmail ? '이메일 ' + esc(c.maskedEmail) : '등록된 이메일 없음') + '</span>' +
        trail + '</span>';
      label.querySelector('input').addEventListener('change', () => { S.pickedCandidate = c; clearError('candidate'); });
      box.appendChild(label);
    });

    const none = document.createElement('label');
    none.className = 'choice';
    none.innerHTML = '<input type="radio" name="candidate" value="none">' +
      '<span class="choice-body"><strong>해당 이력이 없습니다</strong>' +
      '<span class="choice-desc">처음 신청하거나 다른 분의 기록이면 선택해 주세요</span></span>';
    none.querySelector('input').addEventListener('change', () => { S.pickedCandidate = null; clearError('candidate'); });
    box.appendChild(none);
  }

  $('#btnCandidateNext').addEventListener('click', () => {
    const picked = $('input[name="candidate"]:checked');
    if (!picked) {
      reportErrors([{ field: 'candidate', msg: '본인의 이전 이력을 선택하거나, 해당 이력이 없음을 선택해 주세요.', focus: 'input[name="candidate"]' }]);
      return;
    }
    if (picked.value === 'none') { startAsNew(candidateKey); return; }
    $('#inputLast4').value = '';
    $('#btnVerify').disabled = false;
    show('verify');
    setTimeout(() => $('#inputLast4').focus(), 220);
  });

  /* ================= 02-3 뒤 네 자리 ================= */

  $('#inputLast4').addEventListener('input', function () {
    this.value = this.value.replace(/[^0-9]/g, '').slice(0, 4);
    clearError('last4');
  });
  $('#inputLast4').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#btnVerify').click(); }
  });

  $('#btnVerify').addEventListener('click', async function () {
    const btn = this;
    const v = $('#inputLast4').value;
    if (v.length !== 4) {
      reportErrors([{ field: 'last4', msg: '숫자 네 자리를 입력해 주세요.', focus: '#inputLast4' }]);
      return;
    }
    if (!S.pickedCandidate) { show('candidates'); return; }

    busy(btn, true, '확인 중');
    let r;
    try { r = await api('verify', { ref: S.pickedCandidate.ref, last4: v }); } catch (e) { netFail(btn, '확인'); return; }
    busy(btn, false, '확인');
    if (handledCommon(r)) return;

    if (r.ok) {
      S.identityKey = candidateKey;
      S.ref = S.pickedCandidate.ref;
      S.claim = r.claim;
      S.profile = r.profile;
      S.recordMode = 'verified';
      renderRecord();
      show('record');
      return;
    }

    $('#inputLast4').value = '';
    if (r.code === 'BAD_REF') {
      resetIdentity();
      toast(r.message, true);
      show('applicant');
      return;
    }
    reportErrors([{ field: 'last4', msg: r.message || '확인하지 못했습니다.', focus: r.code === 'TOO_MANY' ? '#btnVerifySkip' : '#inputLast4' }]);
    if (r.code === 'TOO_MANY') btn.disabled = true;
  });

  $('#btnVerifySkip').addEventListener('click', () => startAsNew(candidateKey));

  /* ================= 03 연수 정보 ================= */

  function goCourse() {
    setupEmailBlock();
    show('course');
    setTimeout(() => {
      const first = S.emailMode === 'keep' ? $('input[name="jobType"]:checked') || $('input[name="jobType"]') : $('#inputEmail');
      if (first) first.focus({ preventScroll: true });
    }, 220);
  }

  $('#btnCourseBack').addEventListener('click', () => show(S.recordMode ? 'record' : 'applicant'));

  function setupEmailBlock() {
    const hasEmail = !!(S.ref && S.profile && S.profile.hasEmail);
    $('#emailChoiceBlock').hidden = !hasEmail;
    if (!hasEmail) S.emailMode = 'new';
    if (hasEmail) {
      $('#keepEmailDesc').textContent = S.profile.maskedEmail;
      $$('input[name="emailMode"]').forEach((x) => { x.checked = x.value === S.emailMode; });
    }
    $('#emailInputBlock').hidden = S.emailMode === 'keep';
  }

  $$('input[name="emailMode"]').forEach((r) => r.addEventListener('change', function () {
    S.emailMode = this.value;
    clearError('emailMode');
    $('#emailInputBlock').hidden = S.emailMode === 'keep';
    if (S.emailMode === 'new') setTimeout(() => $('#inputEmail').focus(), 60);
  }));

  function choiceList(boxSel, name, items, descOf, onPick) {
    const box = $(boxSel);
    box.innerHTML = '';
    items.forEach((it) => {
      const label = document.createElement('label');
      label.className = 'choice';
      const desc = descOf ? descOf(it) : '';
      label.innerHTML = '<input type="radio" name="' + name + '" value="' + esc(it.code) + '">' +
        '<span class="choice-body"><strong>' + esc(it.label) + '</strong>' +
        (desc ? '<span class="choice-desc">' + esc(desc) + '</span>' : '') + '</span>';
      label.querySelector('input').addEventListener('change', () => onPick(it.code));
      box.appendChild(label);
    });
  }

  function checkRadio(name, value) {
    const el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }

  function setJob(code) {
    S.jobType = code;
    checkRadio('jobType', code);
    clearError('job');
    const can = canManage(code);
    $('#managerBlock').hidden = !can;
    if (!can) setManager(false);
  }

  function setManager(on) {
    S.isManager = !!on;
    checkRadio('manager', on ? 'yes' : 'no');
  }

  function setCareer(code) { S.career = code; checkRadio('career', code); clearError('career'); }
  function setCourse(code) { S.course = code; checkRadio('course', code); clearError('course'); }

  function renderJobTypes() { choiceList('#jobChoices', 'jobType', S.jobTypes, null, setJob); }
  function renderCareers() { choiceList('#careerChoices', 'career', S.careerBands, null, setCareer); }
  function renderCourses() { choiceList('#courseChoices', 'course', S.courses, (c) => c.desc, setCourse); }

  $$('input[name="manager"]').forEach((r) => r.addEventListener('change', function () { S.isManager = this.value === 'yes'; }));
  $('#inputEmail').addEventListener('input', () => clearError('email'));
  $('#inputEmail2').addEventListener('input', () => clearError('email2'));

  $('#btnCourseNext').addEventListener('click', async function () {
    const btn = this;
    const errs = [];
    const keep = !$('#emailChoiceBlock').hidden && S.emailMode === 'keep';

    let em = '';
    if (!$('#emailChoiceBlock').hidden && !$('input[name="emailMode"]:checked')) {
      errs.push({ field: 'emailMode', msg: '이메일 사용 방법을 선택해 주세요.', focus: 'input[name="emailMode"]' });
    } else if (!keep) {
      em = $('#inputEmail').value.trim().toLowerCase();
      if (!em) errs.push({ field: 'email', msg: '이메일을 입력해 주세요.', focus: '#inputEmail' });
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) errs.push({ field: 'email', msg: '이메일 형식을 확인해 주세요. 예: name@university.ac.kr', focus: '#inputEmail' });
      else if (em !== $('#inputEmail2').value.trim().toLowerCase()) errs.push({ field: 'email2', msg: '위에 입력한 이메일과 일치하지 않습니다.', focus: '#inputEmail2' });
    }
    if (!S.jobType) errs.push({ field: 'job', msg: '직무 유형을 선택해 주세요.', focus: 'input[name="jobType"]' });
    if (!S.career) errs.push({ field: 'career', msg: '입학사정관 경력을 선택해 주세요.', focus: 'input[name="career"]' });
    if (!S.course) errs.push({ field: 'course', msg: '신청할 연수 과정을 선택해 주세요.', focus: 'input[name="course"]' });
    if (!reportErrors(errs)) return;

    S.email = keep ? '' : em;
    if (keep) { renderSummary(); show('confirm'); return; }

    busy(btn, true, '확인 중');
    let r;
    try { r = await api('checkEmail', { email: em, ref: S.ref, claim: S.claim }); } catch (e) { netFail(btn, '입력 내용 확인'); return; }
    busy(btn, false, '입력 내용 확인');
    if (handledCommon(r)) return;
    if (!r.ok) {
      reportErrors([{ field: 'email', msg: r.message || '이메일을 사용할 수 없습니다.', focus: '#inputEmail' }]);
      return;
    }
    renderSummary();
    show('confirm');
  });

  /* ================= 04 최종 확인 ================= */

  function renderSummary() {
    recomputeOrgChange();
    const keep = S.emailMode === 'keep';
    const rows = [
      { label: '소속학교', value: S.univ.display + (S.univ.pending ? ' (확인 전)' : ''), back: 'applicant', focus: '#btnUnivClear' },
      { label: '성명', value: S.name, key: true, back: 'applicant', focus: '#inputName' },
      { label: '휴대전화번호', value: S.phone, back: 'applicant', focus: '#inputPhone' },
      { label: '이메일', value: keep ? S.profile.maskedEmail + ' (등록된 이메일)' : S.email, key: !keep, back: 'course',
        focus: keep ? 'input[name="emailMode"]' : '#inputEmail' },
      { label: '직무 유형', value: labelOf(S.jobTypes, S.jobType), back: 'course', focus: 'input[name="jobType"]' },
      { label: '입학사정관 경력', value: labelOf(S.careerBands, S.career), back: 'course', focus: 'input[name="career"]' },
      { label: '신청 과정', value: labelOf(S.courses, S.course), back: 'course', focus: 'input[name="course"]' }
    ];
    if (canManage(S.jobType)) {
      rows.push({ label: '교육 담당자', value: S.isManager ? '예' : '아니오', back: 'course', focus: 'input[name="manager"]' });
    }
    if (S.ref) rows.push({ label: '이전 수강 이력', value: '연결됨' });
    if (S.orgChanged) rows.push({ label: '소속 변경', value: lastUniv().display + ' → ' + S.univ.display });

    const dl = $('#summaryList');
    dl.innerHTML = '';
    rows.forEach((r) => {
      const div = document.createElement('div');
      div.className = 'summary-row';
      const dt = document.createElement('dt');
      dt.textContent = r.label;
      const dd = document.createElement('dd');
      dd.textContent = r.value;
      if (r.key) dd.className = 'is-key';
      div.append(dt, dd);
      if (r.back) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'summary-edit';
        b.textContent = '수정';
        b.setAttribute('aria-label', r.label + ' 수정');
        b.addEventListener('click', () => {
          if (r.back === 'course') goCourse(); else show(r.back);
          setTimeout(() => focusTarget({ focus: r.focus }), 280);
        });
        div.appendChild(b);
      } else {
        div.appendChild(document.createElement('span'));
      }
      dl.appendChild(div);
    });
  }

  $('#btnSubmit').addEventListener('click', async function () {
    const btn = this;
    if (S.submitted) return;
    busy(btn, true, '접수 중입니다');
    let r;
    try {
      r = await api('submit', {
        consent: S.consent,
        univCode: S.univ.code,
        name: S.name,
        phone: S.phone,
        email: S.email,
        keepEmail: S.emailMode === 'keep',
        jobType: S.jobType,
        isManager: S.isManager,
        career: S.career,
        course: S.course,
        ref: S.ref,
        claim: S.claim
      });
    } catch (e) {
      busy(btn, false, '이대로 신청하기');
      toast('접수 결과를 받지 못했습니다. 중복 접수를 막기 위해, 다시 누르기 전에 잠시 기다려 주세요. 같은 과정은 한 번만 접수됩니다.', true);
      return;
    }
    busy(btn, false, '이대로 신청하기');
    if (handledCommon(r)) return;
    if (!r.ok) { handleSubmitError(r); return; }

    S.submitted = true;
    btn.disabled = true;
    renderComplete(r);
    show('done');
  });

  function handleSubmitError(r) {
    const map = {
      NO_CONSENT:    ['consent', 'consent', 'input[name="consent"]'],
      PHONE_OWNER:   ['applicant', 'phone', '#inputPhone'],
      DUP_PHONE:     ['applicant', 'phone', '#inputPhone'],
      NAME_MISMATCH: ['applicant', 'name', '#inputName'],
      BAD_NAME:      ['applicant', 'name', '#inputName'],
      BAD_PHONE:     ['applicant', 'phone', '#inputPhone'],
      BAD_UNIV:      ['applicant', 'univ', '#btnUnivClear'],
      DUP_EMAIL:     ['course', 'email', '#inputEmail'],
      BAD_EMAIL:     ['course', 'email', '#inputEmail'],
      EMAIL_REQUIRED:['course', 'email', '#inputEmail'],
      BAD_JOB:       ['course', 'job', 'input[name="jobType"]'],
      BAD_CAREER:    ['course', 'career', 'input[name="career"]'],
      DUP_APPLY:     ['course', 'course', 'input[name="course"]'],
      CLOSED:        ['course', 'course', 'input[name="course"]']
    };

    if (r.code === 'CLAIM_REQUIRED') {
      resetIdentity();
      toast(r.message, true);
      show('applicant');
      return;
    }
    if (['PHONE_OWNER', 'DUP_PHONE', 'NAME_MISMATCH'].includes(r.code)) resetIdentity();
    if (r.code === 'DUP_EMAIL' || r.code === 'EMAIL_REQUIRED') {
      S.emailMode = 'new';
    }

    const t = map[r.code];
    if (!t) { toast(r.message || '신청을 접수하지 못했습니다.', true); return; }
    if (t[0] === 'course') {
      goCourse();
      setTimeout(() => reportErrors([{ field: t[1], msg: r.message, focus: t[2] }]), 260);
    } else {
      showErrorOn(t[0], t[1], r.message, t[2]);
    }
  }

  function renderComplete(r) {
    const dl = $('#completeList');
    dl.innerHTML = '';
    [
      ['신청번호', r.applicationNo, 'is-no'],
      ['신청 과정', r.course],
      ['소속학교', r.university + (r.universityPending ? ' (확인 전)' : '')],
      ['신청자', r.name],
      ['이메일', r.emailDisplay]
    ].forEach((x) => {
      const dt = document.createElement('dt');
      dt.textContent = x[0];
      const dd = document.createElement('dd');
      dd.textContent = x[1];
      if (x[2]) dd.className = x[2];
      dl.append(dt, dd);
    });

    const box = $('#managerResult');
    const m = r.manager || {};
    box.hidden = !m.message || m.status === 'none';
    box.textContent = m.status === 'assigned'
      ? m.message + ' 연수 관련 공지를 등록된 이메일로 보내드립니다.'
      : (m.message || '');

    let lead;
    if (r.isNew) lead = '신청번호를 보관해 주세요.';
    else if (r.orgChanged && r.prevUniversity) {
      lead = '소속이 ' + r.prevUniversity + '에서 ' + r.university + josa(r.university, '으로', '로') +
        ' 바뀌었고, 이전 수강 이력과 연결되었습니다.';
    } else lead = '이전 수강 이력과 연결되었습니다.';
    $('#doneNote').textContent = [lead, S.doneText, '문의: ' + S.contact].filter(Boolean).join(' ');
  }

  /* ================= 뒤로 ================= */

  $$('[data-back]').forEach((b) => b.addEventListener('click', function () {
    if (this.dataset.back === 'course') goCourse(); else show(this.dataset.back);
  }));

  boot();
})();
