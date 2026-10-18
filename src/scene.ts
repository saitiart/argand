// =============================================================================
//  Scene layout: the bounding box and what each axis spans
//
//  Shared by the axes (ticks, arrows, drawn box) and the surface renderer
//  (which clips everything outside the box), so both always agree.
// =============================================================================

import { Params } from './config.ts';


// Odd function from a linear coordinate (value × unit) to the world coordinate
export interface HeightCurve {
    forward(x: number): number;
    inverse(y: number): number;
}

export interface AxisRange {
    min: number;    // world coordinate along the axis
    max: number;
    unit: number;   // world units per labelled unit (0 = no numbers)
    curve?: HeightCurve;    // nonlinear axis (soft cap / log heights)
}

// CPU mirror of map_height() in complex4d.wgsl for a full (Re, Im) height pair
export function mapHeight(h: [number, number], params: Params): [number, number] {
    const m = Math.max(Math.abs(h[0]), Math.abs(h[1]));
    if (!Number.isFinite(m)) return [0, 0];
    const mode = Number(params.height_mode);
    let s = 1;
    if (m > 0 && mode !== 0) {
        const r = Math.hypot(h[0], h[1]);
        const R = Math.max(params.box_height, 1e-6);
        s = (mode === 2 ? R * Math.log1p(r / R) : R * Math.tanh(Math.min(r / R, 20))) / r;
    }
    let out: [number, number] = [h[0] * s, h[1] * s];
    const mm = Math.max(Math.abs(out[0]), Math.abs(out[1]));
    if (mm > 1e4) out = [out[0] * 1e4 / mm, out[1] * 1e4 / mm];   // MAX_HEIGHT
    return out;
}

// CPU mirror of map_height() in complex4d.wgsl, for one axis (the other component is 0)
export function heightCurve(params: Params): HeightCurve | undefined {
    const mode = Number(params.height_mode);
    const R = Math.max(params.box_height, 1e-6);
    const odd = (g: (t: number) => number) => (t: number) => Math.sign(t) * g(Math.abs(t));
    if (mode === 1) {
        return {
            forward: odd(t => R * Math.tanh(t / R)),
            inverse: odd(t => R * Math.atanh(Math.min(t / R, 1 - 1e-6))),
        };
    }
    if (mode === 2) {
        return {
            forward: odd(t => R * Math.log1p(t / R)),
            inverse: odd(t => R * Math.expm1(t / R)),
        };
    }
    return undefined;
}

export function sceneLayout(params: Params): { ranges: AxisRange[]; graph: boolean } {
    const isFiber = params.show_fibration > 0.5;
    const isRiemann = params.use_riemann_sphere >= 0.5;

    // Plain graph of f: x = Re z, y = Re f, z = Im z, w = Im f
    if (!isFiber && !isRiemann) {
        const span = (shift: number, size: number, scale: number): AxisRange => {
            const a = (shift - size) * scale;
            const b = (shift + size) * scale;
            return { min: Math.min(a, b), max: Math.max(a, b), unit: scale };
        };
        const rx = span(params.shift_x, params.domain_size_x, params.scale_re);
        const rz = span(params.shift_z, params.domain_size_z, params.scale_im);
        const h = params.box_height;
        const curve = heightCurve(params);
        return {
            graph: true,
            ranges: [
                rx,
                { min: -h, max: h, unit: params.amp_re, curve },
                rz,
                { min: -h, max: h, unit: params.amp_im, curve },
            ],
        };
    }

    // Sphere / fibration modes: plain coordinates
    const sphereMode = Number(params.sphere_mode);
    const r = isFiber ? 2.0 : sphereMode >= 2 ? 1.5 : sphereMode >= 1 ? 1.4 : 1.0;
    const range = { min: -r, max: r, unit: 1 };
    return { graph: false, ranges: [range, range, range, range] };
}
