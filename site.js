/**
 * 사이트 꾸미기 — 신청 화면(index.html)과 관리자 화면(admin.html)이 같이 씁니다.
 *
 *  SITE.defaults()        기본 설정
 *  SITE.clean(obj)        모르는 항목은 버리고 형식을 맞춘 설정 (서버 site-settings.gs 와 같은 규칙)
 *  SITE.apply(site, ctx)  신청 화면의 헤더·공지·제목·색상·하단을 설정대로 그립니다
 */
(function () {
  'use strict';

  function defaults() {
    return {
      brand: {
        logo: '',
        logoAlt: '숭실대학교',
        logoHeight: 40,
        showOrgName: true,
        orgName: '숭실대학교',
        serviceName: '입학사정관 연수'
      },
      utility: {
        show: true,
        links: [{ label: '숭실대학교 홈페이지', url: 'https://ssu.ac.kr', newTab: true }],
        hours: '평일 09:00 – 18:00'
      },
      nav: { links: [] },
      contact: { label: '교육 문의', phone: '' },
      notice: { show: false, tone: 'info', text: '', linkLabel: '', url: '' },
      hero: {
        style: 'plain',
        eyebrow: '입학사정관 역량강화 연수',
        title: '{year}년 연수 신청',
        desc: '신청자 정보와 수강할 연수 과정을 입력해 주세요.'
      },
      theme: { primary: '#006694' },
      footer: { org: '숭실대학교 입학처', address: '', copyright: '' }
    };
  }

  /* ---------- 검사 ---------- */

  const LOGO_RE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
  const MAX_LOGO_CHARS = 160000;

  function text(v, max, fallback) {
    if (typeof v !== 'string') return fallback;
    return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  }

  function url(v) {
    const s = text(v, 300, '');
    if (!s) return '';
    return /^(https?:\/\/|\/|#|tel:|mailto:)/i.test(s) && !/[\s<>"']/.test(s) ? s : '';
  }

  function links(arr, max) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, max).map((l) => ({
      label: text(l && l.label, 20, ''),
      url: url(l && l.url),
      newTab: !!(l && l.newTab)
    })).filter((l) => l.label && l.url);
  }

  function logoOk(s) {
    return typeof s === 'string' && s.length <= MAX_LOGO_CHARS && LOGO_RE.test(s);
  }

  function clean(src) {
    const d = defaults();
    const s = src && typeof src === 'object' ? src : {};
    const g = (k) => (s[k] && typeof s[k] === 'object' ? s[k] : {});
    const b = g('brand'), u = g('utility'), n = g('nav'), c = g('contact'),
          no = g('notice'), h = g('hero'), t = g('theme'), f = g('footer');
    const height = Number(b.logoHeight);
    const logo = logoOk(b.logo) ? b.logo : '';

    return {
      brand: {
        logo,
        logoAlt: text(b.logoAlt, 40, d.brand.logoAlt) || d.brand.logoAlt,
        logoHeight: height >= 24 && height <= 64 ? Math.round(height) : d.brand.logoHeight,
        showOrgName: logo ? b.showOrgName !== false : true,
        orgName: text(b.orgName, 30, d.brand.orgName) || d.brand.orgName,
        serviceName: text(b.serviceName, 30, d.brand.serviceName)
      },
      utility: {
        show: u.show !== undefined ? !!u.show : d.utility.show,
        links: Array.isArray(u.links) ? links(u.links, 4) : d.utility.links,
        hours: text(u.hours, 40, d.utility.hours)
      },
      nav: { links: links(n.links, 6) },
      contact: {
        label: text(c.label, 12, d.contact.label),
        phone: /^[0-9+\-() ]{0,20}$/.test(String(c.phone || '')) ? String(c.phone || '').trim() : ''
      },
      notice: {
        show: !!no.show,
        tone: ['info', 'warn', 'strong'].indexOf(no.tone) >= 0 ? no.tone : 'info',
        text: text(no.text, 120, ''),
        linkLabel: text(no.linkLabel, 16, ''),
        url: url(no.url)
      },
      hero: {
        style: h.style === 'band' ? 'band' : 'plain',
        eyebrow: text(h.eyebrow, 40, d.hero.eyebrow),
        title: text(h.title, 120, d.hero.title) || d.hero.title,
        desc: text(h.desc, 160, d.hero.desc)
      },
      theme: {
        primary: /^#[0-9a-fA-F]{6}$/.test(String(t.primary || '')) ? String(t.primary).toUpperCase() : d.theme.primary
      },
      footer: {
        org: text(f.org, 40, d.footer.org) || d.footer.org,
        address: text(f.address, 80, ''),
        copyright: text(f.copyright, 80, '')
      }
    };
  }

  /* ---------- 색상 ---------- */

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function shade(hex, amount) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
  }

  function luminance(hex) {
    return hexToRgb(hex).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }).reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
  }

  /** 흰 글자와의 대비 (4.5 이상이면 버튼 글자가 잘 읽힙니다) */
  function contrastWithWhite(hex) {
    return 1.05 / (luminance(hex) + 0.05);
  }

  /* ---------- 그리기 (신청 화면) ---------- */

  const $ = (sel) => document.querySelector(sel);

  function linkEl(l, cls) {
    const a = document.createElement('a');
    a.textContent = l.label;
    a.href = l.url;
    if (cls) a.className = cls;
    if (l.newTab) {
      a.target = '_blank';
      a.rel = 'noopener';
      const sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = ' (새 창)';
      a.appendChild(sr);
    }
    return a;
  }

  function fill(listEl, items, cls) {
    listEl.innerHTML = '';
    items.forEach((l) => {
      const li = document.createElement('li');
      li.appendChild(linkEl(l, cls));
      listEl.appendChild(li);
    });
  }

  function setText(sel, value) {
    const el = $(sel);
    if (!el) return null;
    el.textContent = value || '';
    el.hidden = !value;
    return el;
  }

  /**
   * ctx.year    신청 연도 ({year} 자리에 넣습니다)
   * ctx.contact 서버가 알려준 문의 번호 (설정에 번호가 비어 있으면 이 번호를 씁니다)
   */
  function apply(raw, ctx) {
    const site = clean(raw);
    const c = ctx || {};
    if (!$('#brandOrg')) return site;

    // 색상
    const root = document.documentElement.style;
    root.setProperty('--ssu-primary', site.theme.primary);
    root.setProperty('--ssu-primary-dark', shade(site.theme.primary, 0.18));

    // 로고 · 이름
    const b = site.brand;
    const img = $('#brandLogo');
    if (b.logo) {
      img.src = b.logo;
      img.alt = b.showOrgName ? '' : b.logoAlt;
      img.style.height = b.logoHeight + 'px';
      img.hidden = false;
      $('#brandMark').hidden = true;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      $('#brandMark').hidden = false;
    }
    const org = $('#brandOrg');
    org.textContent = b.orgName;
    org.hidden = !b.showOrgName;
    const svc = setText('#brandService', b.serviceName);
    if (svc) svc.classList.toggle('no-divider', !b.showOrgName);
    $('#brandLink').setAttribute('aria-label', b.orgName + ' ' + (b.serviceName || '') + ' 처음으로');

    // 맨 위 띠
    const u = site.utility;
    const hasUtil = u.show && (u.links.length || u.hours);
    $('#utilityBar').hidden = !hasUtil;
    fill($('#utilityLinks'), u.links);
    setText('#utilityHours', u.hours ? '운영 시간 ' + u.hours : '');

    // 메뉴
    fill($('#headerNavList'), site.nav.links, 'header-nav-link');
    $('#headerNav').hidden = !site.nav.links.length;

    // 문의
    const phone = site.contact.phone || c.contact || '';
    setText('#contactLabel', site.contact.label);
    document.querySelectorAll('.js-tel').forEach((a) => {
      const num = a.querySelector('.js-tel-num');
      (num || a).textContent = phone;
      a.href = 'tel:' + phone.replace(/[^0-9+]/g, '');
    });
    document.querySelectorAll('.js-contact-label').forEach((el) => { el.textContent = site.contact.label || '문의'; });

    // 공지 띠
    const no = site.notice;
    const bar = $('#noticeBar');
    bar.hidden = !(no.show && no.text);
    bar.className = 'notice-bar tone-' + no.tone;
    $('#noticeBarText').textContent = no.text;
    const nl = $('#noticeBarLink');
    if (no.url && no.linkLabel) {
      nl.textContent = no.linkLabel;
      nl.href = no.url;
      nl.hidden = false;
    } else {
      nl.hidden = true;
    }

    // 제목 영역
    const h = site.hero;
    const year = c.year || '';
    $('#hero').classList.toggle('is-band', h.style === 'band');
    setText('#heroEyebrow', h.eyebrow);
    $('#pageTitle').textContent = h.title.replace(/\{year\}/g, year).replace(/^\s*년\s*/, '').trim();
    setText('#heroDesc', h.desc);

    // 하단
    const f = site.footer;
    $('#footerOrg').textContent = f.org;
    setText('#footerAddress', f.address);
    setText('#footerCopy', f.copyright);

    return site;
  }

  window.SITE = { defaults, clean, apply, logoOk, contrastWithWhite, shade, MAX_LOGO_CHARS };
})();
