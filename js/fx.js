// Shared bloom post-processing for the neon look
import * as THREE from 'three';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';

export const lowPower = matchMedia('(max-width: 700px)').matches || (navigator.hardwareConcurrency || 8) <= 4;

export function createBloom(renderer, scene, camera, { strength = 1.1, radius = 0.5, threshold = 0.15 } = {}) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), strength, radius, threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return {
    bloom,
    render: () => composer.render(),
    setSize: (w, h) => {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      // bloom at reduced resolution keeps phones smooth
      bloom.resolution.set(w / (lowPower ? 3 : 2), h / (lowPower ? 3 : 2));
    },
  };
}
