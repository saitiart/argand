// =============================================================================
//  Expression box: the f(z) input + one slider per parameter
//
//  Compiles on every keystroke (cheap: it only produces bytecode). Parameters
//  found in the formula get a slider; values are remembered by name, so
//  editing the formula keeps them.
// =============================================================================

import { compileExpression, encodeParameterValues, SUPPORTED_HELP } from '../expression.ts';
import { el } from './components.ts';

export interface ExpressionHandlers {
    onProgram(program: ArrayBuffer, typed: boolean, usesTime: boolean): void;
    onParameters(values: Float32Array): void;
}

export interface ExpressionPanel {
    setText(text: string): void;
}

const DEFAULT_VALUE = 1.0;
const DEFAULT_RANGE = 5.0;      
const HELP = 'Letters other than z, t, i, e, pi become sliders.';

export function createExpressionPanel(
    parent: HTMLElement,
    initial: string,
    handlers: ExpressionHandlers,
): ExpressionPanel {
    
    const row = el('label', 'ui-formula', parent);
    el('span', undefined, row, 'f(z) =');
    const input = el('input', undefined, row);
    input.type = 'text';
    input.value = initial;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = '(z^2 - a) / (z^2 + b)';

    
    const sliders = el('div', 'ui-group', parent);

    
    const status = el('div', 'ui-status', parent, HELP);
    const details = el('details', 'ui-hint', parent);
    el('summary', undefined, details, 'Supported syntax');
    el('div', undefined, details, SUPPORTED_HELP);

    
    input.addEventListener('keydown', e => e.stopPropagation());

    const showError = (message: string | null) => {
        input.classList.toggle('error', message !== null);
        status.classList.toggle('error', message !== null);
        status.textContent = message ?? HELP;
    };

    
    const values = new Map<string, number>();   
    let names: string[] = [];                    

    const sendParameters = () => {
        handlers.onParameters(encodeParameterValues(names.map(n => values.get(n) ?? DEFAULT_VALUE)));
    };

    const createSliderRow = (name: string) => {
        if (!values.has(name)) values.set(name, DEFAULT_VALUE);
        const value = values.get(name)!;

        const r = el('div', 'ui-row');
        el('span', 'ui-label math', r, `${name} =`);
        const range = el('input', 'ui-range', r);
        range.type = 'range';
        range.min = String(Math.min(-DEFAULT_RANGE, value));
        range.max = String(Math.max(DEFAULT_RANGE, value));
        range.step = '0.01';
        range.value = String(value);
        const number = el('input', 'ui-num', r);
        number.type = 'number';
        number.step = '0.01';
        number.value = value.toFixed(2);
        number.addEventListener('keydown', e => e.stopPropagation());

        range.addEventListener('input', () => {
            const v = Number(range.value);
            values.set(name, v);
            number.value = v.toFixed(2);
            sendParameters();
        });
        number.addEventListener('input', () => {
            const v = Number(number.value);
            if (!Number.isFinite(v) || number.value === '') return;
            values.set(name, v);
            if (v < Number(range.min)) range.min = String(v);
            if (v > Number(range.max)) range.max = String(v);
            range.value = String(v);
            sendParameters();
        });
        return r;
    };

    
    const syncSliders = (next: string[]) => {
        const same = next.length === names.length && next.every((n, i) => n === names[i]);
        names = next;
        if (!same) sliders.replaceChildren(...next.map(createSliderRow));
        sendParameters();
    };

    const compile = (typed: boolean) => {
        const result = compileExpression(input.value);
        if (!result.ok) {
            showError(result.error);
            return;
        }
        showError(null);
        syncSliders(result.parameters);
        handlers.onProgram(result.program, typed, result.usesTime);
    };

    input.addEventListener('input', () => compile(true));

    const api: ExpressionPanel = {
        setText(text: string) {
            input.value = text;
            if (text.trim()) {
                compile(false);
            } else {
                showError(null);
                syncSliders([]);
            }
        },
    };

    api.setText(initial);
    return api;
}
