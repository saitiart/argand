export interface Domain {
    x: [number, number];
    z: [number, number];
}

export interface ComplexFunction {
    name: string;
    domain: Domain;
    expr?: string;
}

const DEFAULT_DOMAIN: Domain = { x: [-1.0, 1.0], z: [-1.0, 1.0] };

export const FUNCTIONS: ComplexFunction[] = [
    { name: 'z²',       domain: DEFAULT_DOMAIN, expr: 'z^2' },           // 0
    { name: 'log(z)',   domain: DEFAULT_DOMAIN, expr: 'log(z)' },        // 1
    { name: 'sin(z)',   domain: DEFAULT_DOMAIN, expr: 'sin(z)' },        // 2
    { name: 'tan(z)',   domain: DEFAULT_DOMAIN, expr: 'tan(z)' },        // 3
    { name: '√z',       domain: DEFAULT_DOMAIN, expr: 'sqrt(z)' },       // 4
    { name: 'sin(1/z)', domain: DEFAULT_DOMAIN, expr: 'sin(1/z)' },      // 5
    { name: 'exp(z)',   domain: DEFAULT_DOMAIN, expr: 'exp(z)' },        // 6
    { name: 'z^z',      domain: DEFAULT_DOMAIN, expr: 'z^z' },           // 7
    { name: 'exp(1/z)', domain: DEFAULT_DOMAIN, expr: 'exp(1/z)' },      // 8
    { name: 'z + 1/z',  domain: DEFAULT_DOMAIN, expr: 'z + 1/z' },       // 9
    { name: 'ζ(z)',     domain: DEFAULT_DOMAIN, expr: 'zeta(z)' },       // 10
    { name: 'ξ(z)',     domain: DEFAULT_DOMAIN, expr: 'xi(z)' },         // 11
    { name: 'Γ(z)',     domain: DEFAULT_DOMAIN, expr: 'gamma(z)' },      // 12
    { name: 'J₁(z)',    domain: DEFAULT_DOMAIN, expr: 'besselj(z, 1)' }, // 13
    { name: 'Airy(z)',  domain: DEFAULT_DOMAIN, expr: 'airy(z)' },       // 14
    { name: 'Julia',    domain: DEFAULT_DOMAIN },                        // 15
    { name: 'Extra',    domain: DEFAULT_DOMAIN },                        // 16
    { name: 'Custom',   domain: DEFAULT_DOMAIN },                        // 17 (the typed expression)
];

export const CUSTOM_FUNCTION_INDEX = 17;

// Derivatives run through the formula interpreter, so they need a formula
// (the typed one, or a preset's `expr`).
export function hasFormula(index: number): boolean {
    return Number(index) === CUSTOM_FUNCTION_INDEX || !!FUNCTIONS[Number(index)]?.expr;
}
