customElements.define('particle-globe', class extends HTMLElement {
  connectedCallback() { this.alive = true; this.init(); }
  disconnectedCallback() { this.alive = false; cancelAnimationFrame(this.raf); this.renderer && this.renderer.dispose(); }
  async init() {
    this.style.display = 'block';
    const THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js');
    if (!this.alive) return;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
    this.appendChild(renderer.domElement);
    this.renderer = renderer;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
    camera.position.set(0, 0.22, 2.55);
    camera.lookAt(0, 0.02, 0);
    const size = () => {
      const w = this.clientWidth || 700, h = this.clientHeight || 700;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.setViewOffset(w, h, -w * 0.17, h * 0.03, w, h);
      camera.updateProjectionMatrix();
    };
    size();
    new ResizeObserver(size).observe(this);

    const sunDir = new THREE.Vector3(-2.1, 0.35, 1.0).normalize();
    const world = new THREE.Group();
    world.rotation.z = 0.24;
    world.rotation.x = 0.12;
    scene.add(world);
    const globe = new THREE.Group();
    globe.rotation.y = 4.4;
    world.add(globe);

    // textured earth: day imagery tinted to night blue + real city-lights emissive
    const texLoad = (url) => new Promise((res) => {
      new THREE.TextureLoader().setCrossOrigin('anonymous').load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, () => res(null));
    });
    const [dayTex, nightTex] = await Promise.all([
      texLoad('https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg'),
      texLoad('https://unpkg.com/three-globe@2.31.0/example/img/earth-night.jpg')
    ]);
    if (!this.alive) return;
    globe.add(new THREE.Mesh(
      new THREE.SphereGeometry(0.995, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: { uDay: { value: dayTex }, uNight: { value: nightTex }, uSun: { value: sunDir } },
        vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vWN; varying vec3 vWP; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vWN = normalize(mat3(modelMatrix) * normal); vWP = (modelMatrix * vec4(position,1.0)).xyz; vP = (modelViewMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: [
          'uniform sampler2D uDay; uniform sampler2D uNight; uniform vec3 uSun;',
          'varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vWN; varying vec3 vWP;',
          'void main(){',
          '  vec3 day = texture2D(uDay, vUv).rgb;',
          '  vec3 night = texture2D(uNight, vUv).rgb;',
          '  float landness = smoothstep(0.05, 0.4, day.g);',
          '  vec3 ocean = vec3(0.024, 0.07, 0.16);',
          '  float dlum = clamp(dot(day, vec3(0.333)) * 1.3, 0.3, 0.75);',
          '  vec3 land = vec3(0.075, 0.11, 0.17) * dlum + vec3(0.018, 0.035, 0.07);',
          '  vec3 base = mix(ocean, land, 1.0);',
          '  base = mix(ocean, base, clamp(landness + day.b * 0.5, 0.2, 1.0));',
          '  float sunlit = smoothstep(-0.02, 0.42, dot(normalize(vWN), uSun));',
          '  vec3 dayCol = day * vec3(1.03, 1.08, 1.2) * 1.4;',
          '  vec3 viewD = normalize(cameraPosition - vWP);',
          '  float spec = pow(max(dot(reflect(-uSun, normalize(vWN)), viewD), 0.0), 90.0);',
          '  float warm = max(night.r - night.b * 0.85, 0.0);',
          '  vec3 lights = vec3(1.75, 1.32, 0.82) * pow(warm, 0.8) * 6.5 * (1.0 - sunlit);',
          '  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(-vP))), 2.5);',
          '  float minc = min(min(day.r, day.g), day.b);',
          '  float sat = max(max(day.r, day.g), day.b) - minc;',
          '  float cloudless = smoothstep(0.16, 0.4, minc) * (1.0 - smoothstep(0.03, 0.14, sat));',
          '  float dayMix = pow(sunlit, 1.5);',
          '  vec3 sunset = vec3(0.9, 0.45, 0.2) * pow(sunlit * (1.0 - sunlit) * 4.0, 3.0) * 0.12;',
          '  vec3 col = mix(base, dayCol * (0.5 + 0.5 * sunlit), dayMix) + lights + sunset + spec * (1.0 - clamp(landness + cloudless, 0.0, 1.0)) * sunlit * vec3(0.9, 0.85, 0.7) * 0.4 + vec3(0.18, 0.45, 0.85) * rim * 0.6;',
          '  gl_FragColor = vec4(col, 1.0);',
          '}'
        ].join('\n'),
      })
    ));

    // atmosphere: outer halo (backside fresnel) + inner limb glow
    const fresnelMat = (col, pw, op, side, r) => new THREE.Mesh(
      new THREE.SphereGeometry(r, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { uCol: { value: new THREE.Color(col) }, uPw: { value: pw }, uOp: { value: op } },
        vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vP = (modelViewMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 uCol; uniform float uPw; uniform float uOp; varying vec3 vN; varying vec3 vP; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(-vP))), uPw); gl_FragColor = vec4(uCol * f, f * uOp); }',
        transparent: true, blending: THREE.AdditiveBlending, side, depthWrite: false
      })
    );
    scene.add(fresnelMat(0x2f8fe6, 4.2, 0.75, THREE.BackSide, 1.08));
    scene.add(fresnelMat(0x66c4ff, 4.5, 0.65, THREE.FrontSide, 1.002));

    // faint lat/lon wire
    globe.add(new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.SphereGeometry(1.0, 30, 20)),
      new THREE.LineBasicMaterial({ color: 0x4fb8e0, transparent: true, opacity: 0.06 })
    ));

    // texture sampling
    const loadImg = (src) => new Promise((res) => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => res(im); im.onerror = () => res(null); im.src = src;
    });
    const [waterImg, nightImg] = await Promise.all([
      loadImg('https://unpkg.com/three-globe@2.31.0/example/img/earth-water.png'),
      loadImg('https://unpkg.com/three-globe@2.31.0/example/img/earth-night.jpg')
    ]);
    if (!this.alive) return;
    const W = 1440, H = 720;
    const sample = (im) => {
      if (!im) return null;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0, W, H);
      return x.getImageData(0, 0, W, H).data;
    };
    const water = sample(waterImg), night = sample(nightImg);
    const toSphere = (x, y, r) => {
      const lon = (x / W) * Math.PI * 2 - Math.PI;
      const lat = Math.PI / 2 - (y / H) * Math.PI;
      return [r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon)];
    };
    const isLand = (x, y) => { const i = ((y | 0) * W + (x | 0)) * 4; return water && water[i] <= 90; };
    const lum = (x, y) => { const i = ((y | 0) * W + (x | 0)) * 4; return night ? (night[i] + night[i + 1] + night[i + 2]) / 765 : 0; };

    const timeU = { value: 0 };
    const mkShaderPoints = (pos, col, sizes, phases) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('col', new THREE.Float32BufferAttribute(col, 3));
      geo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
      geo.setAttribute('phase', new THREE.Float32BufferAttribute(phases, 1));
      return new THREE.Points(geo, new THREE.ShaderMaterial({
        uniforms: { uTime: timeU, uSun: { value: sunDir } },
        vertexShader: 'attribute float size; attribute float phase; attribute vec3 col; uniform float uTime; uniform vec3 uSun; varying vec3 vC; varying float vA; void main(){ vC = col; float tw = phase < 0.0 ? 1.0 : 0.72 + 0.28 * sin(uTime * 1.4 + phase); vec3 wn = normalize(mat3(modelMatrix) * position); float nightF = 1.0 - smoothstep(-0.08, 0.3, dot(wn, uSun)); vA = tw * nightF; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * (240.0 / -mv.z); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vC, a * vA); }',
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      }));
    };

    // city lights sparkle overlay: brightness-weighted, warm, twinkling
    const cityHot = []; // bright anchors for arcs
    if (night) {
      const pos = [], col = [], sizes = [], phases = [];
      const warm = new THREE.Color(0xffddad), pale = new THREE.Color(0xcfeaff);
      for (let y = 4; y < H - 4; y += 2) {
        for (let x = 0; x < W; x += 2) {
          const b = lum(x, y);
          if (b < 0.24) continue;
          const p = toSphere(x, y, 1.004);
          pos.push(...p);
          const c = pale.clone().lerp(warm, Math.min(1, b * 1.6));
          const gain = 0.55 + b * 1.5;
          col.push(c.r * gain, c.g * gain, c.b * gain);
          sizes.push(0.006 + b * 0.02);
          phases.push(Math.random() * 6.283);
          if (b > 0.62 && Math.random() < 0.02) cityHot.push(new THREE.Vector3(...toSphere(x, y, 1.01)));
        }
      }
      globe.add(mkShaderPoints(pos, col, sizes, phases));
    }

    // connection arcs between bright cities, with travelling pulses
    const pulses = [];
    if (cityHot.length > 8) {
      const arcGroup = new THREE.Group(); globe.add(arcGroup);
      const nArcs = parseInt(this.getAttribute('arcs') || '12', 10);
      for (let i = 0; i < nArcs; i++) {
        const a = cityHot[(Math.random() * cityHot.length) | 0];
        let b = cityHot[(Math.random() * cityHot.length) | 0];
        if (a.distanceTo(b) < 0.5) { i--; continue; }
        const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(1 + a.distanceTo(b) * 0.38);
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        arcGroup.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)),
          new THREE.LineBasicMaterial({ color: 0x51c8ff, transparent: true, opacity: 0.22 })
        ));
        pulses.push({ curve, t: Math.random(), sp: 0.08 + Math.random() * 0.1 });
      }
    }
    // pulse sprites
    const oc = document.createElement('canvas'); oc.width = oc.height = 64;
    const og = oc.getContext('2d');
    const ograd = og.createRadialGradient(32, 32, 1, 32, 32, 32);
    ograd.addColorStop(0, 'rgba(255,255,255,0.95)');
    ograd.addColorStop(0.12, 'rgba(210,235,255,0.55)');
    ograd.addColorStop(0.45, 'rgba(140,195,255,0.14)');
    ograd.addColorStop(1, 'rgba(90,160,255,0)');
    og.fillStyle = ograd; og.fillRect(0, 0, 64, 64);
    const orbTex = new THREE.CanvasTexture(oc);
    for (const p of pulses) {
      p.spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: orbTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      p.spr.scale.set(0.05, 0.05, 1);
      globe.add(p.spr);
    }

    // floating light orbs around the globe
    const orbCount = parseInt(this.getAttribute('orbs') || '22', 10);
    const orbs = [];
    for (let i = 0; i < orbCount; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: orbTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: Math.random() < 0.25 ? 0xe6f6ff : 0xaadcff }));
      const d = {
        r: 1.4 + Math.random() * 1.3, th: Math.random() * 6.283,
        y: (Math.random() - 0.5) * 2.0,
        sp: (0.008 + Math.random() * 0.025) * (Math.random() < 0.5 ? -1 : 1),
        ph: Math.random() * 6.283, tw: 0.4 + Math.random() * 0.9,
        sc: 0.012 + Math.random() * 0.032
      };
      s.scale.set(d.sc, d.sc, 1);
      orbs.push([s, d]); scene.add(s);
    }

    // tilted orbit rings + data ticks
    const rings = new THREE.Group();
    if (this.getAttribute('rings') !== 'off') {
      const mkRing = (r, op, segs) => {
        const pts = [];
        for (let i = 0; i <= segs; i++) { const a = (i / segs) * 6.283; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
        return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0x4fc3ee, transparent: true, opacity: op }));
      };
      const r1 = mkRing(1.58, 0.22, 128); r1.rotation.x = Math.PI / 2 - 0.3;
      const r2 = mkRing(1.9, 0.12, 128); r2.rotation.x = Math.PI / 2 - 0.24; r2.rotation.z = 0.1;
      const r3 = mkRing(2.3, 0.07, 160); r3.rotation.x = Math.PI / 2 - 0.36; r3.rotation.z = -0.08;
      const ticks = [];
      for (let i = 0; i < 90; i++) {
        const a = Math.random() * 6.283, r = 2.3 + (Math.random() - 0.5) * 0.05, a2 = a + 0.02 + Math.random() * 0.06;
        ticks.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Vector3(Math.cos(a2) * r, 0, Math.sin(a2) * r));
      }
      const tickLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks),
        new THREE.LineBasicMaterial({ color: 0x8fe0ff, transparent: true, opacity: 0.3 }));
      tickLines.rotation.x = Math.PI / 2 - 0.36; tickLines.rotation.z = -0.08;
      rings.add(r1, r2, r3, tickLines);
      scene.add(rings);
    }

    // deep-space starfield: layered depths, mixed temperatures
    {
      const starLayer = (n, col, sz, op) => {
        const pos = [];
        for (let i = 0; i < n; i++) {
          const v = new THREE.Vector3().randomDirection().multiplyScalar(9 + Math.random() * 14);
          pos.push(v.x, v.y, v.z);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
          color: col, size: sz, transparent: true, opacity: op,
          blending: THREE.AdditiveBlending, depthWrite: false
        })));
      };
      starLayer(1800, 0xffffff, 0.011, 0.5);
      starLayer(420, 0xbcd9ff, 0.02, 0.5);
      starLayer(120, 0x9fc4ff, 0.04, 0.5);
      starLayer(45, 0xffe2b8, 0.035, 0.6);
    }

    // satellites: inclined orbits with glowing craft + faint orbit lines
    const sats = [];
    {
      const satGroup = new THREE.Group(); scene.add(satGroup);
      const orbits = [
        { r: 1.28, inc: 0.9, asc: 0.3, sp: 0.28 },
        { r: 1.42, inc: 1.35, asc: 2.1, sp: -0.2 },
        { r: 1.34, inc: 0.5, asc: 4.0, sp: 0.24 },
        { r: 1.52, inc: 1.1, asc: 5.3, sp: -0.15 }
      ];
      for (const o of orbits) {
        const holder = new THREE.Group();
        holder.rotation.set(o.inc, o.asc, 0);
        satGroup.add(holder);
        const pts = [];
        for (let i = 0; i <= 96; i++) { const a = (i / 96) * 6.283; pts.push(new THREE.Vector3(Math.cos(a) * o.r, 0, Math.sin(a) * o.r)); }
        holder.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.14 })));
        const body = new THREE.Group();
        const core = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: 0xdff4ff }));
        const panelMat = new THREE.MeshBasicMaterial({ color: 0x2a7fd4 });
        const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.002, 0.02), panelMat); p1.position.x = 0.045;
        const p2 = p1.clone(); p2.position.x = -0.045;
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: orbTex, color: 0x9fe0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
        halo.scale.set(0.09, 0.09, 1);
        body.add(core, p1, p2, halo);
        holder.add(body);
        const TRAIL = 80;
        const tpos = new Float32Array(TRAIL * 3);
        const tgeo = new THREE.BufferGeometry();
        tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
        const tmat = new THREE.LineBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
        const trail = new THREE.Line(tgeo, tmat);
        holder.add(trail);
        sats.push({ holder, body, ...o, ph: Math.random() * 6.283, halo, tpos, tgeo, tmat, tinit: false });
      }
    }

    let last = performance.now();
    // drag to rotate, with inertia
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    el.style.cursor = 'grab';
    let dragging = false, px = 0, py = 0, vx = 0, vy = 0;
    el.addEventListener('pointerdown', (e) => { dragging = true; px = e.clientX; py = e.clientY; vx = vy = 0; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
      vx = dx * 0.005; vy = dy * 0.004;
      globe.rotation.y += vx;
      world.rotation.x = Math.max(-0.7, Math.min(0.85, world.rotation.x + vy));
    });
    const endDrag = () => { dragging = false; el.style.cursor = 'grab'; };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    const loop = (now) => {
      if (!this.alive) return;
      const dt = Math.min(50, now - last); last = now;
      const speed = parseFloat(getComputedStyle(this).getPropertyValue('--orbit-speed')) || 1;
      if (!dragging) {
        globe.rotation.y += 0.00004 * dt * speed + vx;
        world.rotation.x = Math.max(-0.7, Math.min(0.85, world.rotation.x + vy));
        vx *= 0.94; vy *= 0.9;
      }
      rings.rotation.y -= 0.00004 * dt * speed;
      const t = now * 0.001;
      timeU.value = t;
      const boostTarget = parseFloat(getComputedStyle(this).getPropertyValue('--sat-boost')) || 0;
      this.boost = (this.boost || 0) + (boostTarget - (this.boost || 0)) * 0.06;
      const bo = this.boost;
      for (const s of sats) {
        s.ang = (s.ang === undefined ? s.ph + t * s.sp : s.ang) + s.sp * (1 + bo * 3.5) * speed * dt * 0.001;
        const a = s.ang;
        s.body.position.set(Math.cos(a) * s.r, 0, Math.sin(a) * s.r);
        s.body.rotation.y = -a;
        s.halo.material.opacity = 0.5 + bo * 0.5;
        const hs = 0.09 * (1 + bo * 0.6);
        s.halo.scale.set(hs, hs, 1);
        const p = s.tpos;
        if (!s.tinit) { for (let i = 0; i < p.length; i += 3) { p[i] = s.body.position.x; p[i+1] = 0; p[i+2] = s.body.position.z; } s.tinit = true; }
        p.copyWithin(3, 0, p.length - 3);
        p[0] = s.body.position.x; p[1] = 0; p[2] = s.body.position.z;
        s.tgeo.attributes.position.needsUpdate = true;
        s.tmat.opacity = 0.32 * bo;
      }
      for (const [s, d] of orbs) {
        const a = d.th + t * d.sp;
        s.position.set(Math.cos(a) * d.r, d.y + Math.sin(t * 0.5 + d.ph) * 0.09, Math.sin(a) * d.r);
        s.material.opacity = 0.12 + 0.45 * (0.5 + 0.5 * Math.sin(t * d.tw * 0.6 + d.ph));
      }
      for (const p of pulses) {
        p.t = (p.t + dt * 0.001 * p.sp * speed) % 1;
        const v = p.curve.getPoint(p.t);
        p.spr.position.copy(v);
        p.spr.material.opacity = Math.sin(p.t * Math.PI);
      }
      renderer.render(scene, camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
});
