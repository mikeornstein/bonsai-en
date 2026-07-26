import * as THREE from 'three';

export function createBarkMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#8b5a3c'),
    roughness: 0.88,
    metalness: 0.02,
    flatShading: false,
  });
}

export function createFoliageMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#3d6b3a'),
    roughness: 0.78,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
}

export function createFoliageTipMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#5a8f4a'),
    roughness: 0.72,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
}

export function createPotMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7a4030'),
    roughness: 0.72,
    metalness: 0.04,
  });
}

export function createSoilMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#4a3428'),
    roughness: 1,
    metalness: 0,
  });
}

export function createWireMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d4b45c'),
    roughness: 0.4,
    metalness: 0.6,
  });
}

export function createHighlightMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color('#b8ff8a'),
    transparent: true,
    opacity: 0.45,
    depthTest: true,
  });
}
