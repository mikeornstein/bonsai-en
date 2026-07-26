import * as THREE from 'three';
import {
  createGroundMaterial,
  createGritMaterial,
  createPedestalMaterial,
  createPotMaterial,
  createSoilMaterial,
} from './materials';

/** Height of the stone pedestal; pot + tree sit on top via scene stage. */
export const PEDESTAL_HEIGHT = 0.032;

/** Soil surface Y in pot-local space (tree root offset). */
export const POT_SOIL_LOCAL_Y = 0.052;

/**
 * Classic training bonsai pot via lathe: flared wall, refined rim, slight foot.
 * Slight oval squash for a natural ceramic read.
 */
function createPotLatheGeometry(): THREE.LatheGeometry {
  // Profile: x = radius, y = height — soft flare, rolled rim (no flat white cap)
  const pts: THREE.Vector2[] = [];
  const h = 0.056;
  const samples = 32;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    let r: number;
    let y = t * h;
    if (t < 0.1) {
      // Foot
      r = 0.07 + (t / 0.1) * 0.012;
    } else if (t < 0.82) {
      const u = (t - 0.1) / 0.72;
      r = 0.082 + u * 0.016 + Math.sin(u * Math.PI) * 0.003;
    } else if (t < 0.94) {
      // Rim rolls outward then slightly up
      const u = (t - 0.82) / 0.12;
      r = 0.098 + Math.sin(u * Math.PI * 0.5) * 0.006;
      y = h * 0.82 + u * h * 0.12;
    } else {
      // Rim tip curls slightly inward (avoids bright flat top)
      const u = (t - 0.94) / 0.06;
      r = 0.104 - u * 0.004;
      y = h * 0.94 + u * h * 0.04;
    }
    pts.push(new THREE.Vector2(r, y));
  }
  const geo = new THREE.LatheGeometry(pts, 80);
  geo.computeVertexNormals();
  return geo;
}

export function createPotGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'pot';

  const potMat = createPotMaterial();
  const soilMat = createSoilMaterial();
  const gritMat = createGritMaterial();

  // Body — oval squash (classic training pot)
  const pot = new THREE.Mesh(createPotLatheGeometry(), potMat);
  pot.scale.set(1.08, 1, 0.92);
  pot.castShadow = true;
  pot.receiveShadow = true;
  group.add(pot);

  // Inner rim ledge (matte darker clay)
  const innerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#4a3228'),
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.086, 0.084, 0.01, 48, 1, true),
    innerMat,
  );
  inner.scale.set(1.08, 1, 0.92);
  inner.position.y = 0.05;
  group.add(inner);

  // Slightly domed soil disc
  const soilGeo = new THREE.CircleGeometry(0.082, 64);
  // Lift center vertices for a soft dome
  const pos = soilGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.hypot(x, y) / 0.082;
    pos.setZ(i, (1 - r * r) * 0.004);
  }
  soilGeo.computeVertexNormals();
  const soil = new THREE.Mesh(soilGeo, soilMat);
  soil.rotation.x = -Math.PI / 2;
  soil.scale.set(1.08, 0.92, 1);
  soil.position.y = POT_SOIL_LOCAL_Y;
  soil.receiveShadow = true;
  soil.castShadow = false;
  group.add(soil);

  // Dense grit stones — rounded pebbles (icosa / sphere-ish)
  const gritColors = [
    new THREE.Color('#8a6a50'),
    new THREE.Color('#6a6258'),
    new THREE.Color('#a89070'),
    new THREE.Color('#5a544c'),
    new THREE.Color('#b0a090'),
  ];
  const gritCount = 36;
  for (let i = 0; i < gritCount; i++) {
    const ang = (i / gritCount) * Math.PI * 2 + (i % 7) * 0.17;
    const rad = 0.012 + ((i * 17) % 11) * 0.0055;
    if (rad > 0.078) continue;
    const size = 0.0016 + ((i * 13) % 5) * 0.00085;
    // Higher subdivision = smoother pebble
    const stone = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size, 1),
      gritMat.clone(),
    );
    (stone.material as THREE.MeshStandardMaterial).color.copy(
      gritColors[i % gritColors.length],
    );
    (stone.material as THREE.MeshStandardMaterial).roughness =
      0.85 + (i % 4) * 0.04;
    const elev = (1 - (rad / 0.082) ** 2) * 0.004;
    stone.position.set(
      Math.cos(ang) * rad * 1.08,
      POT_SOIL_LOCAL_Y + elev + size * 0.35,
      Math.sin(ang) * rad * 0.92,
    );
    stone.rotation.set(i * 0.7, i * 1.1, i * 0.4);
    stone.scale.set(
      1 + (i % 3) * 0.15,
      0.7 + (i % 4) * 0.1,
      1 + ((i + 1) % 3) * 0.12,
    );
    stone.castShadow = true;
    stone.receiveShadow = true;
    group.add(stone);
  }

  // Soft dark rim band — kills bright rim specular, reads as ceramic lip
  const rimMat = potMat.clone();
  rimMat.color = new THREE.Color('#6a4838');
  rimMat.roughness = 0.82;
  rimMat.envMapIntensity = 0.2;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.1, 0.004, 10, 64),
    rimMat,
  );
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(1.08, 0.92, 1);
  rim.position.y = 0.054;
  rim.castShadow = true;
  group.add(rim);

  // Three small ceramic feet under pot
  const footMat = potMat.clone();
  footMat.roughness = 0.85;
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const foot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.0075, 0.006, 12),
      footMat,
    );
    foot.position.set(Math.cos(ang) * 0.055, 0.003, Math.sin(ang) * 0.048);
    foot.castShadow = true;
    foot.receiveShadow = true;
    group.add(foot);
  }

  return group;
}

/**
 * Seamless pale studio floor + short stone pedestal.
 * Pot/tree are raised by PEDESTAL_HEIGHT in the scene stage.
 */
export function createStudioBase(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'studioBase';

  const groundMat = createGroundMaterial();
  const pedestalMat = createPedestalMaterial();

  // Large seamless ground (product cyclorama floor)
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 96),
    groundMat,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // Soft contact shadow under pedestal (radial falloff disc)
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

  // Short cylindrical stone pedestal with slight bevel via two stacked discs
  const pedH = PEDESTAL_HEIGHT;
  const ped = new THREE.Mesh(
    new THREE.CylinderGeometry(0.118, 0.125, pedH, 64, 1, false),
    pedestalMat,
  );
  ped.position.y = pedH * 0.5;
  ped.castShadow = true;
  ped.receiveShadow = true;
  group.add(ped);

  // Thin top cap for a refined edge read
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.116, 0.118, 0.004, 64, 1, false),
    pedestalMat,
  );
  cap.position.y = pedH - 0.001;
  cap.castShadow = true;
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
