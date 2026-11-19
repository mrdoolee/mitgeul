/** 안전한 DOM 생성 도구. 외부·사용자·모델 문자열은 항상 textContent로 넣는다(innerHTML 사용 안 함). */
type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.style.cssText = String(v); // CSSOM: CSP style-src 'self'에서도 허용
      else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
      else if (k === 'checked' && 'checked' in el) (el as HTMLInputElement).checked = !!v;
      else if (k === 'disabled' && 'disabled' in el) (el as HTMLButtonElement).disabled = !!v;
      else if (k === 'selected' && 'selected' in el) (el as HTMLOptionElement).selected = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]) {
  for (const c of children.flat(Infinity as 1) as Child[]) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS: Record<string, string[]> = {
  dashboard: ['M3 13h8V3H3z', 'M13 21h8V11h-8z', 'M3 21h8v-6H3z', 'M13 3v6h8V3z'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  spark: ['M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z', 'M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z'],
  check: ['M20 6L9 17l-5-5'],
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
  copy: ['M9 9h11v11H9z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  up: ['M18 15l-6-6-6 6'],
  down: ['M6 9l6 6 6-6'],
  left: ['M15 18l-6-6 6-6'],
  right: ['M9 18l6-6-6-6'],
  x: ['M18 6L6 18', 'M6 6l12 12'],
  plus: ['M12 5v14', 'M5 12h14'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
};

export function icon(name: keyof typeof ICONS | string, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ico');
  for (const d of ICONS[name] ?? ICONS.info!) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

let toastTimer: number | undefined;
export function toast(message: string, kind: 'ok' | 'err' | 'info' | 'warn' = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(el);
  }
  el.className = `toast ${kind} on`;
  el.textContent = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('on'), kind === 'err' ? 7000 : 3500);
}

/**
 * AI 요청 대기 토스트. 화면 오른쪽 아래에 진한 색으로 응답이 올 때까지 남는다.
 * 작업 중인지 알 수 있게 닫기 단추는 두지 않고 경과 시간을 보여 준다. [요청 취소]는 onCancel을 부른다.
 * 응답이 오면 호출한 쪽이 close()로 없앤다.
 */
export function busyToast(title: string, detail: string, onCancel?: () => void): { close: () => void } {
  document.getElementById('busy-toast')?.remove();
  document.getElementById('alert-toast')?.remove();
  const t0 = Date.now();
  const elapsed = h('span', { class: 'busy-elapsed' }, '경과 0초');
  const note = h('small', null, detail);
  const timer = window.setInterval(() => {
    if (!el.isConnected) return window.clearInterval(timer);
    const sec = Math.floor((Date.now() - t0) / 1000);
    elapsed.textContent = `경과 ${sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`}`;
    if (sec === 40) {
      note.textContent = '응답이 평소보다 늦습니다. AI 제공자 쪽이 혼잡할 수 있습니다. 계속 기다리거나, [요청 취소] 후 기본설정에서 다른 모델·제공자로 다시 요청하세요.';
      el.classList.add('slow');
    }
  }, 1000);
  const close = () => {
    window.clearInterval(timer);
    el.remove();
    document.body.classList.remove('busy-on');
  };
  const el = h('div', { id: 'busy-toast', class: 'busy-toast', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    h('div', { class: 'busy-text' }, h('b', null, title, ' ', elapsed), note),
    onCancel ? h('button', { class: 'busy-cancel', onclick: () => onCancel() }, '요청 취소') : null,
  );
  document.body.appendChild(el);
  document.body.classList.add('busy-on');
  return { close };
}

/**
 * 오래 남는 안내 토스트(AI 요청 실패·부분 실패 등). 무슨 문제가 있었는지 읽을 수 있게 [닫기]를 누를 때까지 남는다.
 * 새 AI 요청을 시작하면 자동으로 사라진다.
 */
export function alertToast(kind: 'err' | 'warn', title: string, ...lines: string[]) {
  document.getElementById('alert-toast')?.remove();
  const el = h('div', { id: 'alert-toast', class: `alert-toast ${kind}`, role: 'alert' },
    icon('alert', 20),
    h('div', { class: 'busy-text' }, h('b', null, title), ...lines.filter(Boolean).map((l) => h('small', null, l))),
    h('button', { class: 'busy-cancel', onclick: () => el.remove() }, '닫기'),
  );
  document.body.appendChild(el);
}

export function banner(kind:'ok' | 'err' | 'info' | 'warn', title: string, ...lines: Child[]) {
  return h('div', { class: `banner ${kind}` }, icon(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert', 20), h('div', null, h('b', null, title), lines.length ? h('small', null, ...lines) : null));
}

let openModals = 0;

/**
 * 모달: 닫으면 resolve(undefined). body 생성기에 close(value)를 넘긴다.
 * 열려 있는 동안 배경(body) 스크롤을 막는다. backdropClose를 켜면 바깥 어두운 영역을 눌러도 닫힌다(입력이 없는 안내용 창에만 쓴다).
 */
export function modal<T>(title: string, build: (close: (v?: T) => void) => Node, wide = false, opts: { backdropClose?: boolean; className?: string } = {}): Promise<T | undefined> {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back on' });
    const opener = document.activeElement as HTMLElement | null;
    let closed = false;
    const close = (v?: T) => {
      if (closed) return;
      closed = true;
      back.remove();
      document.removeEventListener('keydown', onKey);
      if (--openModals <= 0) {
        openModals = 0;
        document.body.classList.remove('modal-open');
      }
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    if (opts.backdropClose) back.addEventListener('click', (e) => e.target === back && close());
    openModals++;
    document.body.classList.add('modal-open');
    back.appendChild(
      h('div', { class: `modal ${wide ? 'wide' : ''} ${opts.className ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: () => close() }, icon('x'))),
        h('div', { class: 'modal-body' }, build(close)),
      ),
    );
    document.body.appendChild(back);
    (back.querySelector('input, textarea, select, button.primary') as HTMLElement | null)?.focus();
  });
}

/** 비밀번호 입력 창. ack를 주면 경고를 크게 보여 주고 그 문장에 체크해야 [확인]이 눌린다. */
export function promptPassword(title: string, hint: string, confirm = false, ack?: string): Promise<string | undefined> {
  return modal<string>(title, (close) => {
    const p1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const p2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const err = h('p', { class: 'hint err-text' });
    const ok = h('button', { class: 'btn primary', disabled: !!ack }, '확인');
    const ackBox = h('input', { type: 'checkbox' });
    ackBox.addEventListener('change', () => (ok.disabled = !ackBox.checked));
    const submit = () => {
      if (ack && !ackBox.checked) return (err.textContent = '안내 문장에 체크하세요.');
      if (p1.value.length < 8) return (err.textContent = '8자 이상 입력하세요.');
      if (confirm && p1.value !== p2.value) return (err.textContent = '두 비밀번호가 다릅니다.');
      close(p1.value);
    };
    ok.addEventListener('click', submit);
    p1.addEventListener('keydown', (e) => e.key === 'Enter' && !confirm && submit());
    return h('div', null,
      ack ? banner('err', '비밀번호를 잊으면 앱 자료를 열 수 없습니다.', hint) : h('p', { class: 'hint' }, hint),
      field('비밀번호', p1), confirm ? field('비밀번호 확인', p2) : null,
      ack ? h('label', { class: 'check ack' }, ackBox, ` ${ack}`) : null,
      err,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => close() }, '취소'), ok));
  });
}

export function confirmText(title: string, message: string, phrase: string): Promise<boolean> {
  return modal<boolean>(title, (close) => {
    const inp = h('input', { class: 'input' });
    return h('div', null, h('p', null, message), h('p', { class: 'hint' }, `계속하려면 "${phrase}"를 입력하세요.`), inp, h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => close(false) }, '취소'), h('button', { class: 'btn danger', onclick: () => close(inp.value === phrase) }, '확인')));
  }).then((v) => !!v);
}

export function field(label: string, control: Node, hint?: string, opt?: string) {
  return h('div', { class: 'field' }, h('label', null, label, opt ? h('span', { class: 'opt' }, opt) : null), control, hint ? h('p', { class: 'hint' }, hint) : null);
}

export function select<T extends string | number>(options: { value: T; label: string }[], value: T | null | undefined, onchange: (v: T) => void, attrs: Attrs = {}) {
  const s = h('select', { class: 'select', ...attrs }, ...options.map((o) => h('option', { value: String(o.value), selected: o.value === value }, o.label)));
  s.addEventListener('change', () => {
    const o = options.find((x) => String(x.value) === s.value);
    if (o) onchange(o.value);
  });
  return s;
}

export function chip(text: string, kind = '') {
  return h('span', { class: `chip ${kind}` }, text);
}
