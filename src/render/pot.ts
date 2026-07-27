import * as THREE from 'three';
import {
  createGroundMaterial,
  createGritMaterial,
  createPedestalMaterial,
  createPotInnerMaterial,
  createPotMaterial,
  createSoilMaterial,
} from './materials';

/** Height of the stone pedestal; pot + tree sit on top via scene stage. */
export const PEDESTAL_HEIGHT = 0.032;

/** Soil surface Y in pot-local space (tree root offset). */
export const POT_SOIL_LOCAL_Y = 0.048;

/** Oval squash applied once to the whole pot group (classic training pot). */
const OVAL_X = 1.1;
const OVAL_Z = 0.9;

/** Ceramic wall thickness (world units before oval squash). */
const WALL = 0.0048;

/** Short ceramic feet height — pot almost rests on pedestal. */
const FOOT_H = 0.0038;

/**
 * Outer radius of the pot wall at normalized height t ∈ [0,1]
 * (t=0 at foot, t=1 at rim shoulder). Continuous soft bowl — no stepped shelf.
 */
function outerRadiusAt(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  // Soft S-curve flare: mostly upright, gentle belly near mid-height
  const ease = u * u * (3 - 2 * u);
  return 0.086 + ease * 0.014 + Math.sin(u * Math.PI) * 0.0035;
}

/**
 * Closed thick-walled classic training pot for LatheGeometry.
 * Path: underside center → outer wall/rim → over lip → inner wall → floor → center.
 * Coordinates: x = radius, y = height. Short feet are separate meshes.
 */
function createThickPotProfile(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const push = (r: number, y: number) =>
    pts.push(new THREE.Vector2(Math.max(0.0004, r), y));

  const bottomY = FOOT_H;
  const wallBottom = bottomY + 0.0012;
  const shoulderY = 0.048;
  const rimTopY = 0.054;

  // Closed underside — foot ring only slightly inset from wall
  // (avoids a large dark horizontal underside shelf under the belly)
  push(0.0005, bottomY);
  push(0.082, bottomY);
  // Small outer chamfer up into the wall
  push(0.085, wallBottom);
  push(outerRadiusAt(0), wallBottom + 0.001);

  // Continuous outer wall
  const outerSamples = 24;
  for (let i = 0; i <= outerSamples; i++) {
    const t = i / outerSamples;
    const y = wallBottom + 0.001 + t * (shoulderY - wallBottom - 0.001);
    push(outerRadiusAt(t), y);
  }

  // Rolled rim
  push(0.101, 0.05);
  push(0.1035, 0.0525);
  push(0.103, rimTopY);
  // Across lip thickness
  push(0.103 - WALL, rimTopY);
  push(0.1015 - WALL, 0.052);

  // Inner wall (parallel to outer, inset by WALL)
  const innerSamples = 20;
  const floorY = bottomY + WALL + 0.001;
  for (let i = 0; i <= innerSamples; i++) {
    const t = i / innerSamples; // 0 at rim → 1 at floor
    const u = 1 - t;
    const y = 0.051 - t * (0.051 - floorY);
    const r =
      t < 0.08
        ? 0.098 - WALL - t * 0.02
        : Math.max(0.078, outerRadiusAt(u) - WALL);
    push(r, y);
  }

  // Inner floor closed to axis
  push(0.078, floorY);
  push(0.0005, floorY);

  return pts;
}

function createPotLatheGeometry(): THREE.LatheGeometry {
  const pts = createThickPotProfile();
  const geo = new THREE.LatheGeometry(pts, 96);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Solid soil plug seating against the pot inner wall.
 * Domed top, closed bottom — not a zero-thickness disc.
 */
function createSoilGeometry(): THREE.BufferGeometry {
  // Match inner radius near soil height (outer wall − WALL − seat gap)
  const R = 0.091;
  const yBottom = FOOT_H + WALL + 0.0015;
  const yTop = POT_SOIL_LOCAL_Y;
  const dome = 0.0035;
  const pts: THREE.Vector2[] = [];
  const push = (r: number, y: number) =>
    pts.push(new THREE.Vector2(Math.max(0.0003, r), y));

  push(0.0004, yBottom);
  push(R, yBottom);
  // Slight draft; soil meets wall near the top
  push(R * 0.998, yTop - 0.0005);

  const topSamples = 16;
  for (let i = 0; i <= topSamples; i++) {
    const t = i / topSamples; // 0 edge → 1 center
    const r = R * 0.998 * (1 - t);
    const nr = r / (R * 0.998 || 1);
    const domeY = (1 - nr * nr) * dome;
    // Small central dimple for nebari
    const dimple = Math.exp(-((nr / 0.16) ** 2)) * 0.0016;
    push(r, yTop + domeY - dimple);
  }

  const geo = new THREE.LatheGeometry(pts, 80);
  geo.computeVertexNormals();
  return geo;
}

/** Soft mound around trunk base so nebari seats in soil. */
function createSoilMoundGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  // Wider / slightly taller to hug flared nebari without a hard soil disc cut
  const R = 0.028;
  const y0 = POT_SOIL_LOCAL_Y - 0.0006;
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const r = R * (1 - t);
    // Soft crown that peaks off-center so trunk flare sinks cleanly
    const h = Math.cos(t * Math.PI * 0.5) * 0.0062 * (0.85 + 0.15 * (1 - t));
    pts.push(new THREE.Vector2(Math.max(0.0003, r), y0 + h));
  }
  pts.push(new THREE.Vector2(0.0003, y0));
  pts.push(new THREE.Vector2(R, y0));
  const geo = new THREE.LatheGeometry(pts, 40);
  geo.computeVertexNormals();
  return geo;
}

/** Soft contact shadow under trunk on soil — no hard ink blot. */
function createTrunkContactShadow(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(32, 26, 20, 0.38)');
  g.addColorStop(0.35, 'rgba(32, 26, 20, 0.14)');
  g.addColorStop(0.75, 'rgba(32, 26, 20, 0.04)');
  g.addColorStop(1, 'rgba(32, 26, 20, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.022, 32), mat);
  mesh.name = 'trunkContactShadow';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, POT_SOIL_LOCAL_Y + 0.00015, 0);
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * Composed bonsai dressing: size hierarchy + light clustering.
 * Larger stones near rim/corners; finer grit near trunk; sparse moss hints.
 */
function placeComposedGrit(group: THREE.Group, gritMat: THREE.MeshStandardMaterial): void {
  const gritColors = [
    new THREE.Color('#8a6a50'),
    new THREE.Color('#6a6258'),
    new THREE.Color('#a89070'),
    new THREE.Color('#5a544c'),
    new THREE.Color('#b0a090'),
    new THREE.Color('#7a7060'),
    new THREE.Color('#9a8a72'),
  ];
  const mossColor = new THREE.Color('#5a6e48');

  type Spec = { ang: number; rad: number; size: number; moss?: boolean };
  const specs: Spec[] = [];

  // Rim / corner accent stones (larger)
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 + 0.31 + (i % 3) * 0.07;
    const rad = 0.068 + ((i * 5) % 7) * 0.0018;
    const size = 0.0032 + ((i * 3) % 4) * 0.00045;
    specs.push({ ang, rad, size });
  }

  // Mid-band medium clusters (3 loose clusters)
  for (let c = 0; c < 3; c++) {
    const cAng = (c / 3) * Math.PI * 2 + 0.9;
    const cRad = 0.038 + c * 0.006;
    for (let j = 0; j < 5; j++) {
      const ang = cAng + (j - 2) * 0.14 + ((c + j) % 2) * 0.05;
      const rad = cRad + ((j * 7 + c) % 5) * 0.0022 - 0.004;
      const size = 0.002 + ((j * 4 + c) % 4) * 0.00035;
      specs.push({ ang, rad: Math.max(0.018, Math.min(0.072, rad)), size });
    }
  }

  // Fine near-trunk grit (avoids cake-sprinkle even field)
  for (let i = 0; i < 18; i++) {
    const ang = (i / 18) * Math.PI * 2 + 0.17 + ((i * 11) % 5) * 0.04;
    const rad = 0.012 + ((i * 13) % 9) * 0.0016;
    const size = 0.0011 + ((i * 7) % 4) * 0.00022;
    specs.push({ ang, rad, size });
  }

  // Sparse intentional moss hints (not random candy green)
  const mossSpots: Array<[number, number]> = [
    [1.1, 0.055],
    [3.4, 0.048],
    [5.2, 0.062],
  ];
  for (const [ang, rad] of mossSpots) {
    specs.push({ ang, rad, size: 0.0024, moss: true });
  }

  for (let i = 0; i < specs.length; i++) {
    const { ang, rad, size, moss } = specs[i];
    if (rad > 0.084 || rad < 0.01) continue;
    const stone = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size, 1),
      gritMat.clone(),
    );
    const mat = stone.material as THREE.MeshStandardMaterial;
    if (moss) {
      mat.color.copy(mossColor);
      mat.roughness = 0.98;
    } else {
      mat.color.copy(gritColors[i % gritColors.length]);
      mat.roughness = 0.88 + (i % 4) * 0.03;
    }
    const elev = (1 - (rad / 0.09) ** 2) * 0.0038;
    // Embed slightly so grit doesn't float
    stone.position.set(
      Math.cos(ang) * rad,
      POT_SOIL_LOCAL_Y + elev + size * 0.12,
      Math.sin(ang) * rad,
    );
    stone.rotation.set(i * 0.7, i * 1.1, i * 0.4);
    stone.scale.set(
      1 + (i % 3) * 0.08,
      moss ? 0.55 : 0.82 + (i % 4) * 0.05,
      1 + ((i + 1) % 3) * 0.07,
    );
    stone.castShadow = false;
    stone.receiveShadow = true;
    stone.name = moss ? 'mossHint' : 'grit';
    group.add(stone);
  }
}

export function createPotGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'pot';
  // Single oval squash for pot + soil + grit so radii stay consistent
  group.scale.set(OVAL_X, 1, OVAL_Z);

  const potMat = createPotMaterial();
  const potInnerMat = createPotInnerMaterial();
  const soilMat = createSoilMaterial();
  const gritMat = createGritMaterial();

  // Watertight ceramic body
  // Does NOT cast shadows: a solid underside only ~FOOT_H above the pedestal
  // produces a huge soft PCF blob that reads as a detached "floating" shadow.
  // Feet cast the real contact shadows instead.
  const pot = new THREE.Mesh(createPotLatheGeometry(), potMat);
  pot.name = 'potBody';
  pot.castShadow = false;
  pot.receiveShadow = true;
  group.add(pot);

  // Dark matte inner liner just inside the cavity (unglazed clay read)
  {
    const linerPts: THREE.Vector2[] = [];
    const push = (r: number, y: number) =>
      linerPts.push(new THREE.Vector2(Math.max(0.0004, r), y));
    const inset = 0.0006;
    const bottomY = FOOT_H + WALL + 0.0012;
    const topY = 0.05;
    push(0.0005, bottomY);
    push(0.078 - inset, bottomY);
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = bottomY + t * (topY - bottomY);
      const u = 1 - t;
      const r = Math.max(0.076, outerRadiusAt(u) - WALL - inset);
      push(r, y);
    }
    push(0.095 - WALL - inset, topY + 0.0004);
    push(0.094 - WALL - inset * 2, topY);
    for (let i = n; i >= 0; i--) {
      const t = i / n;
      const y = bottomY + t * (topY - bottomY);
      const u = 1 - t;
      const r = Math.max(0.075, outerRadiusAt(u) - WALL - inset * 2.2);
      push(r, y);
    }
    push(0.0005, bottomY + 0.0003);
    const linerGeo = new THREE.LatheGeometry(linerPts, 64);
    linerGeo.computeVertexNormals();
    const liner = new THREE.Mesh(linerGeo, potInnerMat);
    liner.name = 'potInner';
    liner.castShadow = false;
    liner.receiveShadow = true;
    group.add(liner);
  }

  // Volumetric soil plug — receive only (same reason as pot body)
  const soil = new THREE.Mesh(createSoilGeometry(), soilMat);
  soil.name = 'soil';
  soil.receiveShadow = true;
  soil.castShadow = false;
  group.add(soil);

  // Nebari seating mound
  const mound = new THREE.Mesh(createSoilMoundGeometry(), soilMat);
  mound.name = 'soilMound';
  mound.receiveShadow = true;
  mound.castShadow = false;
  group.add(mound);

  // Soft trunk contact on soil (AO-like, no ink blot)
  group.add(createTrunkContactShadow());

  // Grit — designed surface: large edge stones, medium mid, fine near trunk.
  // Seed-stable placement (fixed formula, no Math.random).
  placeComposedGrit(group, gritMat);

  // Three short ceramic feet: bottoms on pedestal (y=0)
  const footMat = potMat.clone();
  footMat.roughness = 0.9;
  footMat.envMapIntensity = 0.22;
  const footR = 0.058;
  const footPositions: Array<[number, number]> = [];
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const fx = Math.cos(ang) * footR;
    const fz = Math.sin(ang) * footR;
    footPositions.push([fx, fz]);
    const foot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.008, FOOT_H, 16),
      footMat,
    );
    foot.position.set(fx, FOOT_H * 0.5, fz);
    foot.castShadow = true;
    foot.receiveShadow = true;
    group.add(foot);
  }

  // Micro contact AO under each foot only (no full-body disc — that reads as a
  // detached streak under front/low ortho). Feet cast real sun shadows.
  {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(28, 22, 18, 0.48)');
    g.addColorStop(0.4, 'rgba(28, 22, 18, 0.16)');
    g.addColorStop(1, 'rgba(28, 22, 18, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const footShadowMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    for (const [fx, fz] of footPositions) {
      const blob = new THREE.Mesh(
        new THREE.CircleGeometry(0.016, 24),
        footShadowMat,
      );
      blob.rotation.x = -Math.PI / 2;
      blob.position.set(fx, 0.0004, fz);
      blob.scale.set(1 / OVAL_X, 1 / OVAL_Z, 1);
      blob.name = 'footContactShadow';
      blob.castShadow = false;
      blob.receiveShadow = false;
      group.add(blob);
    }
  }

  return group;
}

/**
 * Finite room stage: soft plaster/washi wall + floor mat + short pedestal.
 * Quiet negative space; tree remains hero (backdrop ~1 stop quieter).
 * Pot/tree are raised by PEDESTAL_HEIGHT in the scene stage.
 */
export function createStudioBase(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'studioBase';

  const groundMat = createGroundMaterial();
  const pedestalMat = createPedestalMaterial();

  // Finite floor mat (not infinite product disc) — soft plaster / linen
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 80),
    groundMat,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // Soft falloff ring beyond the mat (reads as room floor edge, not void cliff)
  {
    const ringCanvas = document.createElement('canvas');
    ringCanvas.width = ringCanvas.height = 128;
    const rctx = ringCanvas.getContext('2d')!;
    const rg = rctx.createRadialGradient(64, 64, 40, 64, 64, 64);
    rg.addColorStop(0, 'rgba(200, 194, 184, 0.55)');
    rg.addColorStop(0.55, 'rgba(190, 184, 174, 0.22)');
    rg.addColorStop(1, 'rgba(180, 174, 164, 0)');
    rctx.fillStyle = rg;
    rctx.fillRect(0, 0, 128, 128);
    const ringTex = new THREE.CanvasTexture(ringCanvas);
    ringTex.colorSpace = THREE.SRGBColorSpace;
    const ring = new THREE.Mesh(
      new THREE.CircleGeometry(1.55, 64),
      new THREE.MeshBasicMaterial({
        map: ringTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.0004;
    ring.name = 'floorFalloff';
    group.add(ring);
  }

  // Soft plaster/washi back wall — tokonoma shelf feel, 1-stop quieter
  {
    const wallMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#d8d4cc'),
      roughness: 0.96,
      metalness: 0,
      envMapIntensity: 0.08,
    });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.15), wallMat);
    wall.position.set(0, 0.42, -0.72);
    wall.receiveShadow = true;
    wall.castShadow = false;
    wall.name = 'roomWall';
    group.add(wall);

    // Soft corner return (left) — finite stage, not cyclorama
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.15), wallMat);
    side.position.set(-0.78, 0.42, -0.28);
    side.rotation.y = Math.PI * 0.42;
    side.receiveShadow = true;
    side.name = 'roomWallSide';
    group.add(side);
  }

  // Soft contact shadow under pedestal
  const contactCanvas = document.createElement('canvas');
  contactCanvas.width = contactCanvas.height = 128;
  const cctx = contactCanvas.getContext('2d')!;
  const grad = cctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, 'rgba(40, 34, 28, 0.45)');
  grad.addColorStop(0.45, 'rgba(40, 34, 28, 0.18)');
  grad.addColorStop(1, 'rgba(40, 34, 28, 0)');
  cctx.fillStyle = grad;
  cctx.fillRect(0, 0, 128, 128);
  const contactTex = new THREE.CanvasTexture(contactCanvas);
  contactTex.colorSpace = THREE.SRGBColorSpace;
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 64),
    new THREE.MeshBasicMaterial({
      map: contactTex,
      transparent: true,
      depthWrite: false,
      opacity: 1,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.0006;
  group.add(contact);

  // Pedestal top face must sit exactly at PEDESTAL_HEIGHT so pot feet (stage y=0)
  // rest flush. Overlapping ped/cap slabs caused shadow acne and detached blobs.
  const pedH = PEDESTAL_HEIGHT;
  const capH = 0.003;
  const bodyH = Math.max(0.008, pedH - capH);

  const ped = new THREE.Mesh(
    new THREE.CylinderGeometry(0.116, 0.124, bodyH, 64, 1, false),
    pedestalMat,
  );
  ped.position.y = bodyH * 0.5;
  ped.castShadow = true;
  ped.receiveShadow = true;
  group.add(ped);

  // Cap sits on body; top face y = bodyH + capH = pedH
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.114, 0.116, capH, 64, 1, false),
    pedestalMat,
  );
  cap.position.y = bodyH + capH * 0.5;
  cap.castShadow = false; // body already casts; avoid double-caster acne
  cap.receiveShadow = true;
  group.add(cap);

  return group;
}

/** @deprecated Prefer createStudioBase — kept for any external callers. */
export function createGround(): THREE.Mesh {
  const geo = new THREE.CircleGeometry(2.4, 96);
  const mat = createGroundMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}
