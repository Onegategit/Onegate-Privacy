import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { progressOf, stateAt } from './flight';

const vertex = 'void main(){gl_Position=vec4(position.xy,0.,1.);}';
// The supplied artwork, redrawn live: sky, a pinched dark slot, warm light on its straight edges, grain.
const fragment = `
precision highp float;
uniform vec2 uRes, uPointer;
uniform float uTime, uBar, uFlat, uSlope, uGlow, uBlur, uFlash;
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){
  float m=min(uRes.x,uRes.y);
  vec2 p=(gl_FragCoord.xy-.5*uRes)/m+uPointer*.004;
  float ax=abs(p.x), wedge=max(0.,ax-uFlat);
  float d=abs(p.y)-(uBar+uSlope*wedge);
  float soft=uBlur*(1.+2.4*smoothstep(0.,.5,wedge));
  float gate=1.-smoothstep(-soft,soft,d), s=max(d,0.);
  vec3 sky=mix(vec3(.93,.968,.996),vec3(.66,.82,.99),smoothstep(0.,.2,s));
  sky=mix(sky,vec3(.49,.725,.99),smoothstep(.18,.6,s));
  vec3 col=mix(sky,vec3(.006,.01,.05),gate);
  float along=1.-smoothstep(uFlat-.02,uFlat+.16,ax);
  float eh=.05+.035*min(uGlow,1.)+soft;
  float q=clamp(d/eh,0.,1.);
  vec3 ec=mix(vec3(1.,.45,.13),vec3(1.,.66,.26),smoothstep(0.,.35,q));
  ec=mix(ec,vec3(1.,.89,.62),smoothstep(.35,.85,q));
  float shimmer=.93+.07*sin(p.x*7.-uTime*.7);
  float e=(1.-smoothstep(0.,eh,d))*smoothstep(-soft*1.3-.006,0.,d)*along*min(uGlow,1.)*shimmer;
  col=mix(col,ec,clamp(e,0.,1.));
  col+=vec3(1.,.55,.2)*max(uGlow-1.,0.)*exp(-abs(d)/.012)*along;
  col+=vec3(1.,.6,.25)*uFlash*exp(-abs(d)/.04)*.85;
  col*=1.-.07*smoothstep(.35,1.3,length(p));
  col+=(hash(gl_FragCoord.xy+floor(uTime*24.)*vec2(13.,7.))-.5)*.045;
  gl_FragColor=vec4(col,1.);
}`;

export default function Scene({ onFrame }) {
  const host = useRef(null);
  const frameRef = useRef(onFrame); frameRef.current = onFrame;
  useEffect(() => {
    const el = host.current, track = el.closest('.flight'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let renderer, frame = 0, disposed = false, visible = true, lost = false, last = performance.now(), smooth = progressOf(track);
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    const uniforms = { uRes: { value: new THREE.Vector2(1, 1) }, uPointer: { value: new THREE.Vector2() }, uTime: { value: 0 }, uBar: { value: .15 }, uFlat: { value: .3 }, uSlope: { value: .42 }, uGlow: { value: 1 }, uBlur: { value: .03 }, uFlash: { value: 0 } };
    const plane = new THREE.PlaneGeometry(2, 2), sky = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms, depthTest: false, depthWrite: false });
    const ground = new THREE.Mesh(plane, sky); ground.frustumCulled = false; ground.renderOrder = -1; scene.add(ground);
    // ETH as a cut crystal: it drops into the slot on deposit and leaves from the other side on withdrawal.
    const cut = new THREE.OctahedronGeometry(1, 0); cut.scale(.6, 1, .6);
    const face = new THREE.MeshStandardMaterial({ color: '#eef5ff', flatShading: true, roughness: .38, metalness: .08, emissive: '#ff7a29', emissiveIntensity: 0 });
    const lineGeo = new THREE.EdgesGeometry(cut), line = new THREE.LineBasicMaterial({ color: '#04050f' });
    const crystal = new THREE.Mesh(cut, face); crystal.add(new THREE.LineSegments(lineGeo, line)); scene.add(crystal);
    scene.add(new THREE.HemisphereLight('#eaf4ff', '#1b2440', 1.7));
    const sun = new THREE.DirectionalLight('#ffffff', 2.4); sun.position.set(-1.2, 2, 3); scene.add(sun);
    const ink = new THREE.Color('#04050f'), ember = new THREE.Color('#ff8a3d');
    const pointer = new THREE.Vector2(), aim = new THREE.Vector2();
    const move = e => aim.set(e.clientX / innerWidth - .5, .5 - e.clientY / innerHeight);
    const size = { w: 1, h: 1, m: 1 };

    const draw = now => {
      const still = reduced.matches, t = progressOf(track), dt = Math.min(.1, (now - last) / 1000); last = now;
      smooth = still ? t : smooth + (t - smooth) * (1 - Math.exp(-dt * 7));
      if (Math.abs(t - smooth) < 1e-4) smooth = t;
      const { w, h, m } = size, st = stateAt(smooth, still, w < 700);
      const bar = st.band * (h / 2) / m, flat = st.flat * (w / 2) / m;
      const cx = st.cx * (w / 2) / m, cy = st.cy * (h / 2) / m;
      const edge = Math.abs(cy) - (bar + st.slope * Math.max(0, Math.abs(cx) - flat));
      const flash = st.cv * Math.exp(-((edge / .035) ** 2));
      el.dataset.pose = t.toFixed(3);
      frameRef.current?.(st, { half: st.band * h / 2, flat: st.flat * w / 2, flash });
      if (!renderer || lost) return;
      try {
        pointer.lerp(still ? pointer.set(0, 0) : aim, .06);
        uniforms.uTime.value = still ? 0 : now / 1000;
        uniforms.uPointer.value.copy(pointer);
        uniforms.uBar.value = bar; uniforms.uFlat.value = flat; uniforms.uSlope.value = st.slope;
        uniforms.uBlur.value = st.blur; uniforms.uFlash.value = flash;
        uniforms.uGlow.value = st.glow * (still ? 1 : 1 + .05 * Math.sin(now / 760));
        const inside = 1 - Math.min(1, Math.max(0, (edge + .01) / .03));
        crystal.visible = st.cv > .01 && st.cs > .002;
        crystal.position.set(cx, cy, 0); crystal.scale.setScalar(st.cs * Math.min(1, st.cv * 1.4));
        crystal.rotation.set(.18, still ? .6 : now / 1400 + smooth * 9, .05);
        face.emissiveIntensity = inside * .85; line.color.copy(ink).lerp(ember, inside);
        renderer.render(scene, camera);
      } catch { lost = true; el.dataset.failed = 'true'; }
    };
    const loop = now => { frame = 0; if (disposed || !visible || document.hidden) return; draw(now); if (!reduced.matches) frame = requestAnimationFrame(loop); };
    const resume = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(loop); };
    const onScroll = () => { if (reduced.matches) draw(performance.now()); };
    const resize = () => {
      size.w = el.clientWidth || 1; size.h = el.clientHeight || 1; size.m = Math.min(size.w, size.h);
      const hw = size.w / 2 / size.m, hh = size.h / 2 / size.m;
      Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh }); camera.updateProjectionMatrix();
      if (renderer) { renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(size.w, size.h); renderer.getDrawingBufferSize(uniforms.uRes.value); }
      draw(performance.now());
    };
    const loss = e => { e.preventDefault(); lost = true; el.dataset.failed = 'true'; };
    const restore = () => { lost = false; delete el.dataset.failed; resize(); resume(); };
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      el.appendChild(renderer.domElement); el.dataset.ready = 'true';
      renderer.domElement.addEventListener('webglcontextlost', loss); renderer.domElement.addEventListener('webglcontextrestored', restore);
    } catch { renderer = null; el.dataset.failed = 'true'; }
    const seen = new IntersectionObserver(([e]) => { visible = e.isIntersecting; resume(); }); seen.observe(el);
    const sizing = new ResizeObserver(resize); sizing.observe(el);
    addEventListener('pointermove', move, { passive: true }); addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', resume); reduced.addEventListener('change', resume);
    resize(); resume();
    return () => {
      disposed = true; cancelAnimationFrame(frame); seen.disconnect(); sizing.disconnect();
      removeEventListener('pointermove', move); removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', resume); reduced.removeEventListener('change', resume);
      [plane, cut, lineGeo].forEach(g => g.dispose()); [sky, face, line].forEach(m => m.dispose());
      if (renderer) { renderer.domElement.removeEventListener('webglcontextlost', loss); renderer.domElement.removeEventListener('webglcontextrestored', restore); renderer.dispose(); renderer.domElement.remove(); }
    };
  }, []);
  return <div className="gate-scene" ref={host} aria-hidden="true" />;
}
