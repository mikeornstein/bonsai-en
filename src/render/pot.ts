import * as THREE from 'three';
import {
  createGroundMaterial,
  createPotMaterial,
  createSoilMaterial,
} from './materials';

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

export function createGround(): THREE.Mesh {
  const geo = new THREE.CircleGeometry(1.8, 64);
  const mat = createGroundMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}
