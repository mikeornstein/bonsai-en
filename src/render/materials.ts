import * as THREE from 'three';
import {
  createBarkAlbedoTexture,
  createBarkNormalTexture,
  createBarkRoughnessTexture,
  createFoliageAlbedoTexture,
  createGroundAlbedoTexture,
  createPedestalAlbedoTexture,
  createPotAlbedoTexture,
  createSoilAlbedoTexture,
} from './textures';

let barkAlbedo: THREE.CanvasTexture | null = null;
let barkNormal: THREE.CanvasTexture | null = null;
let barkRough: THREE.CanvasTexture | null = null;
let foliageMature: THREE.CanvasTexture | null = null;
let foliageTip: THREE.CanvasTexture | null = null;
let soilAlbedo: THREE.CanvasTexture | null = null;
let potAlbedo: THREE.CanvasTexture | null = null;
let groundAlbedo: THREE.CanvasTexture | null = null;
let pedestalAlbedo: THREE.CanvasTexture | null = null;

function barkMaps() {
  if (!barkAlbedo) {
    barkAlbedo = createBarkAlbedoTexture();
    barkAlbedo.repeat.set(2, 3);
    barkNormal = createBarkNormalTexture();
    barkNormal.repeat.set(2, 3);
    barkRough = createBarkRoughnessTexture();
    barkRough.repeat.set(2, 3);
  }
  return { barkAlbedo: barkAlbedo!, barkNormal: barkNormal!, barkRough: barkRough! };
}

export function createBarkMaterial(): THREE.MeshStandardMaterial {
  const { barkAlbedo, barkNormal, barkRough } = barkMaps();
  return new THREE.MeshStandardMaterial({
    map: barkAlbedo,
    normalMap: barkNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: barkRough,
    roughness: 1,
    metalness: 0.02,
    color: new THREE.Color('#c4a080'), // multiplies texture
  });
}

/** Clone bark material with UV repeat scaled to segment proportions. */
export function barkMaterialForSegment(
  base: THREE.MeshStandardMaterial,
  length: number,
  radius: number,
): THREE.MeshStandardMaterial {
  const mat = base.clone();
  const circ = Math.max(0.01, 2 * Math.PI * radius);
  const uRepeat = Math.max(0.8, circ / 0.025);
  const vRepeat = Math.max(0.6, length / 0.02);
  if (mat.map) {
    mat.map = mat.map.clone();
    mat.map.repeat.set(uRepeat, vRepeat);
    mat.map.needsUpdate = true;
  }
  if (mat.normalMap) {
    mat.normalMap = mat.normalMap.clone();
    mat.normalMap.repeat.set(uRepeat, vRepeat);
    mat.normalMap.needsUpdate = true;
  }
  if (mat.roughnessMap) {
    mat.roughnessMap = mat.roughnessMap.clone();
    mat.roughnessMap.repeat.set(uRepeat, vRepeat);
    mat.roughnessMap.needsUpdate = true;
  }
  // Younger wood slightly greener / smoother
  return mat;
}

export function createFoliageMaterial(): THREE.MeshStandardMaterial {
  if (!foliageMature) {
    foliageMature = createFoliageAlbedoTexture([45, 95, 48]);
  }
  return new THREE.MeshStandardMaterial({
    map: foliageMature,
    color: new THREE.Color('#7aab68'),
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.15,
    depthWrite: true,
    // Avoid alpha sorting flicker on dense pads
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function createFoliageTipMaterial(): THREE.MeshStandardMaterial {
  if (!foliageTip) {
    foliageTip = createFoliageAlbedoTexture([70, 130, 55]);
  }
  return new THREE.MeshStandardMaterial({
    map: foliageTip,
    color: new THREE.Color('#9ccc78'),
    roughness: 0.75,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.15,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function createPotMaterial(): THREE.MeshStandardMaterial {
  if (!potAlbedo) potAlbedo = createPotAlbedoTexture();
  // Physical-leaning standard: responds better under IBL until ceramic PR
  return new THREE.MeshStandardMaterial({
    map: potAlbedo,
    color: new THREE.Color('#c4a090'),
    roughness: 0.48,
    metalness: 0.04,
  });
}

export function createSoilMaterial(): THREE.MeshStandardMaterial {
  if (!soilAlbedo) {
    soilAlbedo = createSoilAlbedoTexture();
    soilAlbedo.repeat.set(3, 3);
  }
  return new THREE.MeshStandardMaterial({
    map: soilAlbedo,
    color: new THREE.Color('#a89880'),
    roughness: 0.98,
    metalness: 0,
  });
}

export function createWireMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d4b45c'),
    roughness: 0.35,
    metalness: 0.65,
  });
}

export function createHighlightMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color('#b8ff8a'),
    transparent: true,
    opacity: 0.4,
    depthTest: true,
  });
}

/** Seamless product-studio floor — pale warm stone/linen. */
export function createGroundMaterial(): THREE.MeshStandardMaterial {
  if (!groundAlbedo) {
    groundAlbedo = createGroundAlbedoTexture();
    groundAlbedo.repeat.set(6, 6);
  }
  return new THREE.MeshStandardMaterial({
    map: groundAlbedo,
    color: new THREE.Color('#e4dfd6'),
    roughness: 0.92,
    metalness: 0,
  });
}

/** Short stone pedestal under the pot. */
export function createPedestalMaterial(): THREE.MeshStandardMaterial {
  if (!pedestalAlbedo) {
    pedestalAlbedo = createPedestalAlbedoTexture();
    pedestalAlbedo.repeat.set(2, 1);
  }
  return new THREE.MeshStandardMaterial({
    map: pedestalAlbedo,
    color: new THREE.Color('#d0cbc2'),
    roughness: 0.78,
    metalness: 0.02,
  });
}
