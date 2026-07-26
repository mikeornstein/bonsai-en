import * as THREE from 'three';
import {
  createBarkAlbedoTexture,
  createBarkNormalTexture,
  createBarkRoughnessTexture,
  createFoliageAlbedoTexture,
  createGroundAlbedoTexture,
  createPedestalAlbedoTexture,
  createPotAlbedoTexture,
  createPotNormalTexture,
  createPotRoughnessTexture,
  createSoilAlbedoTexture,
  createSoilNormalTexture,
} from './textures';

let barkAlbedo: THREE.CanvasTexture | null = null;
let barkNormal: THREE.CanvasTexture | null = null;
let barkRough: THREE.CanvasTexture | null = null;
let foliageMature: THREE.CanvasTexture | null = null;
let foliageTip: THREE.CanvasTexture | null = null;
let soilAlbedo: THREE.CanvasTexture | null = null;
let soilNormal: THREE.CanvasTexture | null = null;
let potAlbedo: THREE.CanvasTexture | null = null;
let potNormal: THREE.CanvasTexture | null = null;
let potRough: THREE.CanvasTexture | null = null;
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
    normalScale: new THREE.Vector2(1.35, 1.35),
    roughnessMap: barkRough,
    roughness: 0.92,
    metalness: 0.02,
    color: new THREE.Color('#a88868'),
  });
}

/**
 * Lightweight bark variant — color/roughness only, shared maps.
 * Avoids cloning textures per segment (was a major rebuild cost).
 */
export function barkMaterialForSegment(
  base: THREE.MeshStandardMaterial,
  _length: number,
  radius: number,
): THREE.MeshStandardMaterial {
  const mat = base.clone();
  // Shared map references (do NOT clone textures)
  mat.map = base.map;
  mat.normalMap = base.normalMap;
  mat.roughnessMap = base.roughnessMap;
  // Thin shoots slightly smoother
  if (radius < 0.0035) {
    mat.roughness = 0.75;
  }
  return mat;
}

export function createFoliageMaterial(): THREE.MeshPhysicalMaterial {
  if (!foliageMature) {
    foliageMature = createFoliageAlbedoTexture([32, 78, 38]);
  }
  return new THREE.MeshPhysicalMaterial({
    map: foliageMature,
    color: new THREE.Color('#4a7a42'),
    roughness: 0.8,
    metalness: 0,
    sheen: 0.28,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color('#7aaa5a'),
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.28,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function createFoliageTipMaterial(): THREE.MeshPhysicalMaterial {
  if (!foliageTip) {
    foliageTip = createFoliageAlbedoTexture([55, 108, 42]);
  }
  return new THREE.MeshPhysicalMaterial({
    map: foliageTip,
    color: new THREE.Color('#6a9e52'),
    roughness: 0.72,
    metalness: 0,
    sheen: 0.38,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#9ccc68'),
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.28,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/** Soft matte ceramic — no clearcoat (avoids blown white rim under IBL). */
export function createPotMaterial(): THREE.MeshStandardMaterial {
  if (!potAlbedo) potAlbedo = createPotAlbedoTexture();
  if (!potNormal) potNormal = createPotNormalTexture();
  if (!potRough) potRough = createPotRoughnessTexture();
  return new THREE.MeshStandardMaterial({
    map: potAlbedo,
    normalMap: potNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughnessMap: potRough,
    color: new THREE.Color('#a87860'),
    roughness: 0.72,
    metalness: 0.04,
    envMapIntensity: 0.4,
  });
}

export function createSoilMaterial(): THREE.MeshStandardMaterial {
  if (!soilAlbedo) {
    soilAlbedo = createSoilAlbedoTexture();
    soilAlbedo.repeat.set(2.5, 2.5);
  }
  if (!soilNormal) {
    soilNormal = createSoilNormalTexture();
    soilNormal.repeat.set(2.5, 2.5);
  }
  return new THREE.MeshStandardMaterial({
    map: soilAlbedo,
    normalMap: soilNormal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    color: new THREE.Color('#9a8a72'),
    roughness: 0.97,
    metalness: 0,
  });
}

export function createGritMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#8a7860'),
    roughness: 0.92,
    metalness: 0.02,
  });
}

/** Dull aluminum / copper training wire. */
export function createWireMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#b0a090'),
    roughness: 0.48,
    metalness: 0.82,
    clearcoat: 0.08,
    clearcoatRoughness: 0.5,
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
