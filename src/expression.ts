// =============================================================================
//  Expression → GPU bytecode
//
//  Parses a user formula with math.js and turns it into a small stack-machine
//  program (postfix instructions). The program is written into a GPU buffer and
//  run per vertex by the interpreter in shaders/expression-vm.wgsl, which calls
//  the existing complex functions (c_sin, c_mul, c_zeta, ...).
//
//  Changing the formula is a buffer write — the shader is never recompiled.
//
//  Variables:  z (input), t (animation time, real)
//  Constants:  i, pi, e, tau, phi
//  Parameters: any other name (a, b, k, alpha, ...). Each gets a slot in a
//              separate GPU array, so changing a value is a tiny buffer write
//              and the program itself stays the same.
//  Operators:  + - * / ^ !  (implicit multiplication like 2z works)
// =============================================================================

import { parse, MathNode } from 'mathjs';


// -----------------------------------------------------------------------------
// Opcodes — the single source of truth. OPCODES_WGSL turns this table into the
// OP_* constants the interpreter uses, so the two can never drift apart.
// -----------------------------------------------------------------------------

const OP = {
    // push
    CONST: 1,       // push value
    Z: 2,           // push z
    T: 3,           // push animation time
    PARAM: 4,       // push user_params[arg]
    // binary: pop b, pop a, push a ∘ b
    ADD: 10,
    SUB: 11,
    MUL: 12,
    DIV: 13,
    POW: 14,
    // unary: replace top of stack
    NEG: 20,
    POW_REAL: 21,   // top ^ value.x
    BESSEL_J: 22,   // J_n(top), n = value.x
    FACTORIAL: 23,  // Γ(top + 1)
    SIN: 30, COS: 31, TAN: 32,
    SINH: 33, COSH: 34, TANH: 35,
    ASIN: 36, ACOS: 37, ATAN: 38, ASINH: 39,
    EXP: 40, LOG: 41, SQRT: 42, INV: 43, CONJ: 44,
    RE: 45, IM: 46, ABS: 47, ARG: 48,
    GAMMA: 49, ZETA: 50, XI: 51, AIRY: 52,
} as const;

export const OPCODES_WGSL =
    '// Generated from src/expression.ts\n' +
    Object.entries(OP).map(([name, code]) => `const OP_${name}: u32 = ${code}u;`).join('\n') + '\n';

// Must match shaders/expression-vm.wgsl
const MAX_INSTRUCTIONS = 256;
const STACK_SIZE = 16;
const HEADER_BYTES = 16;            // count: u32 + 3 × padding
const INSTRUCTION_BYTES = 16;       // op: u32, arg: u32, value: vec2f

export const PROGRAM_BUFFER_SIZE = HEADER_BYTES + MAX_INSTRUCTIONS * INSTRUCTION_BYTES;

// Parameter values: one vec2f (complex, imaginary part currently 0) per parameter
export const MAX_PARAMETERS = 16;
export const PARAMETER_BUFFER_SIZE = MAX_PARAMETERS * 8;

// Packs parameter values (in the order of CompileResult.parameters) for the GPU
export function encodeParameterValues(values: number[]): Float32Array {
    const data = new Float32Array(MAX_PARAMETERS * 2);
    values.slice(0, MAX_PARAMETERS).forEach((v, i) => { data[i * 2] = v; });
    return data;
}


// -----------------------------------------------------------------------------
// Names the user can type
// -----------------------------------------------------------------------------

const FUNCTIONS: Record<string, number> = {
    sin: OP.SIN, cos: OP.COS, tan: OP.TAN,
    sinh: OP.SINH, cosh: OP.COSH, tanh: OP.TANH,
    asin: OP.ASIN, acos: OP.ACOS, atan: OP.ATAN, asinh: OP.ASINH,
    exp: OP.EXP, log: OP.LOG, ln: OP.LOG, sqrt: OP.SQRT,
    inv: OP.INV, conj: OP.CONJ,
    re: OP.RE, im: OP.IM, abs: OP.ABS, arg: OP.ARG,
    gamma: OP.GAMMA, zeta: OP.ZETA, xi: OP.XI, airy: OP.AIRY,
};

const CONSTANTS: Record<string, [number, number]> = {
    i:   [0, 1],
    pi:  [Math.PI, 0],
    e:   [Math.E, 0],
    tau: [2 * Math.PI, 0],
    phi: [(1 + Math.sqrt(5)) / 2, 0],
};

export const SUPPORTED_HELP =
    'z, t · i, pi, e · other letters (a, b, …) become sliders · ' +
    Object.keys(FUNCTIONS).join(', ') + ', pow(a, b), besselj(z, n)';


// -----------------------------------------------------------------------------
// Compiler
// -----------------------------------------------------------------------------

export type CompileResult =
    | { ok: true; program: ArrayBuffer; instructions: number; parameters: string[]; usesTime: boolean }
    | { ok: false; error: string };

class ExpressionError extends Error {}

interface Instruction { op: number; arg: number; x: number; y: number }

class Emitter {
    code: Instruction[] = [];
    parameters: string[] = [];      // index = parameter slot, in order of first use
    private depth = 0;
    maxDepth = 0;

    push(op: number, x = 0, y = 0, arg = 0) {
        this.code.push({ op, arg, x, y });
        this.depth++;
        this.maxDepth = Math.max(this.maxDepth, this.depth);
    }
    binary(op: number) {
        this.code.push({ op, arg: 0, x: 0, y: 0 });
        this.depth--;
    }
    unary(op: number, x = 0) {
        this.code.push({ op, arg: 0, x, y: 0 });
    }
    parameter(name: string) {
        let slot = this.parameters.indexOf(name);
        if (slot < 0) {
            if (this.parameters.length >= MAX_PARAMETERS) {
                throw new ExpressionError(`Too many parameters (max ${MAX_PARAMETERS})`);
            }
            slot = this.parameters.push(name) - 1;
        }
        this.push(OP.PARAM, 0, 0, slot);
    }
}

function finite(x: number): number {
    if (!Number.isFinite(x)) throw new ExpressionError('Numbers must be finite');
    return x;
}

function unwrapParens(node: MathNode): MathNode {
    while (node.type === 'ParenthesisNode') node = (node as any).content;
    return node;
}

// A real constant like 2, -0.5 or (3) — used for z^n and besselj(z, n)
function realConstant(node: MathNode): number | null {
    node = unwrapParens(node);
    if (node.type === 'ConstantNode' && typeof (node as any).value === 'number') return (node as any).value;
    if (node.type === 'OperatorNode' && (node as any).fn === 'unaryMinus') {
        const v = realConstant((node as any).args[0]);
        return v === null ? null : -v;
    }
    return null;
}

function emit(node: MathNode, out: Emitter): void {
    const n = node as any;
    switch (node.type) {
        case 'ParenthesisNode':
            return emit(n.content, out);

        case 'ConstantNode':
            if (typeof n.value !== 'number') throw new ExpressionError(`Unsupported constant "${n.value}"`);
            return out.push(OP.CONST, finite(n.value), 0);

        case 'SymbolNode': {
            if (n.name === 'z') return out.push(OP.Z);
            if (n.name === 't') return out.push(OP.T);
            const c = CONSTANTS[n.name];
            if (c) return out.push(OP.CONST, c[0], c[1]);
            if (n.name in FUNCTIONS || n.name === 'besselj' || n.name === 'pow') {
                throw new ExpressionError(`"${n.name}" is a function — write ${n.name}(…)`);
            }
            return out.parameter(n.name);
        }

        case 'OperatorNode': {
            const args: MathNode[] = n.args;
            const binary = (op: number) => { emit(args[0], out); emit(args[1], out); out.binary(op); };
            switch (n.fn) {
                case 'add':        return binary(OP.ADD);
                case 'subtract':   return binary(OP.SUB);
                case 'multiply':   return binary(OP.MUL);
                case 'divide':     return binary(OP.DIV);
                case 'unaryPlus':  return emit(args[0], out);
                case 'unaryMinus': emit(args[0], out); return out.unary(OP.NEG);
                case 'factorial':  emit(args[0], out); return out.unary(OP.FACTORIAL);
                case 'pow': {
                    const base = unwrapParens(args[0]);
                    if (base.type === 'SymbolNode' && (base as any).name === 'e') {
                        emit(args[1], out);                       // e^w → exp(w)
                        return out.unary(OP.EXP);
                    }
                    const k = realConstant(args[1]);
                    if (k !== null) {                             // z^2, z^-0.5
                        emit(args[0], out);
                        return out.unary(OP.POW_REAL, finite(k));
                    }
                    return binary(OP.POW);                        // z^z
                }
                default:
                    throw new ExpressionError(`Unsupported operator "${n.op}"`);
            }
        }

        case 'FunctionNode': {
            const name: string = n.fn?.name ?? '';
            const args: MathNode[] = n.args;

            if (name === 'besselj') {
                if (args.length !== 2) throw new ExpressionError('besselj takes 2 arguments: besselj(z, n)');
                const order = realConstant(args[1]);
                if (order === null) throw new ExpressionError('besselj order n must be a real number');
                emit(args[0], out);
                return out.unary(OP.BESSEL_J, finite(order));
            }
            if (name === 'pow') {
                if (args.length !== 2) throw new ExpressionError('pow takes 2 arguments: pow(a, b)');
                emit(args[0], out);
                emit(args[1], out);
                return out.binary(OP.POW);
            }

            const op = FUNCTIONS[name];
            if (op === undefined) throw new ExpressionError(`Unknown function "${name}"`);
            if (args.length !== 1) throw new ExpressionError(`${name} takes 1 argument`);
            emit(args[0], out);
            return out.unary(op);
        }

        default:
            throw new ExpressionError(`Unsupported syntax (${node.type})`);
    }
}

function encode(code: Instruction[]): ArrayBuffer {
    const buffer = new ArrayBuffer(HEADER_BYTES + code.length * INSTRUCTION_BYTES);
    const view = new DataView(buffer);
    view.setUint32(0, code.length, true);
    code.forEach((ins, i) => {
        const at = HEADER_BYTES + i * INSTRUCTION_BYTES;
        view.setUint32(at, ins.op, true);
        view.setUint32(at + 4, ins.arg, true);
        view.setFloat32(at + 8, ins.x, true);
        view.setFloat32(at + 12, ins.y, true);
    });
    return buffer;
}

export function compileExpression(source: string): CompileResult {
    const text = source.trim();
    if (!text) return { ok: false, error: 'Type a function of z' };

    try {
        const out = new Emitter();
        emit(parse(text), out);

        if (out.code.length > MAX_INSTRUCTIONS) return { ok: false, error: 'Expression is too long' };
        if (out.maxDepth > STACK_SIZE) return { ok: false, error: 'Expression is nested too deeply' };

        const usesTime = out.code.some(ins => ins.op === OP.T);
        return { ok: true, program: encode(out.code), instructions: out.code.length, parameters: out.parameters, usesTime };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
