// ==========================================
// 調整用パラメータ（VSCodeでここを書き換えてください）
// ==========================================

// --- 密度と発生 ---
const MAX_PARTICLES = 700;      // 画面に同時に存在する文字の最大数。増やすとモヤが濃くなります
const SPAWN_RATE = 15;          // 毎フレーム（1/60秒）に湧き出る数。増やすと払った後の復活が早まります
const MOTION_THRESHOLD = 70;    // 手を動かした時の検知感度。数値を下げると、小さな動きでも文字が反応します
const PARTICLE_SIZE = 10;       // 文字の大きさ（pt）

// --- 範囲の限定（顔の横幅 fWidth に対する倍率） ---
const RANGE_X = 1.8;            // 横方向の広がり。0.6は顔の幅の60%程度まで広がる意味です
const RANGE_Y_TOP = -0.4;       // 上方向（頭頂部）への制限。0に近づけるほど、頭の上にはみ出さなくなります
const RANGE_Y_BOTTOM = 0.6;    // 下方向（目元）への制限。まぶたに被る深さを決めます
const CENTER_VOID = 15;         // ★重要：中心（額のど真ん中）の禁止区域。大きくすると中央の「だま」が消えます

// --- 振り切られ感（残留と消失）の調整 ---
const LEAVE_DISTANCE = 230;     // ★顔の中心からこの距離（px）離れた文字は、振り切られたと見なして消します
const FOLLOW_STRENGTH = 0.001;  // 顔への吸着力。小さいほど、顔が動いたときに文字がその場に取り残されます
const VISCOSITY = 0.92;         // 空気の粘り気。1に近いほど止まらず、低いほどネットリとその場に停滞します

// --- 質感（ヌメヌメした動き） ---
const SWAY_FORCE = 0.8;         // 止まっている時のウネウネとした揺らぎの強さ
const SWAY_SPEED = 0.01;       // 揺らぎの速度。数値を下げると、よりネットリとスローに動きます

// --- アクション（払い・瞬き） ---
const FADE_IN_SPEED = 0.04;     // 現れる時の滑らかさ。数値を下げると、ジワ〜ッと現れるようになります
const FADE_OUT_SPEED = 10;      // ★消える速さ。数値を上げると、振り切られた瞬間にパッと消えます
const FLEE_SPEED = 7;           // 手で払った時の初速
const BLINK_FLEE_FORCE = 10;    // 瞬きをした時に四方に弾け飛ぶ力の強さ

// ==========================================

let video;
let faceMesh;
let detections = [];
let particles = [];
let prevFrame;
let motionCanvas;
let wasBlinking = false;
const VIDEO_W = 640;
const VIDEO_H = 480;

function setup() {
    createCanvas(windowWidth, windowHeight);
    
    video = createCapture(VIDEO);
    video.size(VIDEO_W, VIDEO_H);
    video.hide();

    prevFrame = createImage(VIDEO_W, VIDEO_H);
    motionCanvas = createGraphics(VIDEO_W / 2, VIDEO_H / 2);

    faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });
    faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });
    faceMesh.onResults(results => { detections = results.multiFaceLandmarks; });

    const camera = new Camera(video.elt, {
        onFrame: async () => { await faceMesh.send({ image: video.elt }); },
        width: VIDEO_W,
        height: VIDEO_H
    });
    camera.start();

    textFont('CineCaption');
    textSize(PARTICLE_SIZE);
    textAlign(CENTER, CENTER);
}

function draw() {
    background(0);

    let displayW = width;
    let displayH = (VIDEO_H / VIDEO_W) * width;
    if (displayH < height) {
        displayH = height;
        displayW = (VIDEO_W / VIDEO_H) * height;
    }

    push();
    translate(width, 0);
    scale(-1, 1);
    image(video, (width - displayW) / 2, (height - displayH) / 2, displayW, displayH);
    pop();

    calculateMotion();

    if (detections && detections.length > 0) {
        const landmarks = detections[0];
        const getCanvasPos = (pt) => {
            return createVector(
                (1 - pt.x) * displayW + (width - displayW) / 2,
                pt.y * displayH + (height - displayH) / 2
            );
        };

        let foreheadCenter = getCanvasPos(landmarks[10]);
        let leftEyePos = getCanvasPos(landmarks[159]);
        let rightEyePos = getCanvasPos(landmarks[386]);
        let faceWidth = dist(getCanvasPos(landmarks[234]).x, 0, getCanvasPos(landmarks[454]).x, 0);

        // 瞬き検知（上下まぶたの距離）
        let eyeDist = dist(getCanvasPos(landmarks[159]).y, 0, getCanvasPos(landmarks[145]).y, 0);
        let isBlinking = eyeDist < (faceWidth * 0.045);

        // 粒子の生成
        for (let i = 0; i < SPAWN_RATE; i++) { 
            if (particles.length < MAX_PARTICLES) {
                particles.push(new Particle(foreheadCenter, faceWidth));
            }
        }

        const faceData = { center: foreheadCenter };
        for (let i = particles.length - 1; i >= 0; i--) {
            let p = particles[i];
            
            // 瞬きでの飛散アクション
            if (isBlinking && !wasBlinking) {
                p.blinkExplode(leftEyePos, faceWidth * 0.4);
                p.blinkExplode(rightEyePos, faceWidth * 0.4);
            }

            p.applyMotion(motionCanvas, displayW, displayH);
            p.update(faceData);
            p.display();
            
            // 透明になった粒子を削除
            if (p.alpha <= 0) {
                particles.splice(i, 1);
            }
        }
        wasBlinking = isBlinking;
    } else {
        // 顔が見失われた際の処理
        for (let i = particles.length - 1; i >= 0; i--) {
            particles[i].update(null);
            particles[i].display();
            if (particles[i].alpha <= 0) particles.splice(i, 1);
        }
    }
}

function calculateMotion() {
    motionCanvas.clear();
    video.loadPixels();
    prevFrame.loadPixels();
    
    if (video.pixels.length > 0) {
        motionCanvas.loadPixels();
        for (let y = 0; y < VIDEO_H; y += 20) { 
            for (let x = 0; x < VIDEO_W; x += 20) {
                let index = (x + y * VIDEO_W) * 4;
                if (abs(video.pixels[index] - prevFrame.pixels[index]) > MOTION_THRESHOLD) {
                    motionCanvas.fill(255);
                    motionCanvas.noStroke();
                    motionCanvas.ellipse(x / 2, y / 2, 40, 40); 
                }
            }
        }
        prevFrame.copy(video, 0, 0, VIDEO_W, VIDEO_H, 0, 0, VIDEO_W, VIDEO_H);
    }
}

class Particle {
    constructor(spawnCenter, fWidth) {
        this.char = random(["眠", "気"]);
        
        // 分散範囲の計算
        let rx = random(-fWidth * RANGE_X, fWidth * RANGE_X);
        let ry = random(fWidth * RANGE_Y_TOP, fWidth * RANGE_Y_BOTTOM);
        
        // 額の中心（だま）を避ける処理
        if (abs(rx) < CENTER_VOID && abs(ry) < CENTER_VOID) {
            rx += (rx > 0 ? CENTER_VOID : -CENTER_VOID);
        }

        this.targetOffset = createVector(rx, ry);
        this.pos = p5.Vector.add(spawnCenter, this.targetOffset);
        
        this.vel = createVector(0, 0);
        this.acc = createVector(0, 0);
        this.alpha = 0;
        this.maxAlpha = random(120, 200);
        
        this.noiseX = random(10000);
        this.noiseY = random(10000);
        this.isFadingOut = false;
    }

    blinkExplode(origin, limitDist) {
        let dir = p5.Vector.sub(this.pos, origin);
        if (dir.mag() < limitDist) { 
            this.vel.add(dir.normalize().mult(BLINK_FLEE_FORCE));
            this.isFadingOut = true;
        }
    }

    applyMotion(mCanvas, dW, dH) {
        let mx = map(this.pos.x, (width - dW) / 2, (width + dW) / 2, VIDEO_W / 2, 0);
        let my = map(this.pos.y, (height - dH) / 2, (height + dH) / 2, 0, VIDEO_H / 2);
        if (mx > 0 && mx < VIDEO_W / 2 && my > 0 && my < VIDEO_H / 2) {
            if (mCanvas.get(mx, my)[0] > 200) {
                this.vel.add(p5.Vector.random2D().mult(FLEE_SPEED)); 
                this.isFadingOut = true;
            }
        }
    }

    applyForce(force) { this.acc.add(force); }

    update(faceData) {
        // 独自の揺らぎ計算
        let nx = (noise(this.noiseX) - 0.5) * SWAY_FORCE;
        let ny = (noise(this.noiseY) - 0.5) * SWAY_FORCE;
        this.applyForce(createVector(nx, ny));
        this.noiseX += SWAY_SPEED;
        this.noiseY += SWAY_SPEED;

        if (faceData && !this.isFadingOut) {
            let targetPos = p5.Vector.add(faceData.center, this.targetOffset);
            let desired = p5.Vector.sub(targetPos, this.pos);
            
            // 非常に弱い力で顔についていく
            this.applyForce(desired.mult(FOLLOW_STRENGTH));

            // 振り切られ判定
            if (dist(this.pos.x, this.pos.y, faceData.center.x, faceData.center.y) > LEAVE_DISTANCE) {
                this.isFadingOut = true;
            }
        }

        this.vel.add(this.acc);
        this.pos.add(this.vel);
        this.vel.mult(VISCOSITY);
        this.acc.mult(0);

        if (!faceData) this.isFadingOut = true;

        if (!this.isFadingOut) {
            this.alpha = lerp(this.alpha, this.maxAlpha, FADE_IN_SPEED);
        } else { 
            this.alpha -= FADE_OUT_SPEED; 
        }
    }

    display() {
        if (this.alpha > 1) {
            fill(255, this.alpha);
            noStroke();
            push();
            translate(this.pos.x, this.pos.y);
            rotate(noise(this.noiseX) * 0.4 - 0.2);
            text(this.char, 0, 0);
            pop();
        }
    }
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }