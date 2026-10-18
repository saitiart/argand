export class Ui {
    private refreshers: (() => void)[] = [];

    track(fn: () => void) {
        this.refreshers.push(fn);
        fn();
    }

    refresh() {
        for (const fn of this.refreshers) fn();
    }
}

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    parent?: HTMLElement,
    text?: string,
): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    parent?.appendChild(e);
    return e;
}


export function loadSetting(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
}

export function saveSetting(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function section(parent: HTMLElement, id: string, title: string, openByDefault: boolean): HTMLElement {
    const root = el('div', 'ui-section', parent);
    const head = el('button', 'ui-section-head', root);
    el('span', 'ui-chevron', head, '›');
    el('span', undefined, head, title);
    const body = el('div', 'ui-section-body', root);

    const key = `cx4d.section.${id}`;
    const stored = loadSetting(key);
    root.classList.toggle('open', stored === null ? openByDefault : stored === '1');

    head.addEventListener('click', () => {
        const open = !root.classList.contains('open');
        root.classList.toggle('open', open);
        saveSetting(key, open ? '1' : '0');
    });
    return body;
}

export function group(parent: HTMLElement): HTMLElement {
    return el('div', 'ui-group', parent);
}

export interface SliderOptions {
    label: string;
    min: number;
    max: number;
    step: number;
    get(): number;
    set(value: number): void;
    log?: boolean;           
    commitOnly?: boolean;    
    digits?: number;         
    mathLabel?: boolean;     
}

const LOG_STEPS = 1000;

export function slider(ui: Ui, parent: HTMLElement, o: SliderOptions): HTMLElement {
    const row = el('div', 'ui-row', parent);
    el('span', o.mathLabel ? 'ui-label math' : 'ui-label', row, o.label);
    const range = el('input', 'ui-range', row);
    const num = el('input', 'ui-num', row);
    range.type = 'range';
    num.type = 'number';
    num.step = String(o.step);

    const digits = o.digits ?? Math.max(0, Math.min(4, -Math.floor(Math.log10(o.step) + 1e-9)));

    if (o.log) {
        range.min = '0';
        range.max = String(LOG_STEPS);
        range.step = '1';
    } else {
        range.min = String(o.min);
        range.max = String(o.max);
        range.step = String(o.step);
    }
    const toTrack = (v: number) =>
        o.log ? (Math.log(Math.max(v, o.min) / o.min) / Math.log(o.max / o.min)) * LOG_STEPS : v;
    const fromTrack = (t: number) =>
        o.log ? o.min * Math.pow(o.max / o.min, t / LOG_STEPS) : t;

    const show = (v: number) => {
        range.value = String(toTrack(v));
        if (document.activeElement !== num) num.value = v.toFixed(digits);
    };

    range.addEventListener('input', () => {
        const v = Number(fromTrack(Number(range.value)).toFixed(digits + 2));
        num.value = v.toFixed(digits);
        if (!o.commitOnly) o.set(v);
    });
    range.addEventListener('change', () => {
        if (o.commitOnly) o.set(Number(fromTrack(Number(range.value)).toFixed(digits + 2)));
    });
    // Typed values may go beyond the track range
    num.addEventListener(o.commitOnly ? 'change' : 'input', () => {
        if (num.value === '' || !Number.isFinite(Number(num.value))) return;
        const v = Number(num.value);
        o.set(v);
        range.value = String(toTrack(v));
    });
    num.addEventListener('blur', () => show(o.get()));

    ui.track(() => show(o.get()));
    return row;
}


export function toggle(ui: Ui, parent: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void) {
    const row = el('label', 'ui-toggle-row', parent);
    el('span', 'ui-label', row, label);
    const input = el('input', 'ui-switch', row);
    input.type = 'checkbox';
    input.addEventListener('change', () => { set(input.checked); ui.refresh(); });
    ui.track(() => { input.checked = get(); });
}




export function segmented<T>(
    ui: Ui,
    parent: HTMLElement,
    label: string | null,
    options: { label: string; value: T; title?: string }[],
    get: () => T,
    set: (v: T) => void,
) {
    if (label) el('div', 'ui-field-label', parent, label);
    const bar = el('div', 'ui-segmented', parent);
    const buttons = options.map(opt => {
        const b = el('button', undefined, bar, opt.label);
        if (opt.title) b.title = opt.title;
        b.addEventListener('click', () => { set(opt.value); ui.refresh(); });
        return b;
    });
    ui.track(() => {
        const current = get();
        buttons.forEach((b, i) => b.classList.toggle('active', options[i].value === current));
    });
}



export function select(
    ui: Ui,
    parent: HTMLElement,
    label: string | null,
    options: { label: string; value: number }[],
    get: () => number,
    set: (v: number) => void,
) {
    if (label) el('div', 'ui-field-label', parent, label);
    const s = el('select', 'ui-select', parent);
    for (const opt of options) {
        const o = el('option', undefined, s, opt.label);
        o.value = String(opt.value);
    }
    s.addEventListener('change', () => set(Number(s.value)));
    ui.track(() => { s.value = String(get()); });
}

export function button(parent: HTMLElement, label: string, onClick: () => void, title?: string): HTMLButtonElement {
    const b = el('button', 'ui-btn', parent, label);
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
}

export function hint(parent: HTMLElement, html: string): HTMLElement {
    const h = el('div', 'ui-hint', parent);
    h.innerHTML = html;
    return h;
}

export function readout(parent: HTMLElement, label: string): ((text: string) => void) & { label: HTMLSpanElement } {
    const row = el('div', 'ui-readout', parent);
    const labelEl = el('span', undefined, row, label);
    const value = el('span', undefined, row, '–');
    return Object.assign((text: string) => { value.textContent = text; }, { label: labelEl });
}
