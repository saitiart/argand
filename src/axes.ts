// =============================================================================
//  Axes: arrows, tick labels and bounding box
//
//  - Axis shafts and box edges are instanced cylinders, arrowheads are cones
//    (shaders/axes.wgsl). Thickness is given in screen pixels.
//  - The 4D rotation of the axes is done here on the CPU (rotate4D mirrors the
//    rotation code in shaders/complex4d.wgsl), so arrows and labels always agree.
//  - Numbers and axis names are an HTML overlay positioned every frame.
//  - The bounding box is not 4D-rotated: it is the 3D box the scene lives in.
// =============================================================================

import { mat4, vec4 } from 'gl-matrix';
import { Params, Vec3Tuple } from './config.ts';
import { sceneLayout, AxisRange } from './scene.ts';
import wgslAxes from './shaders/axes.wgsl';

type Vec4 = [number, number, number, number];
type RGB = [number, number, number];


// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface Rotation4D {
    useQuaternion: boolean;
    xw: number;
    yw: number;
    zw: number;
    quatAngleLeft: number;
    quatAxisLeft: Vec3Tuple;
    quatAngleRight: number;
    quatAxisRight: Vec3Tuple;
}

export interface AxesFrame {
    mvp: mat4;
    modelView: mat4;
    projection: mat4;
    canvas: HTMLCanvasElement;
    params: Params;
    rotation: Rotation4D;
}

export interface AxesResources extends TubePipeline {
    cylinderInstances: GPUBuffer;
    coneInstances: GPUBuffer;
    labels: LabelLayer;
}


// -----------------------------------------------------------------------------
// Style
// -----------------------------------------------------------------------------

const AXIS_RADIUS_PX = 1.6;
const BOX_RADIUS_PX = 0.6;
const CONE_RADIUS_PX = 5.0;
const CONE_LENGTH_PX = 16.0;
const TICKS_PER_AXIS = 8;           // roughly, across the whole axis

const BOX_COLOR: RGB = [0.62, 0.62, 0.66];
const QUAT_LEFT_COLOR: RGB = [0.0, 0.62, 0.72];
const QUAT_RIGHT_COLOR: RGB = [0.85, 0.6, 0.0];

const AXES: { dir: Vec4; color: RGB; graphName: string; name: string }[] = [
    { dir: [1, 0, 0, 0], color: [0.85, 0.22, 0.22], graphName: 'Re z', name: 'x' },
    { dir: [0, 1, 0, 0], color: [0.20, 0.62, 0.28], graphName: 'Re f', name: 'y' },
    { dir: [0, 0, 1, 0], color: [0.22, 0.40, 0.88], graphName: 'Im z', name: 'z' },
    { dir: [0, 0, 0, 1], color: [0.58, 0.30, 0.78], graphName: 'Im f', name: 'w' },
];

const MESH_SEGMENTS = 20;
const MESH_FLOATS = 6;              // vec4 mesh + vec2 normal weights
const INSTANCE_FLOATS = 12;         // vec4 a + vec4 b + vec4 color
const MAX_CYLINDERS = 32;
const MAX_CONES = 8;


// -----------------------------------------------------------------------------
// 4D rotation (CPU mirror of apply_rotations / apply_rotations_quaternion)
// -----------------------------------------------------------------------------

function quatMul(a: Vec4, b: Vec4): Vec4 {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}

function unitQuat(axis: Vec3Tuple, angle: number): Vec4 {
    const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    const s = Math.sin(angle * 0.5) / len;
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle * 0.5)];
}

export function rotate4D(p: Vec4, r: Rotation4D): Vec4 {
    if (r.useQuaternion) {
        const left = unitQuat(r.quatAxisLeft, r.quatAngleLeft);
        const right = unitQuat(r.quatAxisRight, r.quatAngleRight);
        return quatMul(quatMul(left, p), right);
    }

    let [x, y, z, w] = p;
    let c = Math.cos(r.xw), s = Math.sin(r.xw);
    [x, w] = [c * x - s * w, s * x + c * w];
    c = Math.cos(r.yw); s = Math.sin(r.yw);
    [y, w] = [c * y - s * w, s * y + c * w];
    c = Math.cos(r.zw); s = Math.sin(r.zw);
    [z, w] = [c * z - s * w, s * z + c * w];
    return [x, y, z, w];
}

function scale4(v: Vec4, k: number): Vec4 {
    return [v[0] * k, v[1] * k, v[2] * k, v[3] * k];
}


function niceStep(raw: number): number {
    const exp = Math.floor(Math.log10(raw));
    const f = raw / Math.pow(10, exp);
    const nf = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
    return nf * Math.pow(10, exp);
}

// Rounds to 1, 2 or 5 × 10^k
function roundNice(x: number): number {
    if (x === 0) return 0;
    const exp = Math.floor(Math.log10(Math.abs(x)));
    const f = Math.abs(x) / Math.pow(10, exp);
    const nf = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
    return Math.sign(x) * nf * Math.pow(10, exp);
}

// Ticks on a nonlinear (soft cap / log) axis: spread evenly on screen, then each
// rounded to a nice value and placed where that value really lands.
function curvedTicks(r: AxisRange): { world: number; text: string }[] {
    const curve = r.curve!;
    const out: { world: number; text: string }[] = [];
    const seen = new Set<number>();
    const n = 2 * TICKS_PER_AXIS;       // denser candidates; overlapping labels are dropped later
    for (let k = 0; k <= n; k++) {
        const target = r.min + (k / n) * (r.max - r.min);
        const v = roundNice(curve.inverse(target) / r.unit);
        if (v === 0 || seen.has(v) || !Number.isFinite(v)) continue;
        const world = curve.forward(v * r.unit);
        if (world < r.min * 0.999 - 1e-9 || world > r.max * 0.999 + 1e-9) continue;
        seen.add(v);
        const pow = Math.pow(10, Math.floor(Math.log10(Math.abs(v))));
        out.push({ world, text: formatTick(v, pow) });
    }
    return out;
}

function formatTick(v: number, step: number): string {
    const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const text = v.toFixed(decimals);
    return text === '-0' ? '0' : text.replace('-', '−');
}


// -----------------------------------------------------------------------------
// Meshes
// -----------------------------------------------------------------------------

function createCylinderMesh(segments: number): Float32Array {
    const out: number[] = [];
    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        out.push(
            c0, s0, 0, 1, 1, 0,   c1, s1, 0, 1, 1, 0,   c1, s1, 1, 1, 1, 0,
            c0, s0, 0, 1, 1, 0,   c1, s1, 1, 1, 1, 0,   c0, s0, 1, 1, 1, 0,
        );
    }
    return new Float32Array(out);
}

function createConeMesh(segments: number): Float32Array {
    // Side normal of a cone with base radius R and length H is ∝ (H radial + R axial)
    const nl = Math.hypot(CONE_LENGTH_PX, CONE_RADIUS_PX);
    const nr = CONE_LENGTH_PX / nl;
    const na = CONE_RADIUS_PX / nl;

    const out: number[] = [];
    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const am = (a0 + a1) * 0.5;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        // side
        out.push(
            c0, s0, 0, 1, nr, na,
            c1, s1, 0, 1, nr, na,
            Math.cos(am), Math.sin(am), 1, 0, nr, na,
        );
        // base cap
        out.push(
            0, 0, 0, 0, 0, -1,
            c1, s1, 0, 1, 0, -1,
            c0, s0, 0, 1, 0, -1,
        );
    }
    return new Float32Array(out);
}


// -----------------------------------------------------------------------------
// Label overlay
// -----------------------------------------------------------------------------

class LabelLayer {
    private root: HTMLDivElement;
    private pool: HTMLSpanElement[] = [];
    private used = 0;
    private placed: { x: number; y: number; w: number; h: number }[] = [];

    constructor() {
        this.root = document.createElement('div');
        this.root.style.cssText =
            'position:fixed; inset:0; pointer-events:none; overflow:hidden; z-index:5;' +
            'font-family:system-ui, sans-serif; user-select:none;';
        document.body.appendChild(this.root);
    }

    begin() {
        this.used = 0;
        this.placed = [];
    }

    // Places a label unless it would overlap one placed earlier this frame.
    add(text: string, x: number, y: number, kind: 'tick' | 'name', color?: RGB) {
        const w = text.length * (kind === 'name' ? 8 : 6.5) + 4;
        const h = kind === 'name' ? 16 : 13;
        for (const p of this.placed) {
            if (x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y) return;
        }
        this.placed.push({ x, y, w, h });

        let el = this.pool[this.used];
        if (!el) {
            el = document.createElement('span');
            el.style.cssText =
                'position:absolute; left:0; top:0; white-space:nowrap; line-height:1;' +
                'text-shadow:0 0 3px #fff, 0 0 3px #fff, 0 0 2px #fff;';
            this.root.appendChild(el);
            this.pool.push(el);
        }
        this.used++;

        if (el.textContent !== text) el.textContent = text;
        el.style.display = '';
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        if (kind === 'name') {
            el.style.fontSize = '14px';
            el.style.fontWeight = '600';
            el.style.fontStyle = 'italic';
            el.style.color = color ? `rgb(${color.map(c => Math.round(c * 255)).join(',')})` : '#333';
        } else {
            el.style.fontSize = '11px';
            el.style.fontWeight = '400';
            el.style.fontStyle = 'normal';
            el.style.color = '#444';
        }
    }

    end() {
        for (let i = this.used; i < this.pool.length; i++) this.pool[i].style.display = 'none';
    }
}


// -----------------------------------------------------------------------------
// Pipeline
// -----------------------------------------------------------------------------

// Shaded tubes (instanced cylinders + cones, shaders/axes.wgsl). Shared by the
// axes and anything else drawn as tubes; each user gets its own uniform buffer.
export interface TubePipeline {
    pipeline: GPURenderPipeline;
    uniformBuffer: GPUBuffer;       // mvp + modelView
    bindGroup: GPUBindGroup;
    cylinderMesh: GPUBuffer;
    cylinderMeshVertices: number;
    coneMesh: GPUBuffer;
    coneMeshVertices: number;
}

// Per instance: vec4 (start.xyz, radius), vec4 (end.xyz, 0), vec4 color
export const TUBE_INSTANCE_FLOATS = INSTANCE_FLOATS;

export async function createTubePipeline(
    device: GPUDevice,
    canvasFormat: GPUTextureFormat,
    msaaCount: number,
): Promise<TubePipeline> {
    const shaderModule = device.createShaderModule({ code: wgslAxes });

    const pipeline = await device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: {
            module: shaderModule,
            entryPoint: 'vs_main',
            buffers: [
                {
                    arrayStride: MESH_FLOATS * 4,
                    stepMode: 'vertex',
                    attributes: [
                        { shaderLocation: 0, offset: 0,  format: 'float32x4' },
                        { shaderLocation: 1, offset: 16, format: 'float32x2' },
                    ],
                },
                {
                    arrayStride: INSTANCE_FLOATS * 4,
                    stepMode: 'instance',
                    attributes: [
                        { shaderLocation: 2, offset: 0,  format: 'float32x4' },
                        { shaderLocation: 3, offset: 16, format: 'float32x4' },
                        { shaderLocation: 4, offset: 32, format: 'float32x4' },
                    ],
                },
            ],
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'fs_main',
            targets: [{ format: canvasFormat }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less',
        },
        multisample: { count: msaaCount },
    });

    const makeMesh = (data: Float32Array) => {
        const buffer = device.createBuffer({
            size: data.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(buffer, 0, data);
        return buffer;
    };
    const cylinderData = createCylinderMesh(MESH_SEGMENTS);
    const coneData = createConeMesh(MESH_SEGMENTS);

    const uniformBuffer = device.createBuffer({
        size: 2 * 64, // mvp + modelView
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    return {
        pipeline,
        uniformBuffer,
        bindGroup,
        cylinderMesh: makeMesh(cylinderData),
        cylinderMeshVertices: cylinderData.length / MESH_FLOATS,
        coneMesh: makeMesh(coneData),
        coneMeshVertices: coneData.length / MESH_FLOATS,
    };
}

// World size of one screen pixel at the origin (for thickness given in pixels)
export function worldPerPixel(modelView: mat4, projection: mat4, canvas: HTMLCanvasElement): number {
    const distance = Math.hypot(modelView[12], modelView[13], modelView[14]);
    return (2 * distance) / (projection[5] * Math.max(canvas.clientHeight, 1));
}

export async function createAxes(
    device: GPUDevice,
    canvasFormat: GPUTextureFormat,
    msaaCount: number,
): Promise<AxesResources> {
    const tubes = await createTubePipeline(device, canvasFormat, msaaCount);

    const makeInstances = (count: number) => device.createBuffer({
        size: count * INSTANCE_FLOATS * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    return {
        ...tubes,
        cylinderInstances: makeInstances(MAX_CYLINDERS),
        coneInstances: makeInstances(MAX_CONES),
        labels: new LabelLayer(),
    };
}


// -----------------------------------------------------------------------------
// Per frame: build segments + labels, record draws into the open render pass
// -----------------------------------------------------------------------------

export function drawAxes(
    device: GPUDevice,
    pass: GPURenderPassEncoder,
    res: AxesResources,
    frame: AxesFrame,
) {
    const { params, rotation, canvas } = frame;
    const labels = res.labels;
    labels.begin();

    if (!params.showAxes && !params.showBoundingBox) {
        labels.end();
        return;
    }

    // World size of one pixel at the origin, so thickness is constant on screen
    const worldPerPx = worldPerPixel(frame.modelView, frame.projection, canvas);

    // Screen projection for labels
    const rect = canvas.getBoundingClientRect();
    const clip = vec4.create();
    const toScreen = (p: Vec4): [number, number] | null => {
        vec4.transformMat4(clip, [p[0], p[1], p[2], 1], frame.mvp);
        if (clip[3] <= 1e-6) return null;
        const nx = clip[0] / clip[3];
        const ny = clip[1] / clip[3];
        if (Math.abs(nx) > 1.05 || Math.abs(ny) > 1.05) return null;
        return [rect.left + (nx * 0.5 + 0.5) * rect.width, rect.top + (0.5 - ny * 0.5) * rect.height];
    };

    const cylinders: number[] = [];
    const cones: number[] = [];
    const pushSegment = (list: number[], a: Vec4, b: Vec4, radius: number, color: RGB) => {
        list.push(a[0], a[1], a[2], radius, b[0], b[1], b[2], 0, color[0], color[1], color[2], 1);
    };

    const { ranges, graph } = sceneLayout(params);
    const tickLabels: { text: string; x: number; y: number }[] = [];

    // --- Coordinate axes (4D-rotated with the surface) ---
    if (params.showAxes) {
        AXES.forEach((axis, i) => {
            const r = ranges[i];
            const tip = r.max + CONE_LENGTH_PX * worldPerPx;
            const start = rotate4D(scale4(axis.dir, r.min), rotation);
            const end = rotate4D(scale4(axis.dir, r.max), rotation);
            const head = rotate4D(scale4(axis.dir, tip), rotation);

            pushSegment(cylinders, start, end, AXIS_RADIUS_PX * worldPerPx, axis.color);
            pushSegment(cones, end, head, CONE_RADIUS_PX * worldPerPx, axis.color);

            const nameAt = toScreen(head);
            // In derivative views the output axes show f′ or ∂f/∂z̄
            const fName = ['f', 'f′', '∂f/∂z̄'][Number(params.calc_view)] ?? 'f';
            const label = graph ? axis.graphName.replace(/f$/, fName) : axis.name;
            if (nameAt) labels.add(label, nameAt[0] + 6, nameAt[1] - 18, 'name', axis.color);

            // Ticks in labelled units
            if (Math.abs(r.unit) < 1e-9) return;
            if (r.curve) {
                for (const t of curvedTicks(r)) {
                    const at = toScreen(rotate4D(scale4(axis.dir, t.world), rotation));
                    if (at) tickLabels.push({ text: t.text, x: at[0] + 5, y: at[1] + 4 });
                }
                return;
            }
            const lo = Math.min(r.min / r.unit, r.max / r.unit);
            const hi = Math.max(r.min / r.unit, r.max / r.unit);
            const step = niceStep((hi - lo) / TICKS_PER_AXIS);
            for (let k = Math.ceil(lo / step); k * step <= hi + step * 1e-6; k++) {
                const v = k * step;
                if (Math.abs(v) < step * 1e-6) continue;
                const at = toScreen(rotate4D(scale4(axis.dir, v * r.unit), rotation));
                if (at) tickLabels.push({ text: formatTick(v, step), x: at[0] + 5, y: at[1] + 4 });
            }
        });

        // --- Quaternion rotation axes ---
        if (rotation.useQuaternion) {
            const L = 0.8 * Math.max(...ranges.slice(0, 3).map(r => Math.max(Math.abs(r.min), Math.abs(r.max))));
            const quatAxes: [Vec3Tuple, RGB, string][] = [
                [params.quat_axis_left, QUAT_LEFT_COLOR, 'L'],
                [params.quat_axis_right, QUAT_RIGHT_COLOR, 'R'],
            ];
            for (const [axis, color, name] of quatAxes) {
                const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
                const dir: Vec4 = [axis[0] / len, axis[1] / len, axis[2] / len, 0];
                const start = rotate4D(scale4(dir, -L), rotation);
                const end = rotate4D(scale4(dir, L), rotation);
                const head = rotate4D(scale4(dir, L + CONE_LENGTH_PX * worldPerPx), rotation);
                pushSegment(cylinders, start, end, AXIS_RADIUS_PX * worldPerPx, color);
                pushSegment(cones, end, head, CONE_RADIUS_PX * worldPerPx, color);
                const at = toScreen(head);
                if (at) labels.add(name, at[0] + 6, at[1] - 18, 'name', color);
            }
        }
    }

    // --- Bounding box (3D, not 4D-rotated) ---
    if (params.showBoundingBox) {
        const [rx, ry, rz] = ranges;
        const xs = [rx.min, rx.max], ys = [ry.min, ry.max], zs = [rz.min, rz.max];
        const corner = (i: number, j: number, k: number): Vec4 => [xs[i], ys[j], zs[k], 0];
        const radius = BOX_RADIUS_PX * worldPerPx;
        for (let a = 0; a < 2; a++) {
            for (let b = 0; b < 2; b++) {
                pushSegment(cylinders, corner(0, a, b), corner(1, a, b), radius, BOX_COLOR);
                pushSegment(cylinders, corner(a, 0, b), corner(a, 1, b), radius, BOX_COLOR);
                pushSegment(cylinders, corner(a, b, 0), corner(a, b, 1), radius, BOX_COLOR);
            }
        }
    }

    // Axis names were placed first, so numbers give way to them
    for (const t of tickLabels) labels.add(t.text, t.x, t.y, 'tick');
    labels.end();

    // --- GPU ---
    const uniforms = new Float32Array(32);
    uniforms.set(frame.mvp as Float32Array, 0);
    uniforms.set(frame.modelView as Float32Array, 16);
    device.queue.writeBuffer(res.uniformBuffer, 0, uniforms);

    const nCylinders = Math.min(cylinders.length / INSTANCE_FLOATS, MAX_CYLINDERS);
    const nCones = Math.min(cones.length / INSTANCE_FLOATS, MAX_CONES);
    if (nCylinders > 0) {
        device.queue.writeBuffer(res.cylinderInstances, 0, new Float32Array(cylinders.slice(0, nCylinders * INSTANCE_FLOATS)));
    }
    if (nCones > 0) {
        device.queue.writeBuffer(res.coneInstances, 0, new Float32Array(cones.slice(0, nCones * INSTANCE_FLOATS)));
    }

    pass.setPipeline(res.pipeline);
    pass.setBindGroup(0, res.bindGroup);
    if (nCylinders > 0) {
        pass.setVertexBuffer(0, res.cylinderMesh);
        pass.setVertexBuffer(1, res.cylinderInstances);
        pass.draw(res.cylinderMeshVertices, nCylinders);
    }
    if (nCones > 0) {
        pass.setVertexBuffer(0, res.coneMesh);
        pass.setVertexBuffer(1, res.coneInstances);
        pass.draw(res.coneMeshVertices, nCones);
    }
}
