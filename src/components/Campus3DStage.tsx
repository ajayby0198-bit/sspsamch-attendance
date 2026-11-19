import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Eye, RotateCcw, Pause, Play } from 'lucide-react';
import { INSTITUTION_INFO } from '../types';

export interface BatchTelemetryMetric {
  label: string;
  profYear: string;
  avgPercent: number;
  studentCount: number;
}

interface Campus3DStageProps {
  batches: BatchTelemetryMetric[];
  compact?: boolean;
  className?: string;
}

type CameraPreset = 'overview' | 'pillars' | 'emblem';

const CAMERA_TARGETS: Record<CameraPreset, { pos: [number, number, number]; look: [number, number, number] }> = {
  overview: { pos: [4.8, 3.6, 6.2], look: [0, 0.9, 0] },
  pillars: { pos: [0.2, 2.5, 6.6], look: [0, 1.1, 0] },
  emblem: { pos: [-3.4, 2.4, 3.8], look: [-1.1, 1.1, 0] },
};

const _targetPos = new THREE.Vector3();
const _targetLook = new THREE.Vector3();

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 14, 128, 128, 124);
    grad.addColorStop(0, 'rgba(11, 25, 39, 0.55)');
    grad.addColorStop(0.55, 'rgba(11, 25, 39, 0.18)');
    grad.addColorStop(1, 'rgba(11, 25, 39, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createRadialFloorGridTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0d281e';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(212, 168, 83, 0.22)';
    ctx.lineWidth = 1.5;
    for (let r = 48; r <= 240; r += 48) {
      ctx.beginPath();
      ctx.arc(256, 256, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(256, 256);
      ctx.lineTo(256 + Math.cos(a) * 245, 256 + Math.sin(a) * 245);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const Campus3DStage: React.FC<Campus3DStageProps> = ({
  batches,
  compact = false,
  className = '',
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const presetRef = useRef<CameraPreset>('overview');
  const transitioningRef = useRef(false);
  const autoRotateRef = useRef(true);
  const batchTargetsRef = useRef<number[]>([84, 78, 86]);

  const [activePreset, setActivePreset] = useState<CameraPreset>('overview');
  const [autoRotate, setAutoRotate] = useState(true);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  useEffect(() => {
    const ordered = [
      batches[0]?.avgPercent ?? 82,
      batches[1]?.avgPercent ?? 76,
      batches[2]?.avgPercent ?? 86,
    ];
    batchTargetsRef.current = ordered;
  }, [batches]);

  const selectPreset = (preset: CameraPreset) => {
    presetRef.current = preset;
    transitioningRef.current = true;
    setActivePreset(preset);
  };

  const toggleRotate = () => {
    autoRotateRef.current = !autoRotateRef.current;
    setAutoRotate(autoRotateRef.current);
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      autoRotateRef.current = false;
      setAutoRotate(false);
    }

    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 340;
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglUnavailable(true);
    };
    const handleContextRestored = () => {
      setWebglUnavailable(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new THREE.Scene();
    const bgHex = 0x0b2219;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, 0.045);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTex = pmremGenerator.fromScene(roomEnv, 0.04).texture;
    scene.environment = envTex;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 60);
    camera.position.set(...CAMERA_TARGETS.overview.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 3.6;
    controls.maxDistance = 10.5;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minPolarAngle = Math.PI * 0.16;
    controls.target.set(...CAMERA_TARGETS.overview.look);
    controls.autoRotate = false;
    controls.addEventListener('start', () => {
      transitioningRef.current = false;
    });

    // 3-Point Warm Ayurvedic Studio Lighting
    const hemiLight = new THREE.HemisphereLight(0xfef3c7, 0x091c15, 0.8);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.25);
    keyLight.position.set(5.5, 8.5, 5.2);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.left = -5;
    keyLight.shadow.camera.right = 5;
    keyLight.shadow.camera.top = 5;
    keyLight.shadow.camera.bottom = -5;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x34d399, 1.2);
    rimLight.position.set(-5, 4, -5);
    scene.add(rimLight);

    // Materials library (distinct roughness & metalness across adjacent parts)
    const disposables: Array<{ dispose: () => void }> = [envTex];
    const track = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };

    const gridTex = track(createRadialFloorGridTexture());
    gridTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const shadowTex = track(createContactShadowTexture());

    const stoneMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xe9dfd0,
        roughness: 0.72,
        metalness: 0.06,
      })
    );
    const slateBaseMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x163d2e,
        roughness: 0.55,
        metalness: 0.25,
      })
    );
    const brassMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0xd4a44a,
        roughness: 0.22,
        metalness: 0.92,
        clearcoat: 0.4,
      })
    );
    const emeraldMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0x0f8a5f,
        roughness: 0.24,
        metalness: 0.15,
        clearcoat: 0.85,
        clearcoatRoughness: 0.12,
      })
    );
    const amberMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0xd97706,
        roughness: 0.26,
        metalness: 0.18,
        clearcoat: 0.85,
      })
    );
    const crimsonMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0xb93838,
        roughness: 0.28,
        metalness: 0.18,
        clearcoat: 0.8,
      })
    );
    const lotusMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.35,
        metalness: 0.1,
      })
    );

    // Architectural Ground Floor & Contact Shadow
    const floorGeo = track(new THREE.CircleGeometry(14, 64));
    const floorMat = track(
      new THREE.MeshStandardMaterial({
        map: gridTex,
        roughness: 0.86,
        metalness: 0.12,
      })
    );
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const contactGeo = track(new THREE.PlaneGeometry(7.2, 5.2));
    const contactMat = track(
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.65,
      })
    );
    const contactPlane = new THREE.Mesh(contactGeo, contactMat);
    contactPlane.rotation.x = -Math.PI / 2;
    contactPlane.position.y = 0.015;
    scene.add(contactPlane);

    // Master diorama group
    const diorama = new THREE.Group();
    scene.add(diorama);

    // Composite Model 1: SSPSAMCH Ayurvedic Kalash & Lotus Emblem (8+ parts, bottom-center grounded)
    const emblemGroup = new THREE.Group();
    emblemGroup.position.set(-1.35, 0, 0.2);
    diorama.add(emblemGroup);

    const plinth1 = new THREE.Mesh(track(new THREE.CylinderGeometry(1.05, 1.18, 0.18, 8)), slateBaseMat);
    plinth1.position.y = 0.09;
    plinth1.castShadow = true;
    plinth1.receiveShadow = true;
    emblemGroup.add(plinth1);

    const plinth2 = new THREE.Mesh(track(new THREE.CylinderGeometry(0.84, 0.92, 0.16, 8)), stoneMat);
    plinth2.position.y = 0.26;
    plinth2.castShadow = true;
    plinth2.receiveShadow = true;
    emblemGroup.add(plinth2);

    const collar = new THREE.Mesh(track(new THREE.TorusGeometry(0.68, 0.045, 16, 48)), brassMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.36;
    collar.castShadow = true;
    emblemGroup.add(collar);

    // LatheGeometry Kalash Vessel
    const kalashPoints = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.32, 0.0),
      new THREE.Vector2(0.38, 0.12),
      new THREE.Vector2(0.56, 0.44),
      new THREE.Vector2(0.46, 0.72),
      new THREE.Vector2(0.22, 0.88),
      new THREE.Vector2(0.31, 1.02),
      new THREE.Vector2(0.24, 1.05),
      new THREE.Vector2(0.0, 0.98),
    ];
    const kalashGeo = track(new THREE.LatheGeometry(kalashPoints, 36));
    const kalashMesh = new THREE.Mesh(kalashGeo, brassMat);
    kalashMesh.position.y = 0.36;
    kalashMesh.castShadow = true;
    emblemGroup.add(kalashMesh);

    // Extruded 8-petal Lotus Crown
    const petalShape = new THREE.Shape();
    petalShape.moveTo(0, 0);
    petalShape.quadraticCurveTo(0.14, 0.22, 0, 0.42);
    petalShape.quadraticCurveTo(-0.14, 0.22, 0, 0);
    const petalGeo = track(
      new THREE.ExtrudeGeometry(petalShape, {
        depth: 0.04,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: 0.015,
        bevelThickness: 0.015,
      })
    );
    const lotusGroup = new THREE.Group();
    lotusGroup.position.y = 1.38;
    for (let i = 0; i < 8; i++) {
      const petal = new THREE.Mesh(petalGeo, i % 2 === 0 ? lotusMat : emeraldMat);
      const angle = (i / 8) * Math.PI * 2;
      petal.position.set(Math.cos(angle) * 0.16, 0, Math.sin(angle) * 0.16);
      petal.rotation.y = -angle + Math.PI / 2;
      petal.rotation.x = 0.55;
      petal.castShadow = true;
      lotusGroup.add(petal);
    }
    const jewel = new THREE.Mesh(track(new THREE.OctahedronGeometry(0.16, 0)), emeraldMat);
    jewel.position.y = 0.28;
    lotusGroup.add(jewel);
    emblemGroup.add(lotusGroup);

    // Orbiting telemetry rings around the emblem
    const orbitRing1 = new THREE.Mesh(track(new THREE.TorusGeometry(0.95, 0.018, 12, 64)), brassMat);
    orbitRing1.position.y = 1.12;
    orbitRing1.rotation.x = Math.PI * 0.38;
    emblemGroup.add(orbitRing1);

    const orbitRing2 = new THREE.Mesh(track(new THREE.TorusGeometry(1.12, 0.014, 12, 64)), emeraldMat);
    orbitRing2.position.y = 1.12;
    orbitRing2.rotation.x = -Math.PI * 0.34;
    orbitRing2.rotation.y = Math.PI * 0.22;
    emblemGroup.add(orbitRing2);

    // Composite Model 2: Three Live Batch Telemetry Pillars (Batch 2025, 2024, 2023)
    const pillarsGroup = new THREE.Group();
    pillarsGroup.position.set(1.1, 0, 0);
    diorama.add(pillarsGroup);

    const stageDeck = new THREE.Mesh(track(new THREE.BoxGeometry(3.2, 0.14, 1.45)), slateBaseMat);
    stageDeck.position.set(0, 0.07, 0);
    stageDeck.castShadow = true;
    stageDeck.receiveShadow = true;
    pillarsGroup.add(stageDeck);

    const deckTrim = new THREE.Mesh(track(new THREE.BoxGeometry(3.26, 0.04, 1.51)), brassMat);
    deckTrim.position.set(0, 0.15, 0);
    pillarsGroup.add(deckTrim);

    const unitColumnGeo = track(new THREE.CylinderGeometry(0.28, 0.31, 1, 24));
    // Shift geometry origin to bottom so scaling Y grows cleanly upward from pedestal
    unitColumnGeo.translate(0, 0.5, 0);

    const pillarEntries: Array<{
      column: THREE.Mesh;
      capGroup: THREE.Group;
      currentScaleY: number;
    }> = [];

    const xOffsets = [-0.95, 0, 0.95];
    xOffsets.forEach((x, idx) => {
      const subBase = new THREE.Mesh(track(new THREE.CylinderGeometry(0.37, 0.41, 0.14, 8)), stoneMat);
      subBase.position.set(x, 0.24, 0);
      subBase.castShadow = true;
      pillarsGroup.add(subBase);

      const pct = batchTargetsRef.current[idx] ?? 80;
      const mat = pct >= 75 ? emeraldMat : pct >= 65 ? amberMat : crimsonMat;
      const col = new THREE.Mesh(unitColumnGeo, mat);
      col.position.set(x, 0.31, 0);
      col.castShadow = true;
      col.receiveShadow = true;
      const initH = Math.max(0.45, (pct / 100) * 2.1);
      col.scale.y = initH;
      pillarsGroup.add(col);

      const capGroup = new THREE.Group();
      capGroup.position.set(x, 0.31 + initH, 0);
      const capRing = new THREE.Mesh(track(new THREE.TorusGeometry(0.29, 0.03, 12, 32)), brassMat);
      capRing.rotation.x = Math.PI / 2;
      capGroup.add(capRing);
      const capDisc = new THREE.Mesh(track(new THREE.CylinderGeometry(0.22, 0.25, 0.07, 24)), stoneMat);
      capDisc.position.y = 0.04;
      capGroup.add(capDisc);
      pillarsGroup.add(capGroup);

      pillarEntries.push({ column: col, capGroup, currentScaleY: initH });
    });

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 340;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    let frameId = 0;
    let disposed = false;
    const clock = new THREE.Clock();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();

      if (autoRotateRef.current && !prefersReduced) {
        lotusGroup.rotation.y += delta * 0.45;
        orbitRing1.rotation.z += delta * 0.5;
        orbitRing2.rotation.z -= delta * 0.38;
        jewel.position.y = 0.28 + Math.sin(elapsed * 2.2) * 0.04;
      }

      // Smoothly damp Batch Pillar heights to live Firestore values
      pillarEntries.forEach((entry, idx) => {
        const pct = batchTargetsRef.current[idx] ?? 80;
        const targetH = Math.max(0.45, (pct / 100) * 2.15);
        entry.currentScaleY = THREE.MathUtils.damp(entry.currentScaleY, targetH, 5.5, delta);
        entry.column.scale.y = entry.currentScaleY;
        entry.capGroup.position.y = 0.31 + entry.currentScaleY;

        const desiredMat = pct >= 75 ? emeraldMat : pct >= 65 ? amberMat : crimsonMat;
        if (entry.column.material !== desiredMat) {
          entry.column.material = desiredMat;
        }
      });

      // Smoothly glide camera preset when clicked
      if (transitioningRef.current) {
        const cfg = CAMERA_TARGETS[presetRef.current];
        _targetPos.set(...cfg.pos);
        _targetLook.set(...cfg.look);
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetPos.x, 4.5, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetPos.y, 4.5, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetPos.z, 4.5, delta);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, _targetLook.x, 4.5, delta);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, _targetLook.y, 4.5, delta);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, _targetLook.z, 4.5, delta);

        if (camera.position.distanceTo(_targetPos) < 0.03) {
          transitioningRef.current = false;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      className={`relative rounded-xl overflow-hidden surface-3d-dark ${
        compact ? 'h-64 sm:h-72' : 'h-80 sm:h-96'
      } ${className}`}
    >
      {!webglUnavailable ? (
        <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      ) : (
        <div className="w-full h-full relative">
          <img
            src="/src/assets/images/ayurveda_college_campus_1794991001527.jpg"
            alt={INSTITUTION_INFO.name}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/35 to-transparent" />
        </div>
      )}

      {/* Top-left semantic HUD label (no backdrop-filter over WebGL) */}
      <div className="pointer-events-none absolute top-3.5 left-4 right-4 flex items-start justify-between gap-3">
        <div className="bg-slate-950/80 border border-white/15 rounded-lg px-3 py-2 max-w-md">
          <p className="text-[11px] font-medium text-emerald-300">
            {INSTITUTION_INFO.shortName} · NCISM {INSTITUTION_INFO.ncismId}
          </p>
          <p className="text-xs font-semibold text-white mt-0.5 truncate">
            {INSTITUTION_INFO.motto}
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-3 bg-slate-950/80 border border-white/15 rounded-lg px-3 py-2 text-[11px] font-mono tabular-nums text-slate-200">
          {batches.slice(0, 3).map((b) => (
            <span key={b.profYear} className="whitespace-nowrap">
              {b.profYear}: <strong className="text-emerald-300">{b.avgPercent}%</strong>
            </span>
          ))}
        </div>
      </div>

      {/* Unified Compact Bottom Control Dock (Zero Center Occlusion) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 bg-slate-950/90 border border-white/15 rounded-lg p-1 max-w-[95%]">
        {(
          [
            { id: 'overview', label: '3D Overview' },
            { id: 'pillars', label: 'Batch Pillars' },
            { id: 'emblem', label: 'College Emblem' },
          ] as const
        ).map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => selectPreset(preset.id)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activePreset === preset.id
                ? 'bg-emerald-700 text-white'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Eye className="w-3 h-3" />
            {preset.label}
          </button>
        ))}

        <button
          type="button"
          onClick={toggleRotate}
          aria-label={autoRotate ? 'Pause 3D rotation' : 'Resume 3D rotation'}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:text-white hover:bg-white/10 rounded-md whitespace-nowrap shrink-0"
        >
          {autoRotate ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {autoRotate ? 'Pause' : 'Spin'}
        </button>

        <button
          type="button"
          onClick={() => selectPreset('overview')}
          aria-label="Reset camera view"
          className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-md whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
