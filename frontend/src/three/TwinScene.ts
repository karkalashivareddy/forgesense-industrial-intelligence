/**
 * Factory digital twin — Three.js scene.
 *
 * Performance contract (this is the most expensive view in the product):
 *
 *  - ONE render loop, owned by this class, started on mount and stopped on
 *    dispose. Never more than one.
 *  - ON-DEMAND RENDERING. The scene only draws when something changed: a
 *    camera move, a machine status change, a selection, or a short "settle"
 *    window after any of those. Standing still costs zero GPU.
 *  - The loop self-suspends when the document is hidden and when the user has
 *    `prefers-reduced-motion` set (transitions snap instead of easing).
 *  - Every geometry, material and texture is tracked and disposed. Shared
 *    assets are disposed exactly once, on teardown.
 *  - Machine meshes are reused across status updates; only material colour
 *    changes, so no scene reconstruction happens while the fleet is live.
 */

import * as THREE from 'three';
import type { Machine } from '../api/types';
import type { OperationalState, StateTone } from '../domain/machineState';
import { deriveOperationalState } from '../domain/machineState';
import type { DependencyEdge, Zone } from '../api/types';

export interface TwinCallbacks {
  onSelect(machineId: string, additive: boolean): void;
  onHover(machineId: string | null): void;
}

export interface TwinOptions {
  containers: HTMLElement;
  callbacks: TwinCallbacks;
  reducedMotion: boolean;
}

/*
 * Twin palette.
 *
 * Values are resolved from the same CSS custom properties as the DOM, so the
 * 3D scene and the interface can never drift apart. Three.js needs concrete
 * numeric colours for materials, which is exactly why this is the one place
 * that reads tokens at runtime rather than hard-coding hex.
 *
 * The environment is deliberately graphite and steel. Cyan is reserved for
 * SELECTION so that "cyan" always means "this is the thing you picked", never
 * "the whole factory is glowing".
 */

function hex(tokenName: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim();
  if (!value.startsWith('#')) return fallback;
  const body = value.length === 4
    ? value
        .slice(1)
        .split('')
        .map((char) => char + char)
        .join('')
    : value.slice(1);
  const parsed = Number.parseInt(body, 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const PALETTE = {
  floor: hex('--color-bg-app', 0x0a0d11),
  slab: hex('--color-bg-panel', 0x10141a),
  grid: hex('--color-border-subtle', 0x1c222a),
  gridMajor: hex('--color-border-default', 0x273040),
  body: hex('--color-border-strong', 0x3a4658),
  bodyDark: hex('--color-border-default', 0x273040),
  accent: hex('--color-accent-muted', 0x0e7f96),
  plate: hex('--color-bg-inset', 0x070a0e),
  steel: hex('--color-border-strong', 0x3a4658),
  edge: hex('--color-border-default', 0x273040),
} as const;

const STATE_COLOURS: Record<StateTone, number> = {
  ok: hex('--color-success', 0x34c07d),
  warn: hex('--color-warning', 0xe8a93f),
  crit: hex('--color-critical', 0xef4d55),
  maint: hex('--color-maintenance', 0x6f8ff0),
  idle: hex('--color-unavailable', 0x5a6674),
  info: hex('--color-info', 0x4a9fe0),
};

/** Selection is cyan and nothing else is. */
const SELECT_COLOUR = hex('--color-accent', 0x22d3ee);

/** A `#rrggbb` string from a token, for the 2D canvas label textures. */
function cssColour(tokenName: string, fallback: number): string {
  return '#' + hex(tokenName, fallback).toString(16).padStart(6, '0');
}

/** Predicted-risk overlay is violet, matching the Predictions workspace. */
const PREDICTION_COLOUR = hex('--color-intelligence', 0x9d7bf0);

const RELATION_COLOURS: Record<string, number> = {
  MATERIAL: hex('--color-accent', 0x22d3ee),
  POWER: hex('--color-info', 0x4a9fe0),
  COOLING: hex('--color-maintenance', 0x6f8ff0),
  SERVICE: 0x7c8b9c,
};

/** Physical row order follows material flow through the plant. */
const ZONE_ORDER = [
  'MACHINING',
  'MATERIAL_HANDLING',
  'ASSEMBLY',
  'INSPECTION',
  'PACKAGING',
  'UTILITIES',
];

const ROW_PITCH = 7.0;
const ROW_OFFSET = 3.2;
const MACHINE_SPACING = 4.8;
const ZONE_DEPTH = 5.8;
const MACHINE_HEIGHT = 3.0;

/** How long the loop keeps drawing after the last change ("settle window"). */
const SETTLE_MS = 700;

interface MachineNode {
  group: THREE.Group;
  indicator: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  halo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  statusRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Sprite;
  position: THREE.Vector3;
  tone: StateTone;
  signature: string;
  /**
   * Everything that affects how this node is DRAWN, as one comparable string.
   *
   * Render requests are gated on this rather than on comparing material
   * values: Three.js applies colour-space conversion on set and returns
   * converted values from getHex(), so a value comparison reports "changed"
   * on every call and defeats the gate entirely. The last applied key is
   * stored instead, which is exact and allocation-cheap.
   */
  visualKey: string;
  /** Selection/hover state of the halo, as a comparable key. */
  selectionKey: string;
  machineId: string;
}

export class TwinScene {
  private readonly container: HTMLElement;
  private readonly callbacks: TwinCallbacks;
  private reducedMotion: boolean;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: {
    target: THREE.Vector3;
    update(): boolean;
    dispose(): void;
    enabled: boolean;
  } | null = null;

  private readonly nodes = new Map<string, MachineNode>();
  private readonly disposables = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  private readonly shared = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();

  private edgeGroup: THREE.Group | null = null;
  private depEdges: { upstream: string; downstream: string; relation: string }[] = [];

  private rafId = 0;
  private settleUntil = 0;
  private running = false;
  private disposed = false;
  private needsRender = true;
  private lastFrame = 0;

  private selected = new Set<string>();
  private hovered: string | null = null;
  private mode: 'status' | 'risk' | 'dependencies' = 'status';
  private zoneFilter: string | null = null;

  private cameraTarget: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private cameraTweenStart: { position: THREE.Vector3; target: THREE.Vector3; time: number } | null = null;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private domHandlers: { type: string; fn: EventListener }[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private lastNow = 0;

  constructor(options: TwinOptions) {
    this.container = options.containers;
    this.callbacks = options.callbacks;
    this.reducedMotion = options.reducedMotion;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.floor);
    this.scene.fog = new THREE.Fog(PALETTE.floor, 95, 240);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.5, 260);
    this.camera.position.set(28, 26, 14);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'low-power',
      // Required so a screenshot or an OS-level capture contains the frame.
      // Without it the drawing buffer is cleared after compositing and any
      // capture — including the visual-QA suite — records a black canvas.
      preserveDrawingBuffer: true,
    });
    // Without tone mapping the very dark graphite materials in a dim
    // industrial scene quantise to near-black on an 8-bit buffer.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.setAttribute('tabindex', '0');
    this.renderer.domElement.setAttribute('role', 'application');
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Factory digital twin. Use the asset list for keyboard selection, or press arrow keys to move between machines.',
    );
    this.container.appendChild(this.renderer.domElement);

    this.buildEnvironment();
    this.attachOrbit();
    this.attachPointer();

    /*
     * Orient the default camera at the plant.
     *
     * THREE.PerspectiveCamera looks down its own -Z axis, so a camera merely
     * POSITIONED above the floor still points at empty space. The first
     * `syncMachines` call re-fits to the real bounds; this initial pose makes
     * the very first frame correct instead of a black canvas.
     */
    const initial = this.sceneBounds();
    this.camera.position.copy(initial.position);
    this.camera.lookAt(initial.target);
    if (this.controls) this.controls.target.copy(initial.target);

    this.observeResize();
    this.start();
  }

  /* ---------------------------------------------------------------- *
   * Scene construction
   * ---------------------------------------------------------------- */

  private track<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(item: T, shared = false): T {
    if (shared) this.shared.add(item);
    else this.disposables.add(item);
    return item;
  }

  private buildEnvironment(): void {
    /*
     * Industrial lighting. Bright enough that graphite steel reads as steel
     * rather than as black, but with a cool key and a warmer rim so machine
     * forms stay legible against the floor.
     */
    this.scene.add(new THREE.HemisphereLight(0xd8e6f4, hex('--color-bg-inset', 0x070a0e), 1.5));

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(18, 28, 12);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x9fc0e0, 0.95);
    rim.position.set(-16, 14, -16);
    this.scene.add(rim);

    // Low fill so shadowed faces do not crush to black.
    this.scene.add(new THREE.AmbientLight(0x2b3a4c, 0.9));

    const floorGeo = this.track(new THREE.PlaneGeometry(140, 110), true);
    const floor = new THREE.Mesh(
      floorGeo,
      this.track(new THREE.MeshStandardMaterial({ color: PALETTE.floor, roughness: 1, metalness: 0 })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.1;
    this.scene.add(floor);

    const slabGeo = this.track(new THREE.PlaneGeometry(56, 54), true);
    const slab = new THREE.Mesh(
      slabGeo,
      this.track(new THREE.MeshStandardMaterial({ color: PALETTE.slab, roughness: 0.95, metalness: 0.02 })),
    );
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(0, -0.08, -19);
    this.scene.add(slab);

    const grid = new THREE.GridHelper(54, 27, PALETTE.gridMajor, PALETTE.grid);
    grid.position.set(0, -0.05, -19);
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.55;
    this.scene.add(grid);

    this.edgeGroup = new THREE.Group();
    this.edgeGroup.visible = false;
    this.scene.add(this.edgeGroup);
  }

  private attachOrbit(): void {
    // Minimal orbit implementation — avoids pulling the addons bundle and
    // keeps the vendor chunk small.
    const controls = {
      target: new THREE.Vector3(0, 0, -19),
      enabled: true,
      update: () => false,
      dispose: () => {
        for (const handler of this.domHandlers) this.renderer.domElement.removeEventListener(handler.type, handler.fn);
        this.domHandlers = this.domHandlers.filter((h) => !this.domHandlers.includes(h));
      },
    };
    this.controls = controls as unknown as TwinScene['controls'];
    this.installOrbitControls(controls);
  }

  private installOrbitControls(controls: { target: THREE.Vector3 }): void {
    const element = this.renderer.domElement;
    let dragging = false;
    let panning = false;
    let lastX = 0;
    let lastY = 0;
    const spherical = new THREE.Spherical();
    const offset = new THREE.Vector3();

    const onDown = ((event: PointerEvent) => {
      if (event.button === 2 || event.shiftKey) panning = true;
      else dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      element.setPointerCapture(event.pointerId);
    }) as EventListener;

    const onMove = ((event: PointerEvent) => {
      if (!dragging && !panning) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;

      this.cameraTweenStart = null;

      offset.copy(this.camera.position).sub(controls.target);
      spherical.setFromVector3(offset);

      if (panning) {
        const scale = spherical.radius * 0.0016;
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
        controls.target.addScaledVector(right, -dx * scale);
        controls.target.addScaledVector(up, dy * scale);
      } else {
        spherical.theta -= dx * 0.005;
        spherical.phi = Math.max(0.12, Math.min(Math.PI * 0.49, spherical.phi - dy * 0.005));
      }

      this.camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      this.camera.lookAt(controls.target);
      this.invalidate(SETTLE_MS);
    }) as EventListener;

    const onUp = ((event: PointerEvent) => {
      dragging = false;
      panning = false;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    }) as EventListener;

    const onWheel = ((event: WheelEvent) => {
      event.preventDefault();
      this.cameraTweenStart = null;
      offset.copy(this.camera.position).sub(controls.target);
      spherical.setFromVector3(offset);
      spherical.radius = Math.max(6, Math.min(120, spherical.radius * (1 + Math.sign(event.deltaY) * 0.12)));
      this.camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      this.camera.lookAt(controls.target);
      this.invalidate(SETTLE_MS);
    }) as EventListener;

    const onContext = ((event: Event) => event.preventDefault()) as EventListener;

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('contextmenu', onContext);

    this.domHandlers.push(
      { type: 'pointerdown', fn: onDown },
      { type: 'pointermove', fn: onMove },
      { type: 'pointerup', fn: onUp },
      { type: 'pointercancel', fn: onUp },
      { type: 'wheel', fn: onWheel },
      { type: 'contextmenu', fn: onContext },
    );
  }

  private attachPointer(): void {
    const element = this.renderer.domElement;

    const onClick = ((event: MouseEvent) => {
      const machineId = this.pick(event);
      if (machineId) this.callbacks.onSelect(machineId, event.shiftKey);
    }) as EventListener;

    const onDoubleClick = ((event: MouseEvent) => {
      const machineId = this.pick(event);
      if (machineId) this.focusMachine(machineId);
    }) as EventListener;

    const onMove = ((event: PointerEvent) => {
      // Throttle hover picking: raycasting per pointermove is the single most
      // expensive interaction in this view.
      if (this.rafHoverPending) return;
      this.rafHoverPending = true;
      requestAnimationFrame(() => {
        this.rafHoverPending = false;
        const machineId = this.pick(event);
        if (machineId === this.hovered) return;
        this.setHovered(machineId);
      });
    }) as EventListener;

    const onLeave = (() => {
      this.setHovered(null);
    }) as EventListener;

    element.addEventListener('click', onClick);
    element.addEventListener('dblclick', onDoubleClick);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);

    this.domHandlers.push(
      { type: 'click', fn: onClick },
      { type: 'dblclick', fn: onDoubleClick },
      { type: 'pointermove', fn: onMove },
      { type: 'pointerleave', fn: onLeave },
    );
  }

  private rafHoverPending = false;

  private observeResize(): void {
    const resize = () => {
      const width = this.container.clientWidth || 1;
      const height = this.container.clientHeight || 1;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
      this.invalidate();
    };
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(this.container);
    resize();
  }

  /* ---------------------------------------------------------------- *
   * Machine layout
   * ---------------------------------------------------------------- */

  private zoneRow(code: string): number {
    const index = ZONE_ORDER.indexOf(code);
    return index >= 0 ? index : ZONE_ORDER.length;
  }

  private positionFor(machine: Machine): THREE.Vector3 {
    const row = this.zoneRow(machine.zone);
    const siblings = this.rowMembers.get(row) ?? [];
    const index = Math.max(0, siblings.indexOf(machine.machineId));
    const count = Math.max(1, siblings.length);
    const spread = Math.max(1, count) * MACHINE_SPACING;
    const x = -spread / 2 + index * MACHINE_SPACING + MACHINE_SPACING / 2;
    return new THREE.Vector3(x, 0, -row * ROW_PITCH - ROW_OFFSET);
  }

  private rowMembers = new Map<number, string[]>();

  private layout(machines: Machine[]): void {
    this.rowMembers.clear();
    const byRow = new Map<number, string[]>();
    for (const machine of machines) {
      const row = this.zoneRow(machine.zone);
      const list = byRow.get(row) ?? [];
      list.push(machine.machineId);
      byRow.set(row, list);
    }
    for (const [row, ids] of byRow) {
      ids.sort();
      this.rowMembers.set(row, ids);
    }

    // Zone floor slabs.
    if (this.zoneGroup) this.disposeChildren(this.zoneGroup);
    const group = this.zoneGroup ?? new THREE.Group();
    if (!this.zoneGroup) {
      this.zoneGroup = group;
      this.scene.add(group);
    }

    for (const [row, ids] of byRow) {
      const width = Math.max(8, ids.length * MACHINE_SPACING + 2);
      const depth = ZONE_DEPTH;
      const centreZ = -row * ROW_PITCH - ROW_OFFSET;

      const slabGeo = this.track(new THREE.PlaneGeometry(width, depth));
      const slabMat = this.track(
        new THREE.MeshStandardMaterial({ color: 0x121922, roughness: 0.92, metalness: 0.04 }),
      );
      const slab = new THREE.Mesh(slabGeo, slabMat);
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(0, -0.03, centreZ);
      group.add(slab);

      const lineGeo = this.track(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-width / 2, 0.02, centreZ - depth / 2),
        new THREE.Vector3(width / 2, 0.02, centreZ - depth / 2),
        new THREE.Vector3(width / 2, 0.02, centreZ + depth / 2),
        new THREE.Vector3(-width / 2, 0.02, centreZ + depth / 2),
        new THREE.Vector3(-width / 2, 0.02, centreZ - depth / 2),
      ]));
      const lineMat = this.track(new THREE.LineBasicMaterial({ color: PALETTE.edge, transparent: true, opacity: 0.7 }));
      group.add(new THREE.Line(lineGeo, lineMat));
    }
  }

  private zoneGroup: THREE.Group | null = null;

  /** Build the visual body for one machine type. */
  private buildBody(machine: Machine): THREE.Group {
    const group = new THREE.Group();

    const plinthGeo = this.track(new THREE.BoxGeometry(3.1, 0.34, 2.2), true);
    const plinthMat = this.track(new THREE.MeshStandardMaterial({ color: PALETTE.bodyDark, roughness: 0.8, metalness: 0.25 }), true);
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = 0.17;
    group.add(plinth);

    const addBox = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      material: THREE.Material,
    ) => {
      const geo = this.track(new THREE.BoxGeometry(w, h, d), true);
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };

    const bodyMat = this.track(
      new THREE.MeshStandardMaterial({ color: PALETTE.body, roughness: 0.55, metalness: 0.55 }),
      true,
    );
    const darkMat = this.track(
      new THREE.MeshStandardMaterial({ color: PALETTE.plate, roughness: 0.7, metalness: 0.4 }),
      true,
    );
    const steelMat = this.track(
      new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.35, metalness: 0.8 }),
      true,
    );

    switch (machine.type) {
      case 'CNC_MILL': {
        addBox(2.2, 1.7, 1.6, 0, 1.2, 0, bodyMat);
        addBox(1.5, 0.9, 0.3, 0, 1.35, -0.95, darkMat);
        addBox(0.22, 1.5, 0.22, 0.85, 2.2, 0.5, steelMat);
        break;
      }
      case 'CONVEYOR_DRIVE_MOTOR':
      case 'INDUSTRIAL_MOTOR': {
        const motorGeo = this.track(new THREE.CylinderGeometry(0.62, 0.62, 1.9, 16), true);
        const motor = new THREE.Mesh(motorGeo, bodyMat);
        motor.rotation.z = Math.PI / 2;
        motor.position.set(0, 0.95, 0);
        group.add(motor);
        addBox(1.2, 0.7, 1.1, -1.1, 0.7, 0, darkMat);
        addBox(2.2, 0.16, 0.5, 0, 1.75, 0, steelMat);
        break;
      }
      case 'HYDRAULIC_PUMP': {
        addBox(1.5, 1.2, 1.3, 0, 0.95, 0, bodyMat);
        const barrelGeo = this.track(new THREE.CylinderGeometry(0.42, 0.42, 1.5, 14), true);
        const barrel = new THREE.Mesh(barrelGeo, steelMat);
        barrel.rotation.z = Math.PI / 2;
        barrel.position.set(0, 1.75, 0);
        group.add(barrel);
        break;
      }
      case 'COMPRESSOR': {
        addBox(2.0, 1.5, 1.5, 0, 1.1, 0, bodyMat);
        const tankGeo = this.track(new THREE.CylinderGeometry(0.55, 0.55, 1.6, 14), true);
        const tank = new THREE.Mesh(tankGeo, steelMat);
        tank.position.set(0, 2.2, 0.2);
        group.add(tank);
        break;
      }
      case 'ROBOTIC_ARM': {
        addBox(1.3, 0.6, 1.3, 0, 0.62, 0, darkMat);
        addBox(0.36, 1.2, 0.36, 0, 1.45, 0, bodyMat);
        const armGeo = this.track(new THREE.BoxGeometry(1.5, 0.28, 0.28), true);
        const arm = new THREE.Mesh(armGeo, steelMat);
        arm.position.set(0.65, 2.0, 0);
        arm.rotation.z = -0.5;
        group.add(arm);
        break;
      }
      case 'COOLING_UNIT': {
        addBox(1.9, 1.4, 1.4, 0, 1.05, 0, bodyMat);
        for (let i = 0; i < 3; i += 1) {
          const finGeo = this.track(new THREE.BoxGeometry(1.7, 0.08, 0.08), true);
          const fin = new THREE.Mesh(finGeo, steelMat);
          fin.position.set(0, 0.7 + i * 0.35, -0.75);
          group.add(fin);
        }
        break;
      }
      case 'GENERATOR': {
        addBox(2.3, 1.3, 1.4, 0, 1.0, 0, bodyMat);
        const stackGeo = this.track(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 10), true);
        const stack = new THREE.Mesh(stackGeo, steelMat);
        stack.position.set(0.85, 2.1, 0);
        group.add(stack);
        break;
      }
      default: {
        addBox(2.0, 1.4, 1.4, 0, 1.05, 0, bodyMat);
        break;
      }
    }

    // Status indicator tower — colour changes, geometry does not.
    const indicatorGeo = this.track(new THREE.SphereGeometry(0.16, 12, 10), true);
    const indicatorMat = this.track(
      new THREE.MeshStandardMaterial({ color: STATE_COLOURS.ok, emissive: STATE_COLOURS.ok, emissiveIntensity: 1.4, roughness: 0.4 }),
      true,
    );
    const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
    indicator.position.set(0, MACHINE_HEIGHT + 0.1, 0);
    group.add(indicator);

    // Selection halo.
    const haloGeo = this.track(new THREE.RingGeometry(1.85, 2.05, 40), true);
    const haloMat = this.track(
      new THREE.MeshBasicMaterial({ color: SELECT_COLOUR, transparent: true, opacity: 0, side: THREE.DoubleSide }),
      true,
    );
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.04;
    group.add(halo);

    return group;
  }

  /* ---------------------------------------------------------------- *
   * Public API
   * ---------------------------------------------------------------- */

  /** Reconcile the scene with the fleet. Only creates/destroys what changed. */
  syncMachines(machines: Machine[], zones: Zone[]): void {
    if (this.disposed) return;

    // The very first population is when real bounds exist, so frame the plant
    // once here. After this the operator owns the camera and it is not
    // overridden by a routine poll.
    const firstPopulation = this.nodes.size === 0 && machines.length > 0;

    this.layout(machines);
    void zones;

    const seen = new Set<string>();
    const now = Date.now();
    const zoneLookup = new Map<string, string>();
    for (const machine of machines) zoneLookup.set(machine.machineId, machine.zone);
    this.machineZone = zoneLookup;

    for (const machine of machines) {
      seen.add(machine.machineId);
      const derived = deriveOperationalState(machine, now);
      const position = this.positionFor(machine);
      const signature = `${machine.status}|${derived.state}|${machine.type}|${machine.zone}`;

      let node = this.nodes.get(machine.machineId);
      if (!node) {
        const group = this.buildBody(machine);
        group.userData.machineId = machine.machineId;
        for (const child of group.children) child.userData.machineId = machine.machineId;

        const indicator = group.children.find(
          (child): child is THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial> =>
            child instanceof THREE.Mesh && (child.geometry as THREE.SphereGeometry).type === 'SphereGeometry',
        );
        const halo = group.children.find(
          (child): child is THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> =>
            child instanceof THREE.Mesh && (child.geometry as THREE.RingGeometry).type === 'RingGeometry',
        );
        if (!indicator || !halo) continue;

        const label = this.makeLabel(machine.machineId);
        label.userData.machineId = machine.machineId;
        label.position.set(0, MACHINE_HEIGHT + 0.75, 0);
        group.add(label);

        group.position.copy(position);
        this.scene.add(group);

        node = {
          group,
          indicator,
          halo,
          statusRing: halo,
          label,
            position,
            tone: derived.descriptor.tone,
            signature,
            // Force the first applyState/applySelectionVisuals to draw.
            visualKey: '',
            selectionKey: '',
            machineId: machine.machineId,
          };

        this.nodes.set(machine.machineId, node);
        this.applyState(node, derived.state, derived.descriptor.tone, machine);
      } else {
        node.position.copy(position);
        node.group.position.copy(position);
        if (node.signature !== signature) {
          node.signature = signature;
          if (this.applyState(node, derived.state, derived.descriptor.tone, machine)) {
            this.invalidate(SETTLE_MS);
          }
        }
      }
    }

    // Remove machines that disappeared.
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      this.removeNode(node);
    }

    this.applyZoneFilter();
    this.applySelectionVisuals();

    if (firstPopulation) {
      // The camera aspect is only known after the first ResizeObserver
      // callback, so fit on the next frame when the projection is correct.
      requestAnimationFrame(() => {
        if (!this.disposed) this.fit();
      });
    }
  }

  private removeNode(node: MachineNode): void {
    this.scene.remove(node.group);
    // The body is built from shared geometry/materials; only the label sprite
    // texture is per-node.
    const labelMaterial = node.label.material as THREE.SpriteMaterial;
    labelMaterial.map?.dispose();
    labelMaterial.dispose();
    this.nodes.delete(node.machineId);
  }

  private applyState(node: MachineNode, _state: OperationalState, tone: StateTone, machine: Machine): boolean {
    /*
     * Risk mode is an intelligence overlay, so it is violet - the same colour
     * the Predictions workspace uses for model output. Assets below the
     * threshold dim rather than turn green, so violet always reads as
     * "the model is pointing at this".
     */
    const elevated = machine.failureRisk >= 0.5;
    const mid = machine.failureRisk >= 0.3;
    const riskEmphasis = this.mode === 'risk' ? (elevated ? 2 : mid ? 1 : 0) : -1;
    const key = `${tone}|${riskEmphasis}`;
    if (node.visualKey === key) return false;

    node.visualKey = key;
    node.tone = tone;

    const colour = this.mode === 'risk'
      ? riskEmphasis === 2
        ? PREDICTION_COLOUR
        : riskEmphasis === 1
          ? hex('--color-warning', 0xe8a93f)
          : PALETTE.body
      : STATE_COLOURS[tone];

    node.indicator.material.color.setHex(colour);
    node.indicator.material.emissive.setHex(colour);
    node.indicator.material.emissiveIntensity = riskEmphasis === 2 ? 2.4 : riskEmphasis === 1 ? 1.5 : riskEmphasis === 0 ? 0.25 : 1.6;
    return true;
  }

  private makeLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, 128, 32);
      context.font = '600 15px "JetBrains Mono", monospace';
      context.fillStyle = cssColour('--color-text-secondary', 0xa7b4c4);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, 64, 17);
    }
    const texture = this.track(new THREE.CanvasTexture(canvas));
    texture.needsUpdate = true;
    const material = this.track(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, fog: false }),
    );
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.7, 0.42, 1);
    return sprite;
  }

  setMode(mode: 'status' | 'risk' | 'dependencies'): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.edgeGroup) this.edgeGroup.visible = mode === 'dependencies';
    this.invalidate(SETTLE_MS);
  }

  /**
   * Re-apply the risk-mode emphasis. Called when the mode changes so already
   * built nodes update their indicator without a full rebuild.
   */
  refreshEmphasis(machines: Machine[]): void {
    const now = Date.now();
    let changed = false;
    for (const machine of machines) {
      const node = this.nodes.get(machine.machineId);
      if (!node) continue;
      const derived = deriveOperationalState(machine, now);
      if (this.applyState(node, derived.state, derived.descriptor.tone, machine)) changed = true;
    }
    // Only pay for a render settle when an indicator actually moved.
    if (changed) this.invalidate(SETTLE_MS);
  }

  setSelected(ids: string[]): void {
    this.selected = new Set(ids);
    this.applySelectionVisuals();
  }

  private applySelectionVisuals(): void {
    let changed = false;
    for (const [id, node] of this.nodes) {
      const isSelected = this.selected.has(id);
      const isHovered = this.hovered === id;
      // A comparable key, not a material readback — see MachineNode.visualKey.
      const key = `${isSelected ? 's' : isHovered ? 'h' : 'n'}`;
      if (node.selectionKey === key) continue;
      node.selectionKey = key;

      node.halo.material.opacity = isSelected ? 0.85 : isHovered ? 0.45 : 0;
      node.halo.material.color.setHex(isSelected ? SELECT_COLOUR : hex('--color-text-secondary', 0xa7b4c4));
      if (isSelected) {
        node.halo.position.y = 0.05;
      }
      changed = true;
    }
    if (changed) this.invalidate();
  }

  private setHovered(machineId: string | null): void {
    if (this.hovered === machineId) return;
    this.hovered = machineId;
    this.renderer.domElement.style.cursor = machineId ? 'pointer' : 'grab';
    this.applySelectionVisuals();
    this.callbacks.onHover(machineId);
  }

  setZoneFilter(zone: string | null): void {
    this.zoneFilter = zone;
    this.applyZoneFilter();
  }

  private applyZoneFilter(): void {
    let changed = false;
    for (const node of this.nodes.values()) {
      const visible = !this.zoneFilter || this.zoneOf(node.machineId) === this.zoneFilter;
      if (node.group.visible !== visible) {
        node.group.visible = visible;
        changed = true;
      }
    }
    if (changed) this.invalidate();
  }

  private zoneOf(machineId: string): string | null {
    return this.machineZone.get(machineId) ?? null;
  }

  private machineZone = new Map<string, string>();

  setDependencyEdges(edges: DependencyEdge[]): void {
    this.depEdges = edges.map((edge) => ({
      upstream: edge.upstream,
      downstream: edge.downstream,
      relation: edge.relation,
    }));
    this.rebuildEdges();
  }

  private rebuildEdges(): void {
    if (!this.edgeGroup) return;
    this.disposeChildren(this.edgeGroup);

    for (const edge of this.depEdges) {
      const from = this.nodes.get(edge.upstream);
      const to = this.nodes.get(edge.downstream);
      if (!from || !to) continue;

      const start = from.position.clone().add(new THREE.Vector3(0, 1.4, 0));
      const end = to.position.clone().add(new THREE.Vector3(0, 1.4, 0));
      const mid = start.clone().add(end).multiplyScalar(0.5);
      mid.y += 1.2;

      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const points = curve.getPoints(18);
      const geometry = this.track(new THREE.BufferGeometry().setFromPoints(points));
      const material = this.track(
        new THREE.LineBasicMaterial({
          color: RELATION_COLOURS[edge.relation] ?? 0x7c8b9c,
          transparent: true,
          opacity: 0.5,
        }),
      );
      this.edgeGroup.add(new THREE.Line(geometry, material));
    }
    this.invalidate();
  }

  /* ---- camera ---- */

  fit(): void {
    const bounds = this.sceneBounds();
    this.animateCamera(bounds.position, bounds.target);
  }

  topView(): void {
    const bounds = this.sceneBounds();
    const distance = Math.max(bounds.size.y, bounds.size.z) * 0.9 + 8;
    this.animateCamera(
      new THREE.Vector3(bounds.target.x, distance, bounds.target.z + 0.01),
      bounds.target,
    );
  }

  focusMachine(machineId: string): void {
    const node = this.nodes.get(machineId);
    if (!node) return;
    const target = node.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    const direction = new THREE.Vector3(0.55, 0.6, 0.85).normalize().multiplyScalar(11);
    this.animateCamera(target.clone().add(direction), target);
  }

  focusZone(zone: string): void {
    const members = Array.from(this.nodes.values()).filter((node) => this.zoneOf(node.machineId) === zone);
    if (members.length === 0) return;
    const box = new THREE.Box3();
    for (const node of members) box.expandByPoint(node.position);
    const centre = box.getCenter(new THREE.Vector3());
    this.animateCamera(new THREE.Vector3(centre.x, 17, centre.z + 15), centre);
  }

  private sceneBounds(): { position: THREE.Vector3; target: THREE.Vector3; size: THREE.Vector3 } {
    const box = new THREE.Box3();
    for (const node of this.nodes.values()) {
      box.expandByPoint(node.position.clone().add(new THREE.Vector3(-2, 0, -2)));
      box.expandByPoint(node.position.clone().add(new THREE.Vector3(2, MACHINE_HEIGHT + 1.4, 2)));
    }
    if (box.isEmpty()) {
      const target = new THREE.Vector3(0, 0, -19);
      return { position: new THREE.Vector3(28, 26, 14), target, size: new THREE.Vector3(20, 6, 40) };
    }

    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    /*
     * Fit for the ACTUAL viewport, not a fixed radius. The plant is much
     * wider than it is deep, so a radius derived from the largest single
     * dimension crops the ends on a wide screen. Deriving the distance from
     * the vertical FOV and the projected extents keeps the whole floor in
     * frame at any aspect ratio.
     */
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.max(0.35, this.camera.aspect || 1);
    const fitHeightDistance = size.y / 2 / Math.tan(fov / 2);
    const fitWidthDistance = size.x / 2 / Math.tan(fov / 2) / aspect;
    const fitDepthDistance = size.z / 2;
    const distance = Math.max(fitHeightDistance, fitWidthDistance, fitDepthDistance) * 1.18 + 6;

    const direction = new THREE.Vector3(0.42, 0.62, 0.66).normalize();
    return { position: centre.clone().add(direction.multiplyScalar(distance)), target: centre, size };
  }

  private animateCamera(position: THREE.Vector3, target: THREE.Vector3): void {
    if (this.reducedMotion) {
      this.camera.position.copy(position);
      if (this.controls) this.controls.target.copy(target);
      this.camera.lookAt(target);
      this.invalidate();
      return;
    }
    this.cameraTweenStart = {
      position: this.camera.position.clone(),
      target: this.controls ? this.controls.target.clone() : new THREE.Vector3(),
      time: performance.now(),
    };
    this.cameraTarget = { position, target };
    this.invalidate(900);
  }

  private stepCameraTween(now: number): void {
    if (!this.cameraTweenStart || !this.cameraTarget) return;
    const duration = 620;
    const t = Math.min(1, (now - this.cameraTweenStart.time) / duration);
    // easeInOutCubic
    const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    this.camera.position.lerpVectors(this.cameraTweenStart.position, this.cameraTarget.position, eased);
    if (this.controls) this.controls.target.lerpVectors(this.cameraTweenStart.target, this.cameraTarget.target, eased);
    this.camera.lookAt(this.controls ? this.controls.target : this.cameraTarget.target);
    if (t >= 1) {
      this.cameraTweenStart = null;
      this.cameraTarget = null;
    }
  }

  /* ---------------------------------------------------------------- *
   * Picking
   * ---------------------------------------------------------------- */

  private pick(event: MouseEvent | PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const pickable: THREE.Object3D[] = [];
    for (const node of this.nodes.values()) {
      if (node.group.visible) pickable.push(node.group);
    }
    const hits = this.raycaster.intersectObjects(pickable, true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        if (object.userData.machineId) return object.userData.machineId as string;
        object = object.parent;
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- *
   * Render loop — on-demand
   * ---------------------------------------------------------------- */

  private invalidate(settleMs = 0): void {
    this.needsRender = true;
    if (settleMs > 0) this.settleUntil = Math.max(this.settleUntil, performance.now() + settleMs);
    if (!this.running) this.start();
  }

  private start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    this.lastNow = now;

    // Hard suspend when the tab is hidden: no GPU work at all.
    if (document.hidden) return;

    const settling = now < this.settleUntil;
    const animating = this.cameraTweenStart !== null;

    if (!this.needsRender && !settling && !animating) {
      // Nothing changed — stop scheduling frames entirely.
      this.running = false;
      this.rafId = 0;
      return;
    }

    const delta = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (animating) this.stepCameraTween(now);

    if (this.controls) this.controls.target.lerp(this.controls.target, 1 - Math.min(1, delta * 8));

    this.renderer.render(this.scene, this.camera);
    this.needsRender = settling || animating;
  };

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  resize(): void {
    this.invalidate();
  }

  /* ---------------------------------------------------------------- *
   * Teardown
   * ---------------------------------------------------------------- */

  private disposeChildren(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      const mesh = child as THREE.Mesh;
      if (mesh.geometry && !this.shared.has(mesh.geometry)) {
        mesh.geometry.dispose();
        this.disposables.delete(mesh.geometry);
      }
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) {
        for (const entry of material) {
          if (!this.shared.has(entry)) {
            entry.dispose();
            this.disposables.delete(entry);
          }
        }
      } else if (material && !this.shared.has(material)) {
        material.dispose();
        this.disposables.delete(material);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    for (const { type, fn } of this.domHandlers) {
      this.renderer.domElement.removeEventListener(type, fn);
    }
    this.domHandlers = [];

    this.controls?.dispose();
    this.controls = null;

    for (const node of this.nodes.values()) this.removeNode(node);
    this.nodes.clear();

    if (this.zoneGroup) this.disposeChildren(this.zoneGroup);
    if (this.edgeGroup) this.disposeChildren(this.edgeGroup);

    for (const item of this.disposables) item.dispose();
    for (const item of this.shared) item.dispose();
    this.disposables.clear();
    this.shared.clear();

    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.scene.clear();
  }

  getFrameCount(): number {
    return this.lastNow;
  }
}
