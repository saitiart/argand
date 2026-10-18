// =============================================================================
//  Sidebar: all controls of the visualizer (replaces dat.gui)
//
//  Sections: Function · Domain · Output · 4D Rotation · Projection · Display ·
//  Performance. The panel collapses with the ‹ button or the H key; section
//  and panel state are remembered between visits.
// =============================================================================

import { Params, INITIAL_PARAMS, GUI_RANGES, Topology } from '../config.ts';
import { FUNCTIONS, CUSTOM_FUNCTION_INDEX, hasFormula } from '../functions.ts';
import { ContourResult, MapData, CONTOUR_SHAPES } from '../calculus.ts';
import { contourMap } from './contour-map.ts';
import { curvePlot } from './plot.ts';
import { Quat, IDENTITY, quatFromAxisAngle, quatToAxisAngle } from '../quat.ts';
import { Ui, el, section, group, slider, toggle, segmented, select, button, hint, readout, loadSetting, saveSetting } from './components.ts';
import { createExpressionPanel } from './expression-panel.ts';
import { trackball } from './trackball.ts';
import { attachFourDDrag } from './four-d-drag.ts';

export interface GuiController {
    params: Params;
    resolutionChanged: boolean;
    topologyChanged: boolean;
    // Waiting to be uploaded by the main loop (null = nothing new):
    pendingProgram: ArrayBuffer | null;            // bytecode of the typed formula
    pendingParameterValues: Float32Array | null;   // values of its parameters (sliders)
    formulaUsesTime: boolean;                      // the typed formula contains t
    updatePerformance(info: { fps: number; vertices: number; vram: string }): void;
    // CSS pixels the panel covers on the left (0 when hidden), so the view can stay centred
    coveredWidth(): number;
    // Results of the contour integral (calculus.ts)
    updateContour(result: ContourResult, map: MapData): void;
}

// Complex number as text; tiny parts relative to the other are shown as 0
function formatComplex(re: number, im: number): string {
    if (!Number.isFinite(re) || !Number.isFinite(im)) return 'undefined';
    const tol = 1e-6 * Math.max(1, Math.abs(re), Math.abs(im));
    const r = Math.abs(re) < tol ? 0 : re;
    const i = Math.abs(im) < tol ? 0 : im;
    const f = (x: number) => Number(x.toPrecision(5)).toString().replace('-', '−');
    if (i === 0) return f(r);
    if (r === 0) return `${f(i)}i`;
    return `${f(r)} ${i < 0 ? '−' : '+'} ${f(Math.abs(i))}i`;
}

// Fresh copy (arrays included, so editing params never touches the defaults)
function initialParams(): Params {
    return {
        ...INITIAL_PARAMS,
        quat_axis_left: [...INITIAL_PARAMS.quat_axis_left],
        quat_axis_right: [...INITIAL_PARAMS.quat_axis_right],
        contour_polygon: INITIAL_PARAMS.contour_polygon.map(p => [...p] as [number, number]),
        contour_path: INITIAL_PARAMS.contour_path.map(p => [...p] as [number, number]),
    };
}

type Projection = 'graph' | 'riemann' | 'fiber';

export function createGuiController(canvas: HTMLCanvasElement): GuiController {
    const params = initialParams();
    const ui = new Ui();
    const cfg = GUI_RANGES;

    const controller: GuiController = {
        params,
        resolutionChanged: false,
        topologyChanged: false,
        pendingProgram: null,
        pendingParameterValues: null,
        formulaUsesTime: false,
        updatePerformance: () => {},
        coveredWidth: () => (panel.classList.contains('collapsed') ? 0 : panel.offsetWidth),
        updateContour: () => {},
    };

    // ---------------------------------------------------------------- shell
    const panel = el('aside', 'ui-panel', document.body);
    const header = el('div', 'ui-header', panel);
    const title = el('div', 'ui-title', header, 'Complex 4D');
    el('small', undefined, title, 'visualizer');
    const hideBtn = el('button', 'ui-icon-btn', header, '‹');
    hideBtn.title = 'Hide panel (H)';
    const reopen = el('button', 'ui-icon-btn ui-reopen', document.body, '☰');
    reopen.title = 'Show panel (H)';
    const scroll = el('div', 'ui-scroll', panel);
    const footer = el('div', 'ui-footer', panel);

    const setCollapsed = (collapsed: boolean) => {
        panel.classList.toggle('collapsed', collapsed);
        reopen.classList.toggle('visible', collapsed);
        saveSetting('cx4d.collapsed', collapsed ? '1' : '0');
    };
    setCollapsed(loadSetting('cx4d.collapsed') === '1');
    hideBtn.addEventListener('click', () => setCollapsed(true));
    reopen.addEventListener('click', () => setCollapsed(false));
    window.addEventListener('keydown', e => {
        const t = e.target as HTMLElement;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
        if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            setCollapsed(!panel.classList.contains('collapsed'));
        }
    });

    // ------------------------------------------------------------- function
    const fn = section(scroll, 'function', 'Function', true);

    const applyPreset = (index: number) => {
        params.funcSelection = index;
        if (index === CUSTOM_FUNCTION_INDEX) return;      // Custom keeps what was typed
        expression.setText(FUNCTIONS[index]?.expr ?? '');
        const d = FUNCTIONS[index]?.domain;
        if (d) {
            params.domain_size_x = (d.x[1] - d.x[0]) / 2;
            params.domain_size_z = (d.z[1] - d.z[0]) / 2;
            params.shift_x = (d.x[0] + d.x[1]) / 2;
            params.shift_z = (d.z[0] + d.z[1]) / 2;
        }
    };

    select(ui, fn, null,
        FUNCTIONS.map((f, i) => ({ label: f.name, value: i })),
        () => params.funcSelection,
        v => { applyPreset(v); ui.refresh(); });

    // Typing a valid formula switches to Custom
    const expression = createExpressionPanel(fn, FUNCTIONS[params.funcSelection]?.expr ?? 'z', {
        onProgram: (program, typed, usesTime) => {
            controller.pendingProgram = program;
            controller.formulaUsesTime = usesTime;
            if (typed && params.funcSelection !== CUSTOM_FUNCTION_INDEX) {
                params.funcSelection = CUSTOM_FUNCTION_INDEX;
                ui.refresh();
            }
        },
        onParameters: values => { controller.pendingParameterValues = values; },
    });

    // --------------------------------------------------------------- domain
    const dom = section(scroll, 'domain', 'Domain', true);
    slider(ui, dom, { label: 'Center Re', ...cfg.shift, step: 0.01, get: () => params.shift_x, set: v => { params.shift_x = v; } });
    slider(ui, dom, { label: 'Center Im', ...cfg.shift, step: 0.01, get: () => params.shift_z, set: v => { params.shift_z = v; } });
    slider(ui, dom, { label: 'Size Re', ...cfg.domainSize, step: 0.01, log: true, get: () => params.domain_size_x, set: v => { params.domain_size_x = v; } });
    slider(ui, dom, { label: 'Size Im', ...cfg.domainSize, step: 0.01, log: true, get: () => params.domain_size_z, set: v => { params.domain_size_z = v; } });
    slider(ui, dom, { label: 'Stretch Re', ...cfg.inputScale, step: 0.01, get: () => params.scale_re, set: v => { params.scale_re = v; } });
    slider(ui, dom, { label: 'Stretch Im', ...cfg.inputScale, step: 0.01, get: () => params.scale_im, set: v => { params.scale_im = v; } });

    // --------------------------------------------------------------- output
    const out = section(scroll, 'output', 'Output', true);
    segmented(ui, out, 'Height', [
        { label: 'Linear', value: 0, title: 'True heights, clipped by the box' },
        { label: 'Soft cap', value: 1, title: 'R·tanh(|f|/R): everything fits in the box' },
        { label: 'Log', value: 2, title: 'R·ln(1 + |f|/R)' },
    ], () => Number(params.height_mode), v => { params.height_mode = v; });
    slider(ui, out, { label: 'Box height', ...cfg.boxHeight, step: 0.01, log: true, get: () => params.box_height, set: v => { params.box_height = v; } });
    slider(ui, out, { label: 'Amp Re', ...cfg.outputAmp, step: 0.01, get: () => params.amp_re, set: v => { params.amp_re = v; } });
    slider(ui, out, { label: 'Amp Im', ...cfg.outputAmp, step: 0.01, get: () => params.amp_im, set: v => { params.amp_im = v; } });

    // ---------------------------------------------------------- 4D rotation
    const rot = section(scroll, 'rotation', '4D Rotation', true);
    segmented(ui, rot, null, [
        { label: 'Planes', value: 0, title: 'Angles in the X–W, Y–W and Z–W planes' },
        { label: 'Quaternion', value: 1, title: 'p → qL · p · qR (left and right rotation)' },
    ], () => (params.use_quaternion_rotation >= 0.5 ? 1 : 0), v => { params.use_quaternion_rotation = v; });

    const planes = group(rot);
    for (const [label, key] of [['X–W', 'rot_xw'], ['Y–W', 'rot_yw'], ['Z–W', 'rot_zw']] as const) {
        slider(ui, planes, { label, min: -Math.PI, max: Math.PI, step: 0.01, get: () => params[key], set: v => { params[key] = v; } });
    }

    // Quaternion pair <-> params (axis + angle per side)
    const quats = {
        get: () => ({
            left: quatFromAxisAngle(params.quat_axis_left, params.quat_angle_left),
            right: quatFromAxisAngle(params.quat_axis_right, params.quat_angle_right),
        }),
        set: (left: Quat, right: Quat) => {
            const l = quatToAxisAngle(left);
            const r = quatToAxisAngle(right);
            params.quat_axis_left = l.axis;
            params.quat_angle_left = l.angle;
            params.quat_axis_right = r.axis;
            params.quat_angle_right = r.angle;
        },
    };

    const quaternion = group(rot);
    const pads = el('div', 'ui-pads', quaternion);
    trackball(ui, pads, {
        title: 'Left', color: '#0aa0b8',
        get: () => quats.get().left,
        set: q => quats.set(q, quats.get().right),
    });
    trackball(ui, pads, {
        title: 'Right', color: '#d99a00',
        get: () => quats.get().right,
        set: q => quats.set(quats.get().left, q),
    });
    hint(quaternion, 'Drag a globe to turn it, double-click to reset it. Equal globes give a simple rotation in one plane.');

    // Presets: qL = qR = e^{θ/2·e} is a simple rotation by θ in the e–W plane
    const presets = el('div', 'ui-btn-row', quaternion);
    const simple = (axis: [number, number, number]) => () => {
        const q = quatFromAxisAngle(axis, Math.PI / 2);
        quats.set(q, q);
        ui.refresh();
    };
    button(presets, 'Reset', () => { quats.set([...IDENTITY], [...IDENTITY]); ui.refresh(); });
    button(presets, 'X–W 90°', simple([1, 0, 0]), 'Swap Re z with Im f');
    button(presets, 'Y–W 90°', simple([0, 1, 0]), 'Show Im f as the height');
    button(presets, 'Z–W 90°', simple([0, 0, 1]), 'Swap Im z with Im f');

    ui.track(() => {
        const q = params.use_quaternion_rotation >= 0.5;
        planes.classList.toggle('hidden', q);
        quaternion.classList.toggle('hidden', !q);
    });

    slider(ui, rot, { label: 'Auto spin', ...cfg.rotateSpeed, get: () => params.rotateSpeed, set: v => { params.rotateSpeed = v; } });
    hint(rot, '<span class="ui-kbd">Shift</span> + drag the view to rotate through the 4th dimension.');

    attachFourDDrag(canvas, params, quats, () => ui.refresh());

    // ----------------------------------------------------------- projection
    const proj = section(scroll, 'projection', 'Projection', true);
    segmented<Projection>(ui, proj, null, [
        { label: 'Graph', value: 'graph', title: '(Re z, Re f, Im z, Im f)' },
        { label: 'Riemann', value: 'riemann', title: 'Domain on the Riemann sphere, coloured by f (∞ at the top)' },
        { label: 'S²×S²', value: 'fiber', title: 'Fiber bundle of domain and codomain spheres' },
    ], () => params.show_fibration > 0.5 ? 'fiber'
        : params.use_riemann_sphere >= 0.5 ? 'riemann' : 'graph',
    v => {
        params.use_riemann_sphere = v === 'riemann' ? 1 : 0;
        params.show_fibration = v === 'fiber' ? 1 : 0;
    });
    const sphere = group(proj);
    segmented(ui, sphere, 'Sphere', [
        { label: 'Flat', value: 0, title: 'Plain sphere: domain colouring only' },
        { label: '|f| relief', value: 1, title: 'Radius from log|f|: zeros are dents, poles are spikes' },
        { label: '4D graph', value: 2, title: 'Radius from Re f, 4th axis Im f: use the 4D rotation' },
    ], () => Number(params.sphere_mode), v => { params.sphere_mode = v; });
    hint(sphere, 'The z-plane wrapped onto a sphere: 0 at the bottom, ∞ at the top, |z| = domain size on the equator.');
    ui.track(() => sphere.classList.toggle('hidden', !(params.use_riemann_sphere >= 0.5 && params.show_fibration < 0.5)));

    // ------------------------------------------------------------- calculus
    const calc = section(scroll, 'calculus', 'Calculus', true);
    const derivs = group(calc);
    segmented(ui, derivs, 'Surface shows', [
        { label: 'f', value: 0, title: 'The function itself' },
        { label: 'f′', value: 1, title: '∂f/∂z — the complex derivative where f is holomorphic' },
        { label: '∂f/∂z̄', value: 2, title: 'Zero exactly where f is holomorphic (Cauchy–Riemann)' },
    ], () => Number(params.calc_view), v => { params.calc_view = v; });
    toggle(ui, derivs, 'Mark non-holomorphic', () => params.markNonHolomorphic, v => { params.markNonHolomorphic = v; });
    const derivHint = hint(calc, '');
    ui.track(() => {
        const ok = hasFormula(params.funcSelection);
        derivs.style.opacity = ok ? '' : '0.45';
        derivs.style.pointerEvents = ok ? '' : 'none';
        derivHint.textContent = ok
            ? 'Exact derivatives of the formula. Stripes mark where ∂f/∂z̄ ≠ 0, i.e. where the Cauchy–Riemann equations fail (try conj(z), abs(z), re(z)).'
            : 'Derivatives need a formula — this preset has none.';
    });

    toggle(ui, calc, 'Contour integral ∮', () => params.showContour, v => { params.showContour = v; });
    const contour = group(calc);
    segmented(ui, contour, 'Contour', [
        { label: 'Circle', value: CONTOUR_SHAPES.circle, title: 'Circle with centre and radius' },
        { label: 'Polygon', value: CONTOUR_SHAPES.polygon, title: 'Closed polygon: click the map to add corners' },
        { label: 'Path', value: CONTOUR_SHAPES.path, title: 'Open path: compare ∫ along different paths' },
    ], () => Number(params.contourShape), v => { params.contourShape = v; });

    const circleControls = group(contour);
    slider(ui, circleControls, { label: 'Center Re', ...cfg.shift, step: 0.01, get: () => params.contour_cx, set: v => { params.contour_cx = v; } });
    slider(ui, circleControls, { label: 'Center Im', ...cfg.shift, step: 0.01, get: () => params.contour_cy, set: v => { params.contour_cy = v; } });
    slider(ui, circleControls, { label: 'Radius', ...cfg.contourRadius, log: true, get: () => params.contour_r, set: v => { params.contour_r = v; } });

    const map = contourMap(ui, contour, params, () => ui.refresh());
    const mapHint = hint(contour, '');
    const shapeButtons = el('div', 'ui-btn-row', contour);
    button(shapeButtons, 'Reset shape', () => {
        const fresh = initialParams();
        if (Number(params.contourShape) === CONTOUR_SHAPES.path) params.contour_path = fresh.contour_path;
        else params.contour_polygon = fresh.contour_polygon;
        ui.refresh();
    });
    button(shapeButtons, 'Reverse direction', () => {
        if (Number(params.contourShape) === CONTOUR_SHAPES.path) params.contour_path.reverse();
        else params.contour_polygon.reverse();
        ui.refresh();
    });

    const showIntegral = readout(contour, '∮ f dz');
    const integralLabel = showIntegral.label;
    const showResidues = readout(contour, 'Σ Res = ∮/2πi');
    const showWinding = readout(contour, 'Zeros − poles');
    const plots = el('div', 'ui-pads', contour);
    const imagePlot = curvePlot(plots, 'f(γ) about 0');
    const runningPlot = curvePlot(plots, '∫ f dz along γ');
    const resultHint = hint(contour, '');

    ui.track(() => {
        const s = Number(params.contourShape);
        contour.classList.toggle('hidden', !params.showContour);
        circleControls.classList.toggle('hidden', s !== CONTOUR_SHAPES.circle);
        shapeButtons.style.display = s === CONTOUR_SHAPES.circle ? 'none' : '';
        integralLabel.textContent = s === CONTOUR_SHAPES.path ? '∫ f dz' : '∮ f dz';
        mapHint.innerHTML = s === CONTOUR_SHAPES.circle
            ? 'Map: drag inside the circle to move it; drag the white handle, the rim or anywhere outside to resize. The map zooms out to fit when you let go.'
            : 'Map: drag a corner to move it, click empty space to add one, double-click a corner to remove it. Orange = start. The map zooms out to fit when you let go.';
        resultHint.textContent = s === CONTOUR_SHAPES.path
            ? 'For holomorphic f the integral depends only on the end points — move the middle corners and it stays the same, unless the path crosses a pole.'
            : 'The winding of f(γ) about 0 counts zeros − poles inside (argument principle). Counter-clockwise is positive.';
    });

    controller.updateContour = (r, mapData) => {
        showIntegral(formatComplex(r.integral[0], r.integral[1]));
        showResidues(!r.closed ? '— (open path)' : r.defined ? formatComplex(r.residueSum[0], r.residueSum[1]) : 'pole on γ');
        showWinding(!r.closed ? '—' : r.winding === null ? '—' : String(r.winding));
        imagePlot.draw(r.image, { closed: r.closed });
        runningPlot.draw(r.running, { color: '#4f5bd5' });
        map.setBackground(mapData);
    };

    // -------------------------------------------------------------- display
    const disp = section(scroll, 'display', 'Display', false);
    toggle(ui, disp, 'Surface', () => params.showSurface, v => { params.showSurface = v; });
    toggle(ui, disp, 'Axes', () => params.showAxes, v => { params.showAxes = v; });
    toggle(ui, disp, 'Bounding box', () => params.showBoundingBox, v => { params.showBoundingBox = v; });
    toggle(ui, disp, 'Clip to box', () => params.clipToBox, v => { params.clipToBox = v; });
    slider(ui, disp, { label: 'Pole holes', ...cfg.poleRadius, get: () => params.pole_radius, set: v => { params.pole_radius = v; } });
    slider(ui, disp, { label: 'Animate t', ...cfg.animateSpeed, get: () => params.animateSpeed, set: v => { params.animateSpeed = v; } });
    segmented<Topology>(ui, disp, 'Mesh', [
        { label: 'Surface', value: 'triangle-list' },
        { label: 'Lines', value: 'line-list' },
        { label: 'Points', value: 'point-list' },
    ], () => params.topology, v => { params.topology = v; controller.topologyChanged = true; });

    // ---------------------------------------------------------- performance
    const perf = section(scroll, 'performance', 'Performance', false);
    slider(ui, perf, {
        label: 'Resolution', ...cfg.resolution, commitOnly: true, digits: 0,
        get: () => params.resolution,
        set: v => { params.resolution = Math.max(16, Math.round(v / 8) * 8); controller.resolutionChanged = true; ui.refresh(); },
    });
    const showFps = readout(perf, 'FPS');
    const showVertices = readout(perf, 'Vertices');
    const showVram = readout(perf, 'Est. VRAM');
    controller.updatePerformance = ({ fps, vertices, vram }) => {
        showFps(String(fps));
        showVertices(vertices.toLocaleString());
        showVram(vram);
    };

    // --------------------------------------------------------------- footer
    button(footer, '⟲ Reset all', () => {
        Object.assign(params, initialParams());
        expression.setText(FUNCTIONS[params.funcSelection]?.expr ?? '');
        controller.resolutionChanged = true;
        controller.topologyChanged = true;
        ui.refresh();
    });
    hint(footer, '<span class="ui-kbd">H</span> hides the panel');

    ui.refresh();
    return controller;
}
