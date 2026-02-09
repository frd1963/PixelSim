// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e27);
scene.fog = new THREE.Fog(0x0a0e27, 50, 100);

// Camera
const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(0, 1, 6);

// (camera vertical alignment initialized after screen dimensions are declared)

// Renderer
const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ antialias: true });
const initialWidth = container.clientWidth || window.innerWidth;
const initialHeight = container.clientHeight || window.innerHeight;
renderer.setSize(initialWidth, initialHeight);
camera.aspect = initialWidth / initialHeight;
camera.updateProjectionMatrix();
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

// LED Screen dimensions
const screenWidth = 3; // 3 meters
const screenHeight = 2; // 2 meters
let pixelPitch = 0.0089; // 8.9 mm in meters

// Calculate number of pixels
let pixelsX = Math.round(screenWidth / pixelPitch);
let pixelsY = Math.round(screenHeight / pixelPitch);

let currentAnimation = 'static';
let animationTime = 0;
// Video element for playing video files
let videoElement = null;
let videoCanvas = null;
let isVideoPlaying = false;

// Animation functions
const animations = {
    static: (x, y, time) => {
        const hue = ((x / pixelsX) * 360 + (y / pixelsY) * 60) % 360;
        const saturation = 85 + Math.random() * 15;
        const lightness = 55 + Math.sin(x * 0.02) * 8 + Math.cos(y * 0.02) * 8;
        return { hue, saturation, lightness };
    },

    rainbow: (x, y, time) => {
        const hue = (((x / pixelsX) * 360 + (y / pixelsY) * 60 + time * 100) % 360);
        const saturation = 90;
        const lightness = 50;
        return { hue, saturation, lightness };
    },

    pulse: (x, y, time) => {
        const hue = ((x / pixelsX) * 360 + (y / pixelsY) * 60) % 360;
        const saturation = 85;
        const lightness = 30 + Math.sin(time * 3) * 20 + 20;
        return { hue, saturation, lightness };
    },

    chase: (x, y, time) => {
        const chasePos = (time * pixelsX) % pixelsX;
        const distance = Math.abs(x - chasePos);
        const hue = 200 + distance * 2;
        const saturation = 80;
        const lightness = distance < 50 ? 50 + (1 - distance / 50) * 30 : 20;
        return { hue, saturation, lightness };
    },

    wave: (x, y, time) => {
        const wave = Math.sin((x / pixelsX) * Math.PI * 2 + time * 3) * 30;
        const brightness = 50 + wave;
        const hue = ((x / pixelsX) * 360 + (y / pixelsY) * 60) % 360;
        return { hue, saturation: 85, lightness: brightness };
    },

    strobe: (x, y, time) => {
        const strobePhase = Math.floor(time * 4) % 2;
        const hue = ((x / pixelsX) * 360 + (y / pixelsY) * 60) % 360;
        const lightness = strobePhase === 0 ? 60 : 20;
        return { hue, saturation: 85, lightness };
    },

    scroll: (x, y, time) => {
        const scrollPos = (time * pixelsX * 0.5) % pixelsX;
        const hue = ((x - scrollPos) / pixelsX * 360) % 360;
        const saturation = 90;
        const lightness = 50;
        return { hue, saturation, lightness };
    },

    video: null // Will be set when video is loaded
};

// Brightness in nits
let brightnessNits = 1000; // default

// Map brightness (nits) to LED scale and bleed parameters
function computeBrightnessParams(nits) {
    const baseline = 450; // nits where source material is at full LED brightness
    const maxNits = 6000; // UI max
    if (nits <= baseline) {
        // Map 0..baseline to gamma range 3..1 (0 -> gamma 3 dark, baseline -> gamma 1)
        const frac = nits / baseline;
        const gamma = 1 + (1 - frac) * 2; // range [1,3]
        return { gamma, bleedAlpha: 0, blurRadius: 0 };
    }

    // Above baseline: LEDs stay at baseline gamma=1; extra brightness becomes bleed
    const gamma = 1;
    const over = Math.max(0, Math.min(1, (nits - baseline) / (maxNits - baseline)));
    const maxBleedAlpha = 0.8;
    const maxBlur = 20; // px
    const bleedAlpha = Math.min(0.9, over * maxBleedAlpha);
    const blurRadius = over * maxBlur;
    return { gamma, bleedAlpha, blurRadius };
}

// Color helpers: HSL <-> RGB (0..1 ranges)
function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r1 = 0, g1 = 0, b1 = 0;
    if (0 <= hp && hp < 1) { r1 = c; g1 = x; b1 = 0; }
    else if (1 <= hp && hp < 2) { r1 = x; g1 = c; b1 = 0; }
    else if (2 <= hp && hp < 3) { r1 = 0; g1 = c; b1 = x; }
    else if (3 <= hp && hp < 4) { r1 = 0; g1 = x; b1 = c; }
    else if (4 <= hp && hp < 5) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    const m = l - c / 2;
    return { r: r1 + m, g: g1 + m, b: b1 + m };
}

function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h = h * 60;
    }
    return { h, s, l };
}

// Canvas sizing safety
const BASE_SCALE = 10; // default pixels-per-LED scale
const MAX_CANVAS_DIM = 8192; // maximum canvas width/height to avoid huge allocations

function computeCanvasScale(pixelsX, pixelsY) {
    let scale = BASE_SCALE;
    if (pixelsX * scale > MAX_CANVAS_DIM) {
        scale = Math.floor(MAX_CANVAS_DIM / pixelsX);
    }
    if (pixelsY * scale > MAX_CANVAS_DIM) {
        scale = Math.floor(MAX_CANVAS_DIM / pixelsY);
    }
    if (scale < 1) scale = 1;
    return scale;
}

function showCanvasWarning(msg) {
    let warn = document.getElementById('canvasWarning');
    if (!warn) {
        warn = document.createElement('div');
        warn.id = 'canvasWarning';
        warn.style.position = 'absolute';
        warn.style.top = '12px';
        warn.style.right = '12px';
        warn.style.background = 'rgba(255,200,0,0.95)';
        warn.style.color = '#000';
        warn.style.padding = '8px 10px';
        warn.style.borderRadius = '6px';
        warn.style.zIndex = 2000;
        warn.style.fontFamily = 'sans-serif';
        warn.style.fontSize = '13px';
        warn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
        const parent = container || document.body;
        parent.appendChild(warn);
    }
    warn.textContent = msg;
}

function hideCanvasWarning() {
    const warn = document.getElementById('canvasWarning');
    if (warn && warn.parentNode) warn.parentNode.removeChild(warn);
}

// Update LED texture with animation
function updateLEDTexture(canvas, time, cameraDistance) {
    const ctx = canvas.getContext('2d');
    const scale = computeCanvasScale(pixelsX, pixelsY);
    const ledSize = Math.round((2.7 / (pixelPitch * 1000)) * scale);

    // Fill with black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Get current animation function
    const animFunc = animations[currentAnimation] || animations.static;

    // Handle video animation specially
    if (currentAnimation === 'video' && videoElement && isVideoPlaying) {
        drawVideoFrame(canvas, scale, ledSize, cameraDistance);
        return;
    }

    // Draw LEDs onto offscreen "on" canvas first (transparent background)
    ledsOnCanvas.width = canvas.width;
    ledsOnCanvas.height = canvas.height;
    const onCtx = ledsOnCanvas.getContext('2d');
    onCtx.clearRect(0, 0, ledsOnCanvas.width, ledsOnCanvas.height);


    // Calculate blur based on distance - simulate pixel blending at distance
    // At ~8m and beyond, pixels start to blend together visually
    const blurThreshold = 8;
    const maxBlurDistance = 20;
    let pixelBlur = 0;
    
    if (cameraDistance > blurThreshold) {
        const blurAmount = Math.min(1, (cameraDistance - blurThreshold) / (maxBlurDistance - blurThreshold));
        pixelBlur = blurAmount * 3; // Max blur of 3 pixels
    }

    // Compute brightness params once per frame
    const { gamma, bleedAlpha, blurRadius } = computeBrightnessParams(brightnessNits);

    // Draw individual LEDs onto the on-canvas
    for (let y = 0; y < pixelsY; y++) {
        for (let x = 0; x < pixelsX; x++) {
            const centerX = x * scale + scale / 2;
            const centerY = y * scale + scale / 2;
            const radius = ledSize / 2;

            // Get color from animation function
            let { hue, saturation, lightness } = animFunc(x, y, time);

            // At distance, reduce brightness to simulate pixels blending with black background
            if (cameraDistance > blurThreshold) {
                const blendFactor = Math.min(1, (cameraDistance - blurThreshold) / (maxBlurDistance - blurThreshold));
                lightness = lightness * (1 - blendFactor * 0.6) + 25 * blendFactor * 0.6;
            }
            // Convert HSL to RGB (0..1), apply gamma (gamma>=1 darkens, 1=no change)
            const lNorm = Math.min(1, lightness / 100);
            const sNorm = Math.min(1, saturation / 100);
            const rgb = hslToRgb(hue, sNorm, lNorm);
            const rG = Math.pow(Math.max(0, Math.min(1, rgb.r)), gamma);
            const gG = Math.pow(Math.max(0, Math.min(1, rgb.g)), gamma);
            const bG = Math.pow(Math.max(0, Math.min(1, rgb.b)), gamma);
            const rByte = Math.round(rG * 255);
            const gByte = Math.round(gG * 255);
            const bByte = Math.round(bG * 255);

            onCtx.fillStyle = `rgb(${rByte}, ${gByte}, ${bByte})`;
            onCtx.beginPath();
            onCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            onCtx.fill();

            // Add a subtle highlight using the increased lightness, also gamma-corrected
            const highlightL = Math.min(1, (Math.min(lightness + 20, 95)) / 100);
            const highlightRgb = hslToRgb(hue, sNorm, highlightL);
            const hr = Math.round(Math.pow(highlightRgb.r, gamma) * 255);
            const hg = Math.round(Math.pow(highlightRgb.g, gamma) * 255);
            const hb = Math.round(Math.pow(highlightRgb.b, gamma) * 255);
            onCtx.fillStyle = `rgb(${hr}, ${hg}, ${hb})`;
            onCtx.beginPath();
            onCtx.arc(centerX - radius * 0.3, centerY - radius * 0.3, radius * 0.4, 0, Math.PI * 2);
            onCtx.fill();
        }
    }

    // Composite onto main canvas: black background, then blurred (bleed) on-canvas, then sharp on-canvas
    // Fill main canvas with black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Bleed and blur based on brightness nits, plus small distance-based pixel blur
    const finalBlur = blurRadius + pixelBlur; // combine brightness-driven blur with distance micro-blur

    if (bleedAlpha > 0.01 && finalBlur > 0) {
        ctx.save();
        ctx.filter = `blur(${finalBlur}px)`;
        ctx.globalAlpha = bleedAlpha;
        ctx.drawImage(ledsOnCanvas, 0, 0);
        ctx.restore();
    }

    // Draw crisp LEDs on top
    ctx.drawImage(ledsOnCanvas, 0, 0);
}

// Create the LED screen
const ledCanvas = document.createElement('canvas');
let initialScale = computeCanvasScale(pixelsX, pixelsY);
ledCanvas.width = pixelsX * initialScale;
ledCanvas.height = pixelsY * initialScale;
// Offscreen canvas used to draw the LED lit areas (for bleed effect)
const ledsOnCanvas = document.createElement('canvas');
ledsOnCanvas.width = ledCanvas.width;
ledsOnCanvas.height = ledCanvas.height;
if (initialScale < BASE_SCALE) {
    showCanvasWarning(`Canvas scale reduced to ${initialScale} to limit memory usage.`);
} else {
    hideCanvasWarning();
}

// Position camera so its vertical height matches the bottom row of pixels
function updateCameraVerticalPosition() {
    // bottom row center Y in world coordinates
    const bottomRowY = -screenHeight / 2 + (pixelPitch / 2);
    camera.position.x = 0; // center horizontally in column
    camera.position.y = bottomRowY;
    camera.lookAt(new THREE.Vector3(0, bottomRowY, 0));
}

// initial vertical alignment
updateCameraVerticalPosition();

// Initialize texture once the offscreen canvas exists
updateLEDTexture(ledCanvas, 0, 6);

const ledTexture = new THREE.CanvasTexture(ledCanvas);
ledTexture.magFilter = THREE.LinearFilter;
ledTexture.minFilter = THREE.LinearFilter;
const screenGeometry = new THREE.PlaneGeometry(screenWidth, screenHeight);
const screenMaterial = new THREE.MeshPhongMaterial({
    map: ledTexture,
    emissive: 0x444444,
    emissiveIntensity: 0.8,
    shininess: 100,
});
let screenMesh = new THREE.Mesh(screenGeometry, screenMaterial);
screenMesh.position.z = 0;
scene.add(screenMesh);

// Add a subtle glow effect with a second layer
const glowGeometry = new THREE.PlaneGeometry(screenWidth + 0.05, screenHeight + 0.05);
const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.1,
});
const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
glowMesh.position.z = -0.01;
scene.add(glowMesh);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 5, 5);
directionalLight.target.position.set(0, 0, 0);
scene.add(directionalLight);
scene.add(directionalLight.target);

// Add a slight back light for depth
const backLight = new THREE.DirectionalLight(0x0088ff, 0.3);
backLight.position.set(-5, 0, -5);
scene.add(backLight);

// Distance slider interaction
const distanceSlider = document.getElementById('distanceSlider');
const distanceValue = document.getElementById('distanceValue');
const animationSelect = document.getElementById('animationSelect');
const pixelPitchInput = document.getElementById('pixelPitchInput');
const pixelPitchValue = document.getElementById('pixelPitchValue');
const brightnessInput = document.getElementById('brightnessInput');
const brightnessValue = document.getElementById('brightnessValue');

// initialize brightness display
brightnessValue.textContent = Math.round(brightnessNits);

distanceSlider.addEventListener('input', (e) => {
    const distance = parseFloat(e.target.value);
    camera.position.z = distance;
    distanceValue.textContent = distance.toFixed(1);
});


// Handle window resize
window.addEventListener('resize', () => {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
});

// Function to draw video frame on LED canvas
function drawVideoFrame(canvas, scale, ledSize, cameraDistance) {
    if (!videoElement || !videoCanvas) return;

    const ctx = canvas.getContext('2d');
    const vCtx = videoCanvas.getContext('2d', { willReadFrequently: true });

    // Draw video frame to temporary canvas scaled to LED grid
    videoCanvas.width = pixelsX;
    videoCanvas.height = pixelsY;
    vCtx.drawImage(videoElement, 0, 0, pixelsX, pixelsY);

    // Get video pixel data
    const imageData = vCtx.getImageData(0, 0, pixelsX, pixelsY);
    const data = imageData.data;

    // Prepare the offscreen on-canvas
    ledsOnCanvas.width = canvas.width;
    ledsOnCanvas.height = canvas.height;
    const onCtx = ledsOnCanvas.getContext('2d');
    onCtx.clearRect(0, 0, ledsOnCanvas.width, ledsOnCanvas.height);

    // Precompute distance micro-blur and brightness params
    const blurThreshold = 8;
    const maxBlurDistance = 20;
    let pixelBlur = 0;
    if (cameraDistance > blurThreshold) {
        const blurAmount = Math.min(1, (cameraDistance - blurThreshold) / (maxBlurDistance - blurThreshold));
        pixelBlur = blurAmount * 3;
    }
        const { gamma, bleedAlpha, blurRadius } = computeBrightnessParams(brightnessNits);

    // Draw LEDs onto the on-canvas based on video colors
    for (let y = 0; y < pixelsY; y++) {
        for (let x = 0; x < pixelsX; x++) {
            const idx = (y * pixelsX + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            // Convert RGB to HSL (simple conversion)
            const rf = r / 255, gf = g / 255, bf = b / 255;
            const max = Math.max(rf, gf, bf);
            const min = Math.min(rf, gf, bf);
            let h = 0, s = 0;
            const l = (max + min) / 2;

            if (max !== min) {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case rf: h = (gf - bf) / d + (gf < bf ? 6 : 0); break;
                    case gf: h = (bf - rf) / d + 2; break;
                    case bf: h = (rf - gf) / d + 4; break;
                }
                h = (h / 6) * 360;
            }

            // Work in 0..1 normalized ranges for lightness/saturation
            let lightness = l; // 0..1
            let saturation = s; // 0..1

            // Apply distance-based brightness reduction to normalized lightness
            const blurThresholdInner = 8;
            const maxBlurDistanceInner = 20;
            if (cameraDistance > blurThresholdInner) {
                const blendFactor = Math.min(1, (cameraDistance - blurThresholdInner) / (maxBlurDistanceInner - blurThresholdInner));
                lightness = lightness * (1 - blendFactor * 0.6) + 0.25 * blendFactor * 0.6;
            }

            // Convert HSL to RGB (0..1)
            const rgb = hslToRgb(h, saturation, lightness);

            // Apply gamma correction (gamma>=1 darkens; gamma==1 leaves unchanged)
            const rG = Math.pow(Math.max(0, Math.min(1, rgb.r)), gamma);
            const gG = Math.pow(Math.max(0, Math.min(1, rgb.g)), gamma);
            const bG = Math.pow(Math.max(0, Math.min(1, rgb.b)), gamma);

            const rByte = Math.round(rG * 255);
            const gByte = Math.round(gG * 255);
            const bByte = Math.round(bG * 255);

            const centerX = x * scale + scale / 2;
            const centerY = y * scale + scale / 2;
            const radius = ledSize / 2;

            // Draw main LED circle onto the on-canvas using RGB so background stays black
            onCtx.fillStyle = `rgb(${rByte}, ${gByte}, ${bByte})`;
            onCtx.beginPath();
            onCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            onCtx.fill();

            // Add subtle highlight (brighter, gamma-corrected)
            const highlightL = Math.min(1, lightness + 0.2);
            const highlightRgb = hslToRgb(h, saturation, highlightL);
            const hr = Math.round(Math.pow(Math.max(0, Math.min(1, highlightRgb.r)), gamma) * 255);
            const hg = Math.round(Math.pow(Math.max(0, Math.min(1, highlightRgb.g)), gamma) * 255);
            const hb = Math.round(Math.pow(Math.max(0, Math.min(1, highlightRgb.b)), gamma) * 255);
            onCtx.fillStyle = `rgb(${hr}, ${hg}, ${hb})`;
            onCtx.beginPath();
            onCtx.arc(centerX - radius * 0.3, centerY - radius * 0.3, radius * 0.4, 0, Math.PI * 2);
            onCtx.fill();
        }
    }

    // Composite onto main canvas: black background, then blurred (bleed) on-canvas, then sharp on-canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const finalBlur = blurRadius + pixelBlur;

    if (bleedAlpha > 0.01 && finalBlur > 0) {
        ctx.save();
        ctx.filter = `blur(${finalBlur}px)`;
        ctx.globalAlpha = bleedAlpha;
        ctx.drawImage(ledsOnCanvas, 0, 0);
        ctx.restore();
    }

    // Draw crisp LEDs on top
    ctx.drawImage(ledsOnCanvas, 0, 0);
}

// Video input handler
const videoInput = document.getElementById('videoInput');
const videoInputGroup = document.getElementById('videoInputGroup');


// Update the animation select listener
animationSelect.addEventListener('change', (e) => {
    currentAnimation = e.target.value;
    videoInputGroup.style.display = currentAnimation === 'video' ? 'block' : 'none';
    
    if (currentAnimation === 'video' && videoElement) {
        videoElement.play();
        isVideoPlaying = true;
    }
});

pixelPitchInput.addEventListener('input', (e) => {
    const newPitch = parseFloat(e.target.value);
    pixelPitchValue.textContent = newPitch.toFixed(1);
    
    // Update pixel pitch and recalculate grid
    pixelPitch = newPitch / 1000; // Convert mm to meters
    pixelsX = Math.round(screenWidth / pixelPitch);
    pixelsY = Math.round(screenHeight / pixelPitch);
    
    // Recreate the canvas with new dimensions
    const newScale = computeCanvasScale(pixelsX, pixelsY);
    ledCanvas.width = pixelsX * newScale;
    ledCanvas.height = pixelsY * newScale;
    ledsOnCanvas.width = ledCanvas.width;
    ledsOnCanvas.height = ledCanvas.height;
    if (newScale < BASE_SCALE) {
        showCanvasWarning(`Canvas scale reduced to ${newScale} to limit memory usage.`);
    } else {
        hideCanvasWarning();
    }
    
    // Update the texture
    updateLEDTexture(ledCanvas, animationTime, camera.position.z);
    ledTexture.needsUpdate = true;
});

// Brightness control
brightnessInput.addEventListener('input', (e) => {
    brightnessNits = parseFloat(e.target.value);
    brightnessValue.textContent = Math.round(brightnessNits);
    // Update material emissive intensity to reflect brightness (scaled)
    if (screenMaterial) {
        // Safely map emissive intensity from brightness (nits).
        // Baseline nits (~450) corresponds to emissiveIntensity ~1.
        const baseline = 450;
        let emissive = brightnessNits <= baseline ? 1 : Math.min(10, brightnessNits / baseline);
        // Ensure a finite numeric value
        if (!Number.isFinite(emissive) || emissive <= 0) emissive = 1;
        screenMaterial.emissiveIntensity = emissive;
    }
});

videoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Create video element if it doesn't exist
    if (!videoElement) {
        videoElement = document.createElement('video');
        videoElement.crossOrigin = 'anonymous';
        videoElement.loop = true;
        videoCanvas = document.createElement('canvas');
    }
    
    // Load video file
    const url = URL.createObjectURL(file);
    videoElement.src = url;
    
    // Start playing when ready
    videoElement.addEventListener('canplay', () => {
        isVideoPlaying = true;
        videoElement.play();
    }, { once: true });
});

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    // Update animation time
    animationTime += 0.016; // ~60fps

    // Update LED texture with current animation and camera distance
    updateLEDTexture(ledCanvas, animationTime, camera.position.z);
    ledTexture.needsUpdate = true;

    // Subtle rotation of the screen for visual effect
    screenMesh.rotation.y = Math.sin(Date.now() * 0.0001) * 0.02;
    glowMesh.rotation.y = screenMesh.rotation.y;

    renderer.render(scene, camera);
}

animate();
