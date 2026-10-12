"use client"

import * as React from "react"
import { useEffect, useRef } from "react"
import * as THREE from "three"

const MAX_PARTICLES = 30000

const SCALE_FACTOR = 0.06

const CAM_DISTANCE = 20

const SPHERE_DETAIL = 3

const EDGE_GLOW = 2.0

const DEFAULTS = {
    text: "BUBBLES",
    tint: "#FFFFFF",
    opacity: 4,
    bubbleSize: 20,
    density: 18,
    speed: 8,
    scatter: 10,
    hoverOn: true,
    hover: { radius: 9, lift: 8 },
}

const DEFAULT_FONT: FontValue = {
    fontFamily: "Inter",
    fontSize: 70,
    fontWeight: 100,
    lineHeight: 1,
}

type FontValue = {
    fontFamily?: string
    fontSize?: number | string
    fontWeight?: number | string
    fontStyle?: string
    letterSpacing?: number | string
    lineHeight?: number | string
}

type Config = {
    text: string
    font: FontValue
    tint: string
    opacity: number
    bubbleSize: number
    density: number
    speed: number
    scatter: number
    hoverOn: boolean
    hover: HoverOptions
}

type HoverOptions = { radius?: number; lift?: number }

function clamp(v: number, lo: number, hi: number, fallback: number): number {
    const n = typeof v === "number" && isFinite(v) ? v : fallback
    return Math.max(lo, Math.min(hi, n))
}

function toPx(v: unknown, fallback: number, emBasis: number): number {
    if (typeof v === "number" && isFinite(v)) return v
    if (typeof v === "string") {
        const n = parseFloat(v)
        if (!isFinite(n)) return fallback
        if (v.indexOf("em") >= 0) return n * emBasis
        if (v.indexOf("%") >= 0) return (n / 100) * emBasis
        return n
    }
    return fallback
}

function toRatio(v: unknown, size: number, fallback: number): number {
    if (typeof v === "number" && isFinite(v)) return v > 4 ? v / size : v
    if (typeof v === "string") {
        const n = parseFloat(v)
        if (!isFinite(n)) return fallback
        if (v.indexOf("px") >= 0) return n / size
        if (v.indexOf("%") >= 0) return n / 100
        return n > 4 ? n / size : n
    }
    return fallback
}

function settingsFor(cfg: Config) {
    const font = cfg.font ?? {}
    const fontSize = Math.max(8, toPx(font.fontSize, 70, 16))
    return {
        family: font.fontFamily || "system-ui, sans-serif",
        fontSize,
        weight: font.fontWeight ?? 100,
        fontStyle: font.fontStyle ?? "normal",
        tracking: toPx(font.letterSpacing, 0, fontSize),
        lineRatio: toRatio(font.lineHeight, fontSize, 1),

        opacity: clamp(cfg.opacity, 1, 20, DEFAULTS.opacity) * 0.05,
        bubble: clamp(cfg.bubbleSize, 1, 20, DEFAULTS.bubbleSize) / 10,

        step: Math.max(1, Math.round(1 + (20 - clamp(cfg.density, 1, 20, DEFAULTS.density)) * 0.35)),

        growth: 0.002 + Math.pow(clamp(cfg.speed, 1, 20, DEFAULTS.speed), 2) * 0.00035,
        scatter: clamp(cfg.scatter, 0, 20, DEFAULTS.scatter) * 0.05,

        hoverRadius: clamp(cfg.hover?.radius as number, 1, 20, 9) * 0.9,

        hoverLift: clamp(cfg.hover?.lift as number, 1, 20, 8) * 0.5,
    }
}

const BUBBLE_VERTEX =  `
    varying vec3 vNormal;
    varying float vFresnel;

    float rand(vec2 co) {
        return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
        vNormal = normal * rand(instanceMatrix[3].xz);

        vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position + vec3(0.0, 0.3, 0.0), 1.0);
        vec3 toEye = normalize(worldPosition.xyz - cameraPosition - vec3(1.0, 2.0, 0.0));
        vFresnel = pow(1.0 + dot(toEye, normal), 3.0);

        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`

const BUBBLE_FRAGMENT =  `
    uniform vec3 uTint;
    uniform float uEdge;
    uniform float uBody;

    varying vec3 vNormal;
    varying float vFresnel;

    void main() {
        vec3 colored = mix(vNormal, vec3(1.0), 0.75) * uTint;
        gl_FragColor = vec4(colored, uBody + uEdge * vFresnel);
    }
`

type Particle = {
    x: number
    y: number
    z: number
    scale: number
    maxScale: number
    deltaScale: number

    lift: number

    hover: number

    riseJitter: number
    toDelete: boolean
}

function makeBubble(x: number, y: number, S: ReturnType<typeof settingsFor>): Particle {
    return {
        x: x + S.scatter * (Math.random() - 0.5),
        y: y + S.scatter * (Math.random() - 0.5),
        z: 0,
        scale: 0.1 * Math.random(),

        maxScale: Math.pow(Math.random(), 3) * S.bubble,
        deltaScale: S.growth * (0.4 + Math.random()),
        lift: 0,
        hover: 0,
        riseJitter: 0.4 + 0.8 * Math.random(),
        toDelete: false,
    }
}

type Coord = { x: number; y: number; old: boolean; toDelete: boolean }

class BubbleTypeScene {
    private container: HTMLElement
    private cfg: Config
    private prev: Config

    private renderer: THREE.WebGLRenderer
    private scene = new THREE.Scene()
    private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)

    private group = new THREE.Group()

    private input: HTMLDivElement
    private textCanvas: HTMLCanvasElement
    private textCtx: CanvasRenderingContext2D

    private geometry = new THREE.IcosahedronGeometry(0.2, SPHERE_DETAIL)
    private material: THREE.ShaderMaterial
    private mesh: THREE.InstancedMesh | null = null

    private dummy = new THREE.Object3D()
    private coords: Coord[] = []
    private particles: Particle[] = []
    private stringBox = { wTexture: 0, wScene: 0, hTexture: 0, hScene: 0 }
    private text = ""

    private pointer = new THREE.Vector2()
    private pointerOver = false

    private width = 1
    private height = 1
    private frameId = 0
    private lastT = 0
    private disposed = false

    constructor(container: HTMLElement, cfg: Config) {
        this.container = container
        this.cfg = cfg
        this.prev = { ...cfg }

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        this.renderer.setClearColor(0x000000, 0)
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        this.renderer.outputColorSpace = THREE.SRGBColorSpace
        const canvas = this.renderer.domElement
        canvas.style.position = "absolute"
        canvas.style.inset = "0"
        canvas.style.width = "100%"
        canvas.style.height = "100%"
        container.appendChild(canvas)
        this.scene.add(this.group)

        this.textCanvas = document.createElement("canvas")
        this.textCanvas.width = this.textCanvas.height = 0
        this.textCtx = this.textCanvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D

        this.input = document.createElement("div")
        this.input.contentEditable = "true"
        this.input.spellcheck = false
        this.input.setAttribute("aria-label", "Type to reshape the text")
        Object.assign(this.input.style, {
            position: "absolute",
            top: "0",
            left: "0",
            opacity: "0",
            whiteSpace: "pre",
            pointerEvents: "none",
            outline: "none",
        } as CSSStyleDeclaration)
        container.appendChild(this.input)

        const S = settingsFor(cfg)
        this.material = new THREE.ShaderMaterial({
            vertexShader: BUBBLE_VERTEX,
            fragmentShader: BUBBLE_FRAGMENT,
            uniforms: {
                uTint: { value: new THREE.Color(cfg.tint || DEFAULTS.tint) },
                uEdge: { value: EDGE_GLOW },
                uBody: { value: S.opacity },
            },

            depthTest: false,
            transparent: true,
        })

        this.applyInputStyle()
        this.setText(cfg.text)
        this.bindEvents()
    }

    private applyInputStyle() {
        const S = settingsFor(this.cfg)
        this.input.style.fontFamily = S.family
        this.input.style.fontSize = S.fontSize + "px"
        this.input.style.fontWeight = String(S.weight)
        this.input.style.fontStyle = S.fontStyle
        this.input.style.letterSpacing = S.tracking + "px"
        this.input.style.lineHeight = S.lineRatio * S.fontSize + "px"
    }

    private setText(text: string) {
        const value = typeof text === "string" ? text : ""
        this.input.innerHTML = value.replace(/\n/g, "<div><br></div>")
        this.text = value
        this.handleInput()
        this.refreshText()
    }

    private bindEvents() {
        this.input.addEventListener("keyup", this.onEdit)
        this.input.addEventListener("input", this.onEdit)
        this.container.addEventListener("pointerdown", this.onPointerDown)
        this.container.addEventListener("pointermove", this.onPointerMove)

        this.container.addEventListener("pointerleave", this.onPointerLeave)
        this.container.addEventListener("pointercancel", this.onPointerLeave)
    }

    private onEdit = () => {
        if (this.disposed) return
        this.handleInput()
        this.refreshText()
    }

    private onPointerDown = () => {
        if (this.disposed) return
        this.focusInput()
    }

    private onPointerMove = (e: PointerEvent) => {
        if (this.disposed) return
        const rect = this.container.getBoundingClientRect()
        this.pointer.set(
            (e.clientX - rect.left - rect.width / 2) * SCALE_FACTOR,

            -(e.clientY - rect.top - rect.height / 2) * SCALE_FACTOR
        )
        this.pointerOver = true
    }

    private onPointerLeave = () => {
        if (this.disposed) return

        this.pointerOver = false
    }

    private focusInput() {
        this.input.style.pointerEvents = "auto"
        this.input.focus({ preventScroll: true })
        this.input.style.pointerEvents = "none"
        const selection = window.getSelection()
        if (!selection) return
        const range = document.createRange()
        range.selectNodeContents(this.input)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
    }

    private handleInput() {
        const isNewLine = (el: ChildNode | null) => {
            const node = el as HTMLElement | null
            if (!node || !node.tagName) return false
            const tag = node.tagName.toUpperCase()
            if (tag !== "DIV" && tag !== "P") return false
            return node.innerHTML === "<br>" || node.innerHTML === "</br>"
        }

        if (isNewLine(this.input.firstChild)) this.input.firstChild?.remove()
        if (isNewLine(this.input.lastChild) && isNewLine(this.input.lastChild?.previousSibling ?? null)) {
            this.input.lastChild?.remove()
        }

        this.text = this.input.innerHTML
            .replaceAll("<p>", "\n")
            .replaceAll("</p>", "")
            .replaceAll("<div>", "\n")
            .replaceAll("</div>", "")
            .replaceAll("<br>", "")
            .replaceAll("<br/>", "")
            .replaceAll("&nbsp;", " ")

        this.stringBox.wTexture = this.input.clientWidth
        this.stringBox.wScene = this.stringBox.wTexture * SCALE_FACTOR
        this.stringBox.hTexture = this.input.clientHeight
        this.stringBox.hScene = this.stringBox.hTexture * SCALE_FACTOR
    }

    private refreshText() {
        this.sampleCoordinates()
        const S = settingsFor(this.cfg)

        this.particles = this.coords.map((c, i) => {
            const x = c.x * SCALE_FACTOR
            const y = c.y * SCALE_FACTOR

            const p = c.old && this.particles[i] ? this.particles[i] : makeBubble(x, y, S)
            if (c.toDelete) p.toDelete = true
            return p
        })

        this.recreateMesh()
    }

    private sampleCoordinates() {
        const S = settingsFor(this.cfg)
        const lines = this.text.split("\n")
        const lineCount = Math.max(1, lines.length)

        this.textCanvas.width = this.stringBox.wTexture
        this.textCanvas.height = this.stringBox.hTexture
        if (!(this.stringBox.wTexture > 0 && this.stringBox.hTexture > 0)) {
            this.coords = []
            return
        }

        this.textCtx.font = `${S.fontStyle} ${S.weight} ${S.fontSize}px ${S.family}`

        if ("letterSpacing" in this.textCtx) (this.textCtx as any).letterSpacing = `${S.tracking}px`
        this.textCtx.fillStyle = "#ffffff"
        this.textCtx.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height)
        for (let i = 0; i < lineCount; i++) {
            this.textCtx.fillText(lines[i], 0, ((i + 0.8) * this.stringBox.hTexture) / lineCount)
        }

        const w = this.textCanvas.width
        const h = this.textCanvas.height
        const data = this.textCtx.getImageData(0, 0, w, h).data
        const mask: boolean[][] = Array.from(Array(h), () => new Array(w))
        for (let i = 0; i < h; i++) {
            for (let j = 0; j < w; j++) mask[i][j] = data[(j + i * w) * 4] > 0
        }

        if (this.coords.length !== 0) {
            const keptCoords: Coord[] = []
            const keptParticles: Particle[] = []
            this.coords.forEach((c, i) => {
                if (c.toDelete) return
                keptCoords.push(c)
                if (this.particles[i]) keptParticles.push(this.particles[i])
            })
            this.coords = keptCoords
            this.particles = keptParticles

            this.coords.forEach((c) => {
                if (mask[c.y] && mask[c.y][c.x]) {
                    c.old = true
                    if (!c.toDelete) mask[c.y][c.x] = false
                } else {
                    c.toDelete = true
                }
            })
        }

        for (let i = 0; i < h; i += S.step) {
            for (let j = 0; j < w; j += S.step) {
                if (mask[i][j] && this.coords.length < MAX_PARTICLES) {
                    this.coords.push({ x: j, y: i, old: false, toDelete: false })
                }
            }
        }
    }

    private recreateMesh() {
        if (this.mesh) {
            this.group.remove(this.mesh)
            this.mesh.dispose()
        }
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.particles.length)

        const identity = new THREE.Matrix4()
        for (let i = 0; i < this.particles.length; i++) this.mesh.setMatrixAt(i, identity)
        this.mesh.instanceMatrix.needsUpdate = true
        this.mesh.frustumCulled = false
        this.mesh.position.x = -0.5 * this.stringBox.wScene
        this.mesh.position.y = -0.6 * this.stringBox.hScene
        this.group.add(this.mesh)
    }

    private updateMatrices(dt: number) {
        if (!this.mesh) return
        const k = dt * 60
        const S = settingsFor(this.cfg)
        const hoverOn = this.cfg.hoverOn !== false

        const localX = this.pointer.x + 0.5 * this.stringBox.wScene
        const localY = this.pointer.y + 0.6 * this.stringBox.hScene
        const radius = Math.max(0.001, S.hoverRadius)

        this.particles.forEach((p, i) => {
            if (p.toDelete) {
                p.scale -= S.growth * 6 * k
                if (p.scale < 0) p.scale = 0
            } else {
                p.scale += p.deltaScale * k
                if (p.scale >= p.maxScale) {
                    p.scale = 0
                    p.maxScale = Math.pow(Math.random(), 3) * S.bubble
                    p.deltaScale = S.growth * (0.4 + Math.random())
                }
            }

            const y = this.stringBox.hScene - p.y

            let target = 0
            if (hoverOn && this.pointerOver) {
                const dx = p.x - localX

                const dy = y - localY
                const d = Math.sqrt(dx * dx + dy * dy)

                const near = Math.max(0, 1 - d / radius)
                target = near * near
            }

            p.hover += (target - p.hover) * (1 - Math.exp(-dt * 5))
            p.lift = p.hover * S.hoverLift * p.riseJitter

            this.dummy.quaternion.identity()
            this.dummy.position.set(p.x, y + p.lift, p.z)
            this.dummy.scale.setScalar(Math.max(0, p.scale))
            this.dummy.updateMatrix()
            this.mesh!.setMatrixAt(i, this.dummy.matrix)
        })
        this.mesh.instanceMatrix.needsUpdate = true
    }

    private updateCamera() {
        const aspect = Math.max(1, this.width) / Math.max(1, this.height)
        const spanH = this.height * SCALE_FACTOR

        this.camera.aspect = aspect
        this.camera.position.set(0, 0, CAM_DISTANCE)
        this.camera.lookAt(0, 0, 0)
        this.camera.fov = 2 * Math.atan(spanH / 2 / CAM_DISTANCE) * (180 / Math.PI)
        this.camera.near = 0.1
        this.camera.far = CAM_DISTANCE + 100
        this.camera.updateProjectionMatrix()
    }

    start() {
        this.lastT = performance.now()

        this.renderer.domElement.style.cursor = "text"
        const loop = () => {
            this.frameId = requestAnimationFrame(loop)
            this.step()
        }
        this.frameId = requestAnimationFrame(loop)
    }

    private step() {
        if (this.disposed) return
        const now = performance.now()
        let dt = (now - this.lastT) / 1000
        this.lastT = now
        if (!isFinite(dt) || dt < 0) dt = 0

        if (dt > 0.05) dt = 0.05

        this.updateMatrices(dt)
        this.renderer.render(this.scene, this.camera)
    }

    setSize(width: number, height: number) {
        if (this.disposed) return
        this.width = Math.max(1, width)
        this.height = Math.max(1, height)
        this.renderer.setSize(this.width, this.height, false)
        this.updateCamera()
    }

    updateConfig(cfg: Config) {
        if (this.disposed) return
        const prev = this.prev
        this.cfg = cfg
        this.prev = { ...cfg }

        const fontChanged = JSON.stringify(cfg.font) !== JSON.stringify(prev.font)

        const reseed = cfg.scatter !== prev.scatter || cfg.density !== prev.density

        if (fontChanged || reseed) {
            if (fontChanged) this.applyInputStyle()
            if (reseed) {
                this.coords = []
                this.particles = []
            }
            this.handleInput()
            this.refreshText()
        } else if (cfg.text !== prev.text) {
            this.setText(cfg.text)
        }

        const S = settingsFor(cfg)
        this.material.uniforms.uTint.value.set(cfg.tint || DEFAULTS.tint)
        this.material.uniforms.uBody.value = S.opacity
    }

    dispose() {
        this.disposed = true
        cancelAnimationFrame(this.frameId)

        this.input.removeEventListener("keyup", this.onEdit)
        this.input.removeEventListener("input", this.onEdit)
        this.container.removeEventListener("pointerdown", this.onPointerDown)
        this.container.removeEventListener("pointermove", this.onPointerMove)
        this.container.removeEventListener("pointerleave", this.onPointerLeave)
        this.container.removeEventListener("pointercancel", this.onPointerLeave)

        if (this.mesh) {
            this.group.remove(this.mesh)
            this.mesh.dispose()
            this.mesh = null
        }
        this.geometry.dispose()
        this.material.dispose()
        this.scene.clear()
        this.renderer.dispose()
        this.renderer.domElement.remove()
        this.input.remove()
    }
}

export interface BubbleTypeProps {
    text?: string
    font?: FontValue
    tint?: string
    opacity?: number
    bubbleSize?: number
    density?: number
    speed?: number
    scatter?: number
    hoverOn?: boolean
    hover?: HoverOptions
    style?: React.CSSProperties
}

export default function BubbleType(props: BubbleTypeProps) {
    const {
        text = DEFAULTS.text,
        font = DEFAULT_FONT,
        tint = DEFAULTS.tint,
        opacity = DEFAULTS.opacity,
        bubbleSize = DEFAULTS.bubbleSize,
        density = DEFAULTS.density,
        speed = DEFAULTS.speed,
        scatter = DEFAULTS.scatter,
        hoverOn = DEFAULTS.hoverOn,
        hover = DEFAULTS.hover,
        style,
    } = props

    const containerRef = useRef<HTMLDivElement | null>(null)
    const sceneRef = useRef<BubbleTypeScene | null>(null)
    const cfgRef = useRef<Config>(null as any)

    cfgRef.current = {
        text,
        font: font ?? {},
        tint,
        opacity,
        bubbleSize,
        density,
        speed,
        scatter,
        hoverOn,

        hover: hover ?? DEFAULTS.hover,
    }

    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        let scene: BubbleTypeScene
        try {
            scene = new BubbleTypeScene(container, cfgRef.current)
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
        text,
        JSON.stringify(font),
        tint,
        opacity,
        bubbleSize,
        density,
        speed,
        scatter,
        hoverOn,
        JSON.stringify(hover),
    ])

    return (
        <div
            ref={containerRef}
            role="img"
            aria-label="Typed text blown as soap bubbles. Click it and type; move across it to float them up."
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                minWidth: 120,
                minHeight: 120,
                overflow: "hidden",
                ...style,
            }}
        />
    )
}

BubbleType.displayName = "Bubble Type"
