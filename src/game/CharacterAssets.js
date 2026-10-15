import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TextureLoader, SRGBColorSpace, LinearFilter } from 'three';

export function normalizeAnimationClips(clips) {
  for (const clip of clips) {
    const start = Math.min(...clip.tracks.map(track => track.times[0]));
    for (const track of clip.tracks) {
      // glTF accessors can be shared across tracks AND across clips.
      track.times = track.times.slice();
      for (let i = 0; i < track.times.length; i++) track.times[i] -= start;
    }
    clip.resetDuration();
  }
}

export async function loadCharacterAssets() {
  const loader = new GLTFLoader();
  const assets = {};
  const names = ['batter', 'fielder', 'crowd'];
  const textureLoader = new TextureLoader();
  const results = await Promise.allSettled([...names.map(async name => {
    const asset = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`);
    normalizeAnimationClips(asset.animations);
    assets[name] = asset;
  }), ...['crowd-atlas', 'crowd-mask'].map(async name => {
    const texture = await textureLoader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.png`);
    if (name === 'crowd-atlas') texture.colorSpace = SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    assets[name] = texture;
  })]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) {
    disposeResources(Object.values(assets).flatMap(asset => asset.scene ? [asset.scene] : []),
      Object.values(assets).filter(asset => asset.isTexture));
    throw new Error('Cricket character assets could not load. Reload the page, or play the classic Canvas version.',
      { cause: failure.reason });
  }
  return assets;
}

export function disposeResources(roots, extraTextures = []) {
  const geometries = new Set(), materials = new Set(), textures = new Set(extraTextures), skeletons = new Set();
  const instances = new Set(), images = new Set();
  for (const root of roots) root.traverse(object => {
    if (object.shadow) object.shadow.dispose();
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    if (object.isInstancedMesh) instances.add(object);
    if (!object.material) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  instances.forEach(instance => instance.dispose());
  skeletons.forEach(skeleton => skeleton.dispose());
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => {
    if (typeof texture.image?.close === 'function') images.add(texture.image);
    texture.dispose();
  });
  images.forEach(image => image.close());
}
