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
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: barkRough,
    // Slightly less matte so form + garden IBL open the key face
    roughness: 0.88,
    metalness: 0.01,
    // Lifted midtone — dark map × old #8a6e52 read as muddy black in shadow
    color: new THREE.Color('#a08260'),
    envMapIntensity: 0.38,
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
    // Brighter scale map so pads keep midtone on the key face (was near-black)
    foliageMature = createFoliageAlbedoTexture([46, 98, 52]);
  }
  return new THREE.MeshPhysicalMaterial({
    map: foliageMature,
    color: new THREE.Color('#4f8248'),
    roughness: 0.8,
    metalness: 0,
    // Edge scatter / tip light without plastic wrap
    sheen: 0.32,
    sheenRoughness: 0.62,
    sheenColor: new THREE.Color('#7aab58'),
    side: THREE.DoubleSide,
    // Cutout only — avoid transparent sorting glow that reads as plastic wrap
    transparent: false,
    alphaTest: 0.42,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function createFoliageTipMaterial(): THREE.MeshPhysicalMaterial {
  if (!foliageTip) {
    foliageTip = createFoliageAlbedoTexture([68, 122, 52]);
  }
  return new THREE.MeshPhysicalMaterial({
    map: foliageTip,
    color: new THREE.Color('#6a9a52'),
    roughness: 0.72,
    metalness: 0,
    sheen: 0.4,
    sheenRoughness: 0.48,
    sheenColor: new THREE.Color('#9ccc68'),
    side: THREE.DoubleSide,
    transparent: false,
    alphaTest: 0.4,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/** Soft matte ceramic — low clearcoat so zen-garden IBL reads as soft glaze. */
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
    roughness: 0.68,
    metalness: 0.05,
    envMapIntensity: 0.55,
    side: THREE.FrontSide,
  });
}

/** Unglazed interior clay — darker, matte, low IBL response. */
export function createPotInnerMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#4a342c'),
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.12,
    side: THREE.DoubleSide,
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
    color: new THREE.Color('#8a7a62'),
    roughness: 0.98,
    metalness: 0,
    envMapIntensity: 0.15,
  });
}

export function createGritMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#8a7860'),
    roughness: 0.92,
    metalness: 0.02,
  });
}

/** Dull aluminum / copper training wire — higher env response for garden IBL. */
export function createWireMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#b0a090'),
    roughness: 0.45,
    metalness: 0.84,
    clearcoat: 0.08,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.85,
  });
}

/**
 * Soft warm-ink selection — attention without neon laser energy.
 * Low-sat moss wash readable on dark bark and green pads.
 */
export function createHighlightMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color('#8a7a5c'),
    transparent: true,
    opacity: 0.32,
    depthTest: true,
    depthWrite: false,
    // Additive would read plastic; keep normal blend with thin overscale mesh
  });
}

/** Optional thin ink rim companion (slightly cooler, lower opacity). */
export function createHighlightRimMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color('#5c5348'),
    transparent: true,
    opacity: 0.22,
    depthTest: true,
    depthWrite: false,
    side: THREE.BackSide,
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
    envMapIntensity: 0.28,
  });
}
