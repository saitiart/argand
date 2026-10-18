// =============================================================================
//  Contour integrals
//
//  γ is a circle, a closed polygon or an open path on the domain. It is
//  sampled, f is evaluated at the samples on the GPU (shaders/point-eval.wgsl,
//  same code as the surface) and read back. With dz_k the weight of sample k:
//
//    ∫_γ f dz   ≈ Σ f(z_k) dz_k
//                 circle:  dz_k = i (z_k − c) Δθ      (trapezoid rule, spectrally
//                                                      accurate on a smooth loop)
//                 edges:   dz_k = w_g (b − a)          (Gauss–Legendre per edge,
//                                                      exact for polynomials of
//                                                      degree < 2G on each edge)
//    Σ Res      = ∮ f dz / 2πi                         (residue theorem, closed γ)
//    Z − P      = winding number of f(γ) about 0       (argument principle, closed γ)
//
//  The same GPU request also evaluates a coarse grid over the domain, which
//  the sidebar map uses as a phase-coloured background (poles and zeros show).
// =============================================================================

import { mat4 } from 'gl-matrix';
import { Params } from './config.ts';
import { OPCODES_WGSL } from './expression.ts';
import { TubePipeline, createTubePipeline, TUBE_INSTANCE_FLOATS, worldPerPixel, rotate4D, Rotation4D } from './axes.ts';
import { mapHeight } from './scene.ts';
import wgslUniforms from './shaders/uniforms.wgsl';
import wgslComplexMath from './shaders/complex-func.wgsl';
import wgslFunctions from './shaders/complex-functions.wgsl';
import wgslExpressionVM from './shaders/expression-vm.wgsl';
import wgslPointEval from './shaders/point-eval.wgsl';

export const CONTOUR_SAMPLES = 512;       // max samples along γ
export const MAP_W = 64;                  // background grid of the sidebar map
export const MAP_H = 48;
export const MAP_ASPECT = MAP_H / MAP_W;
const MAX_POINTS = CONTOUR_SAMPLES + MAP_W * MAP_H;
const PARAMS_BYTES = 36 * 4;              // ComplexParams
const REQUEST_INTERVAL_MS = 80;
const MAX_GAUSS = 48;                     // Gauss–Legendre nodes per edge (at most)
const LIFT_PX = 2.2;
const BASE_PX = 1.1;
const LIFT_COLOR: [number, number, number] = [0.93, 0.42, 0.05];
const BASE_COLOR: [number, number, number] = [0.25, 0.25, 0.3];

export type Point2 = [number, number];

export const CONTOUR_SHAPES = { circle: 0, polygon: 1, path: 2 } as const;

export interface ContourResult {
    closed: boolean;
    defined: boolean;                     // false: f is NaN/inf somewhere on γ (pole on the contour)
    integral: [number, number];
    residueSum: [number, number];         // closed γ only
    winding: number | null;               // zeros − poles inside (closed γ; null if f hits 0 or ∞ on γ)
    image: Float32Array;                  // f(z_k), interleaved re/im
    running: Float32Array;                // ∫ from the start of γ to sample k, k = 0..N
}

export interface MapData {
    values: Float32Array;                 // f on the MAP_W × MAP_H grid, row-major from the top
    view: MapView;
}

export interface MapView { cx: number; cy: number; halfW: number; halfH: number }

interface ContourSamples {
    points: Float32Array;                 // z_k
    dz: Float32Array;                     // weights dz_k (complex)
    closed: boolean;
    outline: Point2[];                    // what to draw on the domain plane
}

export interface CalculusResources {
    tubes: TubePipeline;
    pipeline: GPUComputePipeline;
    paramsBuffer: GPUBuffer;
    pointBuffer: GPUBuffer;
    resultBuffer: GPUBuffer;
    readBuffer: GPUBuffer;
    instanceBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
    busy: boolean;
    lastRequest: number;
    samples: ContourSamples | null;       // of the last finished evaluation
    values: Float32Array | null;          // f at those samples
}


// -----------------------------------------------------------------------------
// Sampling
// -----------------------------------------------------------------------------

// Gauss–Legendre nodes and weights on [0, 1] (Newton iteration on P_n)
const gaussCache = new Map<number, { t: number[]; w: number[] }>();
function gaussLegendre(n: number) {
    const cached = gaussCache.get(n);
    if (cached) return cached;
    const t: number[] = [], w: number[] = [];
    for (let i = 1; i <= n; i++) {
        let x = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
        let dp = 0;
        for (let iter = 0; iter < 100; iter++) {
            let p0 = 1, p1 = x;
            for (let k = 2; k <= n; k++) {
                const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
                p0 = p1; p1 = p2;
            }
            dp = (n * (x * p1 - p0)) / (x * x - 1);
            const dx = p1 / dp;
            x -= dx;
            if (Math.abs(dx) < 1e-15) break;
        }
        t.push((1 - x) / 2);                      // ascending on [0, 1]
        w.push(1 / ((1 - x * x) * dp * dp));      // = (2 / ((1−x^2) P'^2)) / 2
    }
    const result = { t, w };
    gaussCache.set(n, result);
    return result;
}

function circleSamples(params: Params): ContourSamples {
    const n = CONTOUR_SAMPLES;
    const points = new Float32Array(n * 2), dz = new Float32Array(n * 2);
    const outline: Point2[] = [];
    const dt = (2 * Math.PI) / n;
    for (let k = 0; k < n; k++) {
        const t = k * dt;
        const ex = params.contour_r * Math.cos(t), ey = params.contour_r * Math.sin(t);
        points[2 * k] = params.contour_cx + ex;
        points[2 * k + 1] = params.contour_cy + ey;
        dz[2 * k] = -ey * dt;                      // i (z − c) delta(theta)
        dz[2 * k + 1] = ex * dt;
        outline.push([points[2 * k], points[2 * k + 1]]);
    }
    return { points, dz, closed: true, outline };
}

function polylineSamples(vertices: Point2[], closed: boolean): ContourSamples {
    const edges = closed ? vertices.length : vertices.length - 1;
    const g = Math.max(2, Math.min(MAX_GAUSS, Math.floor(CONTOUR_SAMPLES / Math.max(edges, 1))));
    const { t, w } = gaussLegendre(g);
    const points = new Float32Array(edges * g * 2), dz = new Float32Array(edges * g * 2);
    let k = 0;
    for (let e = 0; e < edges; e++) {
        const [ax, ay] = vertices[e];
        const [bx, by] = vertices[(e + 1) % vertices.length];
        for (let j = 0; j < g; j++) {
            points[2 * k] = ax + t[j] * (bx - ax);
            points[2 * k + 1] = ay + t[j] * (by - ay);
            dz[2 * k] = w[j] * (bx - ax);
            dz[2 * k + 1] = w[j] * (by - ay);
            k++;
        }
    }
    const outline = closed ? [...vertices, vertices[0]] : [...vertices];
    return { points, dz, closed, outline };
}

export function contourSamples(params: Params): ContourSamples {
    const shape = Number(params.contourShape);
    if (shape === CONTOUR_SHAPES.polygon && params.contour_polygon.length >= 3) {
        return polylineSamples(params.contour_polygon, true);
    }
    if (shape === CONTOUR_SHAPES.path && params.contour_path.length >= 2) {
        return polylineSamples(params.contour_path, false);
    }
    return circleSamples(params);
}

// Region shown by the sidebar map: the domain rectangle, grown to include the
// whole contour, padded and fitted to the map aspect
export function mapView(params: Params): MapView {
    let x0 = params.shift_x - params.domain_size_x, x1 = params.shift_x + params.domain_size_x;
    let y0 = params.shift_z - params.domain_size_z, y1 = params.shift_z + params.domain_size_z;
    const include = (x: number, y: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    };
    const shape = Number(params.contourShape);
    if (shape === CONTOUR_SHAPES.circle) {
        include(params.contour_cx - params.contour_r, params.contour_cy - params.contour_r);
        include(params.contour_cx + params.contour_r, params.contour_cy + params.contour_r);
    } else {
        const pts = shape === CONTOUR_SHAPES.path ? params.contour_path : params.contour_polygon;
        for (const [x, y] of pts) include(x, y);
    }
    const halfW = 1.08 * Math.max((x1 - x0) / 2, (y1 - y0) / 2 / MAP_ASPECT);
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, halfW, halfH: halfW * MAP_ASPECT };
}

function mapPoints(view: MapView): Float32Array {
    const pts = new Float32Array(MAP_W * MAP_H * 2);
    for (let j = 0; j < MAP_H; j++) {
        for (let i = 0; i < MAP_W; i++) {
            const k = j * MAP_W + i;
            pts[2 * k] = view.cx + ((i + 0.5) / MAP_W * 2 - 1) * view.halfW;
            pts[2 * k + 1] = view.cy - ((j + 0.5) / MAP_H * 2 - 1) * view.halfH;
        }
    }
    return pts;
}


// Anaalysis

export function analyseContour(samples: ContourSamples, values: Float32Array): ContourResult {
    const n = values.length / 2;
    const { dz, closed } = samples;
    const running = new Float32Array((n + 1) * 2);
    let re = 0, im = 0, magnitude = 0;
    let defined = true;
    let windable = closed;
    let turn = 0;

    for (let k = 0; k < n; k++) {
        const fr = values[2 * k], fi = values[2 * k + 1];
        if (!Number.isFinite(fr) || !Number.isFinite(fi)) { defined = false; windable = false; }
        const wr = dz[2 * k], wi = dz[2 * k + 1];
        re += fr * wr - fi * wi;
        im += fr * wi + fi * wr;
        magnitude += Math.hypot(fr, fi) * Math.hypot(wr, wi);
        running[2 * k + 2] = re;
        running[2 * k + 3] = im;

        // Argument principle: total change of arg f along the closed curve
        if (closed) {
            const gr = values[(2 * k + 2) % (2 * n)], gi = values[(2 * k + 3) % (2 * n)];
            if (Math.hypot(fr, fi) < 1e-12 || Math.hypot(gr, gi) < 1e-12) windable = false;
            let d = Math.atan2(gi, gr) - Math.atan2(fi, fr);
            if (d > Math.PI) d -= 2 * Math.PI;
            if (d < -Math.PI) d += 2 * Math.PI;
            turn += d;
        }
    }

    // Parts below float32 round-off of the sum are 0 (e.g. ∮ of 1/(z−a)² comes out as 1e-6)
    const tol = 2e-5 * magnitude;
    const snap = (x: number) => (Math.abs(x) < tol ? 0 : x);
    const integral: [number, number] = defined ? [snap(re), snap(im)] : [NaN, NaN];
    return {
        closed,
        defined,
        integral,
        residueSum: [integral[1] / (2 * Math.PI), -integral[0] / (2 * Math.PI)],   // ∮ / 2πi
        winding: windable && Number.isFinite(turn) ? Math.round(turn / (2 * Math.PI)) : null,
        image: values,
        running,
    };
}


// GPU

export async function createCalculus(
    device: GPUDevice,
    canvasFormat: GPUTextureFormat,
    msaaCount: number,
    programBuffer: GPUBuffer,
    parameterBuffer: GPUBuffer,
): Promise<CalculusResources> {
    const tubes = await createTubePipeline(device, canvasFormat, msaaCount);

    const code = [wgslUniforms, wgslComplexMath, wgslFunctions, OPCODES_WGSL, wgslExpressionVM, wgslPointEval].join('\n');
    const module = device.createShaderModule({ code });
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });

    const bytes = MAX_POINTS * 8;
    const paramsBuffer = device.createBuffer({ size: PARAMS_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const pointBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const resultBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const instanceBuffer = device.createBuffer({
        size: 2 * (CONTOUR_SAMPLES + 2) * TUBE_INSTANCE_FLOATS * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: pointBuffer } },
            { binding: 1, resource: { buffer: paramsBuffer } },
            { binding: 2, resource: { buffer: programBuffer } },
            { binding: 3, resource: { buffer: parameterBuffer } },
            { binding: 4, resource: { buffer: resultBuffer } },
        ],
    });

    return {
        tubes, pipeline, paramsBuffer, pointBuffer, resultBuffer, readBuffer, instanceBuffer, bindGroup,
        busy: false, lastRequest: 0, samples: null, values: null,
    };
}

// Evaluates f along γ and on the map grid (throttled; at most one request in flight)
export function requestContourEvaluation(
    device: GPUDevice,
    res: CalculusResources,
    params: Params,
    paramsData: Float32Array,
    onResult: (result: ContourResult, map: MapData) => void,
) {
    const now = performance.now();
    if (res.busy || now - res.lastRequest < REQUEST_INTERVAL_MS) return;
    res.busy = true;
    res.lastRequest = now;

    const samples = contourSamples(params);
    const view = mapView(params);
    const n = samples.points.length / 2;
    const all = new Float32Array((n + MAP_W * MAP_H) * 2);
    all.set(samples.points, 0);
    all.set(mapPoints(view), n * 2);
    const count = all.length / 2;

    device.queue.writeBuffer(res.pointBuffer, 0, all);
    device.queue.writeBuffer(res.paramsBuffer, 0, paramsData);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(res.pipeline);
    pass.setBindGroup(0, res.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
    encoder.copyBufferToBuffer(res.resultBuffer, 0, res.readBuffer, 0, count * 8);
    device.queue.submit([encoder.finish()]);

    res.readBuffer.mapAsync(GPUMapMode.READ, 0, count * 8).then(() => {
        const data = new Float32Array(res.readBuffer.getMappedRange(0, count * 8).slice(0));
        res.readBuffer.unmap();
        const values = data.subarray(0, n * 2);
        res.samples = samples;
        res.values = values;
        res.busy = false;
        onResult(analyseContour(samples, values), { values: data.subarray(n * 2), view });
    }).catch(() => { res.busy = false; });
}

export interface ContourFrame {
    mvp: mat4;
    modelView: mat4;
    projection: mat4;
    canvas: HTMLCanvasElement;
    params: Params;
    rotation: Rotation4D;
}

// Draws γ on the domain plane and its lift onto the surface (f view only)
export function drawContour(device: GPUDevice, pass: GPURenderPassEncoder, res: CalculusResources, frame: ContourFrame) {
    if (!res.samples || !res.values) return;
    const { params, rotation } = frame;
    const { points, closed, outline } = res.samples;
    const vals = res.values;
    const n = points.length / 2;
    const wpp = worldPerPixel(frame.modelView, frame.projection, frame.canvas);
    const lift = Number(params.calc_view) === 0;

    const base = (p: Point2) => rotate4D([p[0] * params.scale_re, 0, p[1] * params.scale_im, 0], rotation);
    const lifted = (k: number) => {
        const fr = vals[2 * k], fi = vals[2 * k + 1];
        if (!Number.isFinite(fr) || !Number.isFinite(fi)) return null;
        const h = mapHeight([fr * params.amp_re, fi * params.amp_im], params);
        return rotate4D([points[2 * k] * params.scale_re, h[0], points[2 * k + 1] * params.scale_im, h[1]], rotation);
    };

    const data = new Float32Array(2 * (n + 2) * TUBE_INSTANCE_FLOATS);
    let count = 0;
    const push = (a: number[], b: number[], radius: number, color: number[]) => {
        data.set([a[0], a[1], a[2], radius, b[0], b[1], b[2], 0, color[0], color[1], color[2], 1], count * TUBE_INSTANCE_FLOATS);
        count++;
    };
    for (let k = 0; k + 1 < outline.length; k++) push(base(outline[k]), base(outline[k + 1]), BASE_PX * wpp, BASE_COLOR);
    if (lift) {
        const last = closed ? n : n - 1;
        for (let k = 0; k < last; k++) {
            const a = lifted(k), b = lifted((k + 1) % n);
            if (a && b) push(a, b, LIFT_PX * wpp, LIFT_COLOR);
        }
    }

    const uniforms = new Float32Array(32);
    uniforms.set(frame.mvp as Float32Array, 0);
    uniforms.set(frame.modelView as Float32Array, 16);
    device.queue.writeBuffer(res.tubes.uniformBuffer, 0, uniforms);
    device.queue.writeBuffer(res.instanceBuffer, 0, data, 0, count * TUBE_INSTANCE_FLOATS);

    pass.setPipeline(res.tubes.pipeline);
    pass.setBindGroup(0, res.tubes.bindGroup);
    pass.setVertexBuffer(0, res.tubes.cylinderMesh);
    pass.setVertexBuffer(1, res.instanceBuffer);
    pass.draw(res.tubes.cylinderMeshVertices, count);
}
