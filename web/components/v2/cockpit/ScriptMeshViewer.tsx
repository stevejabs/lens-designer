'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SceneDescription } from '@/lib/v2/script-mesh/runtime';

/** Renders a scripted mesh's extracted geometry (from the shimmed Lens runtime)
 *  in three.js — the native, non-destructive alternative to a Lens Studio
 *  preview screenshot. Mirrors GLBViewer's lighting/orbit scaffolding. */
export function ScriptMeshViewer({ description, interactive = true }: { description: SceneDescription; interactive?: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let w = mount.clientWidth || 600;
    let h = mount.clientHeight || 400;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);

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

    const group = new THREE.Group();
    for (const m of description.meshes) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
      if (m.normals.length === m.positions.length)
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
      else geo.computeVertexNormals();
      if (m.uvs.length > 0) geo.setAttribute('uv', new THREE.Float32BufferAttribute(m.uvs, 2));
      geo.setIndex(m.indices);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(m.baseColor[0], m.baseColor[1], m.baseColor[2]),
        metalness: m.metallic,
        roughness: m.roughness,
        envMapIntensity: 0.6,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.applyMatrix4(new THREE.Matrix4().fromArray(m.matrix));
      group.add(mesh);
    }
    mount.dataset['nativeMeshes'] = String(description.meshes.length);

    // Frame the model.
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    camera.position.set(maxDim * 0.9, maxDim * 0.6, maxDim * 1.8);
    controls.target.set(0, 0, 0);
    controls.update();
    scene.add(group);

    let raf = 0;
    const animate = (): void => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = (): void => {
      w = mount.clientWidth;
      h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      pmrem.dispose();
      renderer.dispose();
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((mm) => mm.dispose());
        }
      });
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [description, interactive]);

  return <div ref={mountRef} className="absolute inset-0" />;
}
