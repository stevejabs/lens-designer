'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Real-time GLB viewer: orbit-controlled, auto-framed, lit.
 *  `interactive=false` (thumbnails) disables controls + pointer capture. */
export function GLBViewer({ dataUrl, interactive = true }: { dataUrl: string; interactive?: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let w = mount.clientWidth || 600;
    let h = mount.clientHeight || 400;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);

    // Image-based lighting so glTF PBR materials (metalness/roughness) read
    // correctly instead of rendering flat.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 6, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.6);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = interactive ? 1.2 : 2.4;
    controls.enabled = interactive;
    if (!interactive) renderer.domElement.style.pointerEvents = 'none';

    let disposed = false;
    let raf = 0;
    try {
      const loader = new GLTFLoader();
      loader.parse(
        base64ToArrayBuffer(dataUrl.split(',')[1] ?? ''),
        '',
        (gltf) => {
          if (disposed) return;
          const model = gltf.scene;
          // Ensure baked glTF textures render: correct color space, keep IBL
          // from washing out the diffuse, flag for update. (Diagnostic counts
          // exposed on the mount for self-verification.)
          let meshCount = 0;
          let mapCount = 0;
          model.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            meshCount++;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of mats) {
              const std = mat as THREE.MeshStandardMaterial;
              if (std.map) {
                mapCount++;
                std.map.colorSpace = THREE.SRGBColorSpace;
              }
              if ('envMapIntensity' in std) std.envMapIntensity = 0.5;
              std.needsUpdate = true;
            }
          });
          mount.dataset['meshes'] = String(meshCount);
          mount.dataset['maps'] = String(mapCount);

          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          model.position.sub(center);
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          camera.position.set(maxDim * 0.9, maxDim * 0.6, maxDim * 1.8);
          controls.target.set(0, 0, 0);
          controls.update();
          scene.add(model);
        },
        () => {
          /* parse error — leave the empty stage */
        },
      );
    } catch {
      /* ignore */
    }

    const animate = (): void => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = (): void => {
      if (!mount) return;
      w = mount.clientWidth;
      h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [dataUrl, interactive]);

  return <div ref={mountRef} className="absolute inset-0" />;
}
