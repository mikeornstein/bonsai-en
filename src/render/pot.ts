import * as THREE from 'three';
import {
  createGroundMaterial,
  createPedestalMaterial,
  createPotMaterial,
  createSoilMaterial,
} from './materials';

/** Height of the stone pedestal; pot + tree sit on top via scene stage. */
export const PEDESTAL_HEIGHT = 0.032;

export function createPotGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'pot';

  const potMat = createPotMaterial();
  const soilMat = createSoilMaterial();

  // Training pot — slightly flared oval profile via lathe-ish cylinder
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.092, 0.072, 0.058, 64, 1, false),
    potMat,
  );
  pot.position.y = 0.029;
  pot.castShadow = true;
  pot.receiveShadow = true;
  group.add(pot);

  // Lip
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.092, 0.0055, 14, 64),
    potMat,
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.057;
  rim.castShadow = true;
  group.add(rim);

  // Inner wall shadow band
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.084, 0.084, 0.012, 48, 1, true),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#3a2218'),
      roughness: 0.9,
      metalness: 0,
      side: THREE.BackSide,
    }),
  );
  inner.position.y = 0.05;
  group.add(inner);

  // Soil surface (slightly domed)
  const soil = new THREE.Mesh(
    new THREE.CircleGeometry(0.083, 64),
    soilMat,
  );
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 0.052;
  soil.receiveShadow = true;
  group.add(soil);

  // A few grit stones on soil
  const gritMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#8a6a50'),
    roughness: 0.9,
  });
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + i * 0.3;
    const rad = 0.02 + (i % 5) * 0.01;
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.003 + (i % 3) * 0.0012, 0),
      gritMat,
    );
    stone.position.set(Math.cos(ang) * rad, 0.054, Math.sin(ang) * rad);
    stone.rotation.set(i, i * 0.7, i * 0.3);
    stone.castShadow = true;
    stone.receiveShadow = true;
    group.add(stone);
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

  // Soft shadow catcher ring under pedestal (slightly darker, same plane)
  const catcher = new THREE.Mesh(
    new THREE.RingGeometry(0.1, 0.22, 64),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#b8b2a8'),
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.0004;
  catcher.receiveShadow = true;
  group.add(catcher);

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
