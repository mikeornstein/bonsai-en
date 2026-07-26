import * as THREE from 'three';
import { createPotMaterial, createSoilMaterial } from './materials';

export function createPotGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'pot';

  const potMat = createPotMaterial();
  const soilMat = createSoilMaterial();

  // Training pot — shallow oval-ish cylinder
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.075, 0.055, 48, 1, false),
    potMat,
  );
  pot.position.y = 0.027;
  pot.castShadow = true;
  pot.receiveShadow = true;
  group.add(pot);

  // Rim
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.09, 0.006, 12, 48),
    potMat,
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.055;
  rim.castShadow = true;
  group.add(rim);

  // Soil surface
  const soil = new THREE.Mesh(
    new THREE.CircleGeometry(0.082, 48),
    soilMat,
  );
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 0.052;
  soil.receiveShadow = true;
  group.add(soil);

  // Slightly recessed floor for ground contact shadow
  return group;
}

export function createGround(): THREE.Mesh {
  const geo = new THREE.CircleGeometry(1.6, 64);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1e2a1c'),
    roughness: 1,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}
