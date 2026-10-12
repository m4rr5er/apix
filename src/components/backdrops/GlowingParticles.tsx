"use client"

import * as React from "react"
import { useEffect, useRef } from "react"
import * as THREE from "three"

const PERSPECTIVE = 0.15

const REACH = 2.7

const DEFAULTS = {
    color: "#CFE6FF",
    hot: "#FFFFFF",
    density: 16,
    streak: 8,
    speed: 20,
    size: 4,
    bloom: 0,
    rim: 20,
    haze: 20,
    spin: 20,
    direction: "right",
    sizePercent: 90,
}

type Config = {
    color: string
    hot: string
    density: number
    streak: number
    speed: number
    size: number
    bloom: number
    rim: number
    haze: number
    spin: number
    direction: "right" | "left"
    sizePercent: number
}

function clamp(v: number, lo: number, hi: number, fallback: number): number {
    const n = typeof v === "number" && isFinite(v) ? v : fallback
    return Math.max(lo, Math.min(hi, n))
}

function settingsFor(cfg: Config) {
    const density = clamp(cfg.density, 1, 20, DEFAULTS.density)
    const streak = clamp(cfg.streak, 1, 20, DEFAULTS.streak)
    return {
        rays: Math.round(50 + density * density * 7),

        perRay: Math.round(1 + streak * 1.7),
        speed: clamp(cfg.speed, 0, 20, DEFAULTS.speed) * 0.05,
        size: 1.2 + clamp(cfg.size, 1, 20, DEFAULTS.size) * 1.4,
        bloom: clamp(cfg.bloom, 0, 20, DEFAULTS.bloom) * 0.075,

        rim: clamp(cfg.rim, 0, 20, DEFAULTS.rim) / 20,
        haze: clamp(cfg.haze, 0, 20, DEFAULTS.haze) * 0.075,
        spin: clamp(cfg.spin, 0, 20, DEFAULTS.spin) * 0.05,
        heading: cfg.direction === "left" ? -1 : 1,
    }
}

function buildCloud(rays: number, perRay: number): THREE.BufferGeometry {
    const count = rays * perRay
    const dir = new Float32Array(count * 3)
    const offset = new Float32Array(count)
    const seed = new Float32Array(count)

    const golden = Math.PI * (3 - Math.sqrt(5))
    let i = 0

    for (let r = 0; r < rays; r++) {
        const y = 1 - (r / Math.max(1, rays - 1)) * 2
        const ring = Math.sqrt(Math.max(0, 1 - y * y))
        const theta = golden * r
        let dx = Math.cos(theta) * ring
        let dy = y
        let dz = Math.sin(theta) * ring

        dx += (Math.random() - 0.5) * 0.1
        dy += (Math.random() - 0.5) * 0.1
        dz += (Math.random() - 0.5) * 0.1
        const len = Math.hypot(dx, dy, dz) || 1
        dx /= len
        dy /= len
        dz /= len

        const rayLife = 0.6 + Math.random() * 0.4
        const phase = Math.random()

        for (let p = 0; p < perRay; p++) {
            dir[i * 3] = dx
            dir[i * 3 + 1] = dy
            dir[i * 3 + 2] = dz

            offset[i] = phase + (p / perRay) * 0.2
            seed[i] = rayLife
            i++
        }
    }

    const geometry = new THREE.BufferGeometry()

    geometry.setAttribute("position", new THREE.BufferAttribute(dir, 3))
    geometry.setAttribute("aOffset", new THREE.BufferAttribute(offset, 1))
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1))
    return geometry
}

const PARTICLE_VERTEX =  `
    attribute float aOffset;
    attribute float aSeed;

    uniform float uTime;
    uniform float uSpeed;
    uniform float uRadius;
    uniform float uSize;
    uniform float uRim;
    uniform float uPixelRatio;

    varying float vLife;
    varying float vBright;

    void main() {
        float t = fract(aOffset + uTime * uSpeed * (0.65 + aSeed * 0.7));

        float life = mix(aSeed, 1.0, uRim);
        float r = uRadius * life * (1.0 - pow(1.0 - t, 3.0));

        vec4 mv = modelViewMatrix * vec4(position * r, 1.0);
        gl_Position = projectionMatrix * mv;

        float shrink = 1.0 - t * 0.45;
        gl_PointSize =
            uSize * shrink * uPixelRatio * (10.0 / max(0.001, -mv.z));

        float birth = smoothstep(0.0, 0.05, t);

        float death = 1.0 - smoothstep(0.82, 1.0, t);

        float flick = 0.5 + 0.5 * sin(uTime * 9.0 + aSeed * 43.0 + aOffset * 61.0);
        vBright = birth * death * flick;
        vLife = t;
    }
`

const PARTICLE_FRAGMENT =  `
    uniform vec3 uColor;
    uniform vec3 uHot;

    varying float vLife;
    varying float vBright;

    void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float fall = 1.0 - d;

        float shape = pow(fall, 5.0) + pow(fall, 1.6) * 0.3;

        vec3 col = mix(uHot, uColor, smoothstep(0.0, 0.55, vLife));
        float a = shape * vBright;

        gl_FragColor = vec4(col * a, a);
    }
`

const HAZE_VERTEX =  `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`

const HAZE_FRAGMENT =  `
    uniform vec3 uColor;
    uniform float uHaze;

    varying vec2 vUv;

    void main() {
        float d = length(vUv - 0.5) * 2.0;
        if (d > 1.0) discard;

        float haze = pow(1.0 - d, 1.5);
        float a = clamp(haze * uHaze, 0.0, 1.0);
        gl_FragColor = vec4(uColor * a, a);
    }
`

const QUAD_VERTEX =  `
    varying vec2 vUv;
    void main() {
        vUv = uv;

        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`

const BLUR_FRAGMENT =  `
    uniform sampler2D tDiffuse;
    uniform vec2 uStep;
    varying vec2 vUv;

    void main() {
        vec4 sum = texture2D(tDiffuse, vUv) * 0.227027;
        sum += texture2D(tDiffuse, vUv + uStep * 1.3846) * 0.3162162;
        sum += texture2D(tDiffuse, vUv - uStep * 1.3846) * 0.3162162;
        sum += texture2D(tDiffuse, vUv + uStep * 3.2307) * 0.0702702;
        sum += texture2D(tDiffuse, vUv - uStep * 3.2307) * 0.0702702;
        gl_FragColor = sum;
    }
`

const COMPOSITE_FRAGMENT =  `
    uniform sampler2D tBase;
    uniform sampler2D tNear;
    uniform sampler2D tWide;
    uniform float uBloom;
    varying vec2 vUv;

    void main() {
        vec4 base = texture2D(tBase, vUv);

        vec4 glow = texture2D(tNear, vUv) * 0.85 + texture2D(tWide, vUv) * 1.15;
        vec4 col = base + glow * uBloom;
        gl_FragColor = vec4(col.rgb, clamp(col.a, 0.0, 1.0));
    }
`

class BurstScene {
    private container: HTMLElement
    private cfg: Config

    private renderer: THREE.WebGLRenderer
    private scene = new THREE.Scene()
    private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000)
    private group = new THREE.Group()

    private geometry: THREE.BufferGeometry
    private material: THREE.ShaderMaterial
    private points: THREE.Points

    private hazeGeometry = new THREE.PlaneGeometry(1, 1)
    private hazeMaterial: THREE.ShaderMaterial
    private haze: THREE.Mesh

    private rtBase: THREE.WebGLRenderTarget | null = null
    private rtHalfA: THREE.WebGLRenderTarget | null = null
    private rtHalfB: THREE.WebGLRenderTarget | null = null
    private rtQuarterA: THREE.WebGLRenderTarget | null = null
    private rtQuarterB: THREE.WebGLRenderTarget | null = null

    private quadScene = new THREE.Scene()
    private quadCamera = new THREE.Camera()
    private quadGeometry = new THREE.PlaneGeometry(2, 2)
    private quad: THREE.Mesh
    private blurMaterial: THREE.ShaderMaterial
    private compositeMaterial: THREE.ShaderMaterial

    private time = 0
    private spinAngle = 0
    private width = 0
    private height = 0
    private dpr = 1
    private frameId = 0
    private lastT = 0
    private disposed = false

    constructor(container: HTMLElement, cfg: Config) {
        this.container = container
        this.cfg = cfg
        const S = settingsFor(cfg)

        this.renderer = new THREE.WebGLRenderer({
            antialias: false,
            alpha: true,
            premultipliedAlpha: true,
        })
        this.dpr = Math.min(window.devicePixelRatio || 1, 2)
        this.renderer.setPixelRatio(this.dpr)
        this.renderer.outputColorSpace = THREE.SRGBColorSpace
        this.renderer.setClearColor(0x000000, 0)
        const el = this.renderer.domElement
        el.style.position = "absolute"
        el.style.inset = "0"
        el.style.width = "100%"
        el.style.height = "100%"
        container.appendChild(el)

        this.material = new THREE.ShaderMaterial({
            vertexShader: PARTICLE_VERTEX,
            fragmentShader: PARTICLE_FRAGMENT,
            uniforms: {
                uTime: { value: 0 },
                uSpeed: { value: S.speed },
                uRadius: { value: REACH },
                uSize: { value: S.size },
                uRim: { value: S.rim },
                uPixelRatio: { value: this.dpr },
                uColor: { value: new THREE.Color(cfg.color) },
                uHot: { value: new THREE.Color(cfg.hot) },
            },
            transparent: true,

            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
        })

        this.geometry = buildCloud(S.rays, S.perRay)
        this.points = new THREE.Points(this.geometry, this.material)

        this.points.frustumCulled = false
        this.group.add(this.points)

        this.hazeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(cfg.color) },
                uHaze: { value: S.haze },
            },
            vertexShader: HAZE_VERTEX,
            fragmentShader: HAZE_FRAGMENT,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
        })
        this.haze = new THREE.Mesh(this.hazeGeometry, this.hazeMaterial)

        this.scene.add(this.haze)
        this.scene.add(this.group)
        this.applyScales()

        this.blurMaterial = new THREE.ShaderMaterial({
            vertexShader: QUAD_VERTEX,
            fragmentShader: BLUR_FRAGMENT,
            uniforms: {
                tDiffuse: { value: null },
                uStep: { value: new THREE.Vector2() },
            },
            depthTest: false,
            depthWrite: false,
        })

        this.compositeMaterial = new THREE.ShaderMaterial({
            vertexShader: QUAD_VERTEX,
            fragmentShader: COMPOSITE_FRAGMENT,
            uniforms: {
                tBase: { value: null },
                tNear: { value: null },
                tWide: { value: null },
                uBloom: { value: S.bloom },
            },
            depthTest: false,
            depthWrite: false,
            transparent: true,

            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
        })

        this.quad = new THREE.Mesh(this.quadGeometry, this.blurMaterial)
        this.quad.frustumCulled = false
        this.quadScene.add(this.quad)
    }

    private applyScales() {
        this.haze.scale.setScalar(REACH * 2.6)
    }

    private makeTargets(w: number, h: number) {
        this.disposeTargets()

        const type = this.renderer.capabilities.isWebGL2
            ? THREE.HalfFloatType
            : THREE.UnsignedByteType
        const opts = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type,
            depthBuffer: false,
            stencilBuffer: false,
        }
        const half = (n: number) => Math.max(1, Math.floor(n / 2))
        const quarter = (n: number) => Math.max(1, Math.floor(n / 4))
        this.rtBase = new THREE.WebGLRenderTarget(w, h, opts)

        this.rtHalfA = new THREE.WebGLRenderTarget(half(w), half(h), opts)
        this.rtHalfB = new THREE.WebGLRenderTarget(half(w), half(h), opts)
        this.rtQuarterA = new THREE.WebGLRenderTarget(
            quarter(w),
            quarter(h),
            opts
        )
        this.rtQuarterB = new THREE.WebGLRenderTarget(
            quarter(w),
            quarter(h),
            opts
        )
    }

    private disposeTargets() {
        for (const rt of [
            this.rtBase,
            this.rtHalfA,
            this.rtHalfB,
            this.rtQuarterA,
            this.rtQuarterB,
        ]) {
            rt?.dispose()
        }
        this.rtBase = null
        this.rtHalfA = null
        this.rtHalfB = null
        this.rtQuarterA = null
        this.rtQuarterB = null
    }

    private blurPass(
        source: THREE.Texture,
        target: THREE.WebGLRenderTarget,
        dx: number,
        dy: number
    ) {
        this.blurMaterial.uniforms.tDiffuse.value = source
        this.blurMaterial.uniforms.uStep.value.set(
            dx / target.width,
            dy / target.height
        )
        this.quad.material = this.blurMaterial
        this.renderer.setRenderTarget(target)
        this.renderer.clear()
        this.renderer.render(this.quadScene, this.quadCamera)
    }

    start() {
        this.lastT = performance.now()
        const loop = () => {
            this.frameId = requestAnimationFrame(loop)
            this.step()
        }
        loop()
    }

    setSize(width: number, height: number) {
        if (this.disposed || width <= 0 || height <= 0) return
        this.width = width
        this.height = height
        this.renderer.setSize(width, height, false)
        this.makeTargets(
            Math.max(1, Math.floor(width * this.dpr)),
            Math.max(1, Math.floor(height * this.dpr))
        )
        this.updateCamera()
    }

    updateConfig(cfg: Config) {
        if (this.disposed) return
        const prev = this.cfg
        this.cfg = cfg
        const S = settingsFor(cfg)
        const u = this.material.uniforms

        u.uSpeed.value = S.speed
        u.uSize.value = S.size
        u.uRim.value = S.rim
        u.uColor.value.set(cfg.color || "#ffffff")
        u.uHot.value.set(cfg.hot || "#ffffff")

        this.hazeMaterial.uniforms.uColor.value.set(cfg.color || "#ffffff")
        this.hazeMaterial.uniforms.uHaze.value = S.haze
        this.compositeMaterial.uniforms.uBloom.value = S.bloom

        if (cfg.density !== prev.density || cfg.streak !== prev.streak) {
            const next = buildCloud(S.rays, S.perRay)
            this.geometry.dispose()
            this.geometry = next
            this.points.geometry = next
        }
        this.applyScales()
        this.updateCamera()
    }

    private updateCamera() {
        const w = Math.max(1, this.width)
        const h = Math.max(1, this.height)
        const aspect = w / h
        const distance = 1 / PERSPECTIVE
        const sizePct = clamp(this.cfg.sizePercent, 20, 200, 90)

        const span = 7.4 * (100 / sizePct)
        const visibleHeight = aspect < 1 ? span / aspect : span

        this.camera.aspect = aspect
        this.camera.position.set(0, 0, distance)
        this.camera.lookAt(0, 0, 0)
        this.camera.fov =
            2 * Math.atan(visibleHeight / 2 / distance) * (180 / Math.PI)
        this.camera.near = Math.max(0.1, distance - 20)
        this.camera.far = distance + 20
        this.camera.updateProjectionMatrix()
    }

    private step() {
        if (this.disposed) return
        const now = performance.now()
        let dt = (now - this.lastT) / 1000
        this.lastT = now
        if (!isFinite(dt) || dt < 0) dt = 0
        if (dt > 0.05) dt = 0.05

        const S = settingsFor(this.cfg)
        this.time += dt
        this.spinAngle += S.spin * S.heading * dt

        this.material.uniforms.uTime.value = this.time

        this.group.rotation.y = this.spinAngle
        this.group.rotation.x = Math.sin(this.spinAngle * 0.6) * 0.35

        const base = this.rtBase
        const hA = this.rtHalfA
        const hB = this.rtHalfB
        const qA = this.rtQuarterA
        const qB = this.rtQuarterB
        if (!base || !hA || !hB || !qA || !qB) {
            this.renderer.setRenderTarget(null)
            this.renderer.render(this.scene, this.camera)
            return
        }

        this.renderer.setRenderTarget(base)
        this.renderer.clear()
        this.renderer.render(this.scene, this.camera)

        this.blurPass(base.texture, hA, 1, 0)
        this.blurPass(hA.texture, hB, 0, 1)
        this.blurPass(hB.texture, qA, 1, 0)
        this.blurPass(qA.texture, qB, 0, 1)

        const c = this.compositeMaterial.uniforms
        c.tBase.value = base.texture
        c.tNear.value = hB.texture
        c.tWide.value = qB.texture
        this.quad.material = this.compositeMaterial
        this.renderer.setRenderTarget(null)
        this.renderer.clear()
        this.renderer.render(this.quadScene, this.quadCamera)
    }

    dispose() {
        this.disposed = true
        cancelAnimationFrame(this.frameId)
        this.geometry.dispose()
        this.material.dispose()
        this.hazeGeometry.dispose()
        this.hazeMaterial.dispose()
        this.quadGeometry.dispose()
        this.blurMaterial.dispose()
        this.compositeMaterial.dispose()
        this.disposeTargets()
        this.renderer.dispose()
        const el = this.renderer.domElement
        if (el.parentNode === this.container) this.container.removeChild(el)
    }
}

export interface GlowingParticlesProps {
    color?: string
    hot?: string
    density?: number
    streak?: number
    speed?: number
    size?: number
    bloom?: number
    rim?: number
    haze?: number
    spin?: number
    direction?: "right" | "left"
    sizePercent?: number
    style?: React.CSSProperties
}

export default function GlowingParticles(props: GlowingParticlesProps) {
    const {
        color = DEFAULTS.color,
        hot = DEFAULTS.hot,
        density = DEFAULTS.density,
        streak = DEFAULTS.streak,
        speed = DEFAULTS.speed,
        size = DEFAULTS.size,
        bloom = DEFAULTS.bloom,
        rim = DEFAULTS.rim,
        haze = DEFAULTS.haze,
        spin = DEFAULTS.spin,
        direction = DEFAULTS.direction as "right" | "left",
        sizePercent = DEFAULTS.sizePercent,
        style,
    } = props

    const containerRef = useRef<HTMLDivElement | null>(null)
    const sceneRef = useRef<BurstScene | null>(null)

    const cfgRef = useRef<Config>(null as any)
    cfgRef.current = {
        color,
        hot,
        density,
        streak,
        speed,
        size,
        bloom,
        rim,
        haze,
        spin,
        direction,
        sizePercent,
    }

    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        let scene: BurstScene
        try {
            scene = new BurstScene(container, cfgRef.current)
        } catch {
            return
        }
        sceneRef.current = scene
        scene.setSize(container.clientWidth, container.clientHeight)
        scene.start()

        const ro = new ResizeObserver(() => {
            scene.setSize(container.clientWidth, container.clientHeight)
        })
        ro.observe(container)
        return () => {
            ro.disconnect()
            scene.dispose()
            sceneRef.current = null
        }
    }, [])

    useEffect(() => {
        sceneRef.current?.updateConfig(cfgRef.current)
    }, [
        color,
        hot,
        density,
        streak,
        speed,
        size,
        bloom,
        rim,
        haze,
        spin,
        direction,
        sizePercent,
    ])

    return (
        <div
            ref={containerRef}
            role="img"
            aria-label="Glowing particle burst"
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                minWidth: 160,
                minHeight: 160,
                overflow: "hidden",
                ...style,
            }}
        />
    )
}

GlowingParticles.displayName = "Glowing Particles"
