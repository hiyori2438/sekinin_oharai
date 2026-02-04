// ==========================================
// 調整用パラメータ：ここを書き換えてカスタマイズしてください
// ==========================================

// --- 1. 量と見た目の調整 ---
const MAX_PARTICLES = 600;   // 画面に出る「責任」の最大数。増やすと重くなります
const SPAWN_RATE = 5;        // 降ってくる頻度。1〜10くらいで調整（大きいほど豪雨）
const PARTICLE_SIZE = 11;    // 文字の大きさ

// --- 2. 物理挙動（落下感）の調整 ---
const GRAVITY = 0.25;        // 重力。大きいほど速く、重々しく落ちます
const FRICTION = 0.93;       // 空気抵抗。1に近いほどスルスル落ち、小さいほどドロっと落ちます

// --- 3. 体への「積もり方」の調整 ---
const STACK_SENSITIVITY = 127; // 判定のしきい値。0〜255（小さいほど少しの影でも反応します）
const STICKY_THRESHOLD = 45;   // ★粘着力。シルエットから外れても何フレーム耐えるか（大きくすると落ちにくくなる）

// --- 4. 払い・落下の調整 ---
const MOTION_THRESHOLD = 90;   // 払う時の感度。小さいほど敏感に反応します
const FALL_SPEED_MIN = 3;      // 払われた瞬間の、下方向への最小初速
const FALL_SPEED_MAX = 6;      // 払われた瞬間の、下方向への最大初速
const FADE_OUT_SPEED = 5;     // 消えていく速さ（0〜255）。大きいほどすぐ消えます

const DEBUG_MODE = false;      // trueにすると判定用の青い影が見えます
// ==========================================

let video, selfieSegmentation, prevFrame, motionCanvas, maskImg;
let particles = [];
const VIDEO_W = 640;
const VIDEO_H = 480;

function setup() {
    createCanvas(windowWidth, windowHeight);
    video = createCapture(VIDEO);
    video.size(VIDEO_W, VIDEO_H);
    video.hide();

    prevFrame = createImage(VIDEO_W, VIDEO_H);
    motionCanvas = createGraphics(VIDEO_W / 2, VIDEO_H / 2);
    maskImg = createImage(VIDEO_W, VIDEO_H);

    selfieSegmentation = new SelfieSegmentation({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
    });
    selfieSegmentation.setOptions({ modelSelection: 1 });

    selfieSegmentation.onResults((results) => {
        maskImg.drawingContext.clearRect(0, 0, VIDEO_W, VIDEO_H);
        maskImg.drawingContext.drawImage(results.segmentationMask, 0, 0, VIDEO_W, VIDEO_H);
        maskImg.loadPixels(); 
    });

    const camera = new Camera(video.elt, {
        onFrame: async () => { await selfieSegmentation.send({ image: video.elt }); },
        width: VIDEO_W, height: VIDEO_H
    });
    camera.start();

    // ★ ここを変更：フォントを明朝体（標準的な serif）に指定
    textFont('serif');
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
    let offsetX = (width - displayW) / 2;
    let offsetY = (height - displayH) / 2;

    push();
    translate(width, 0); scale(-1, 1);
    image(video, offsetX, offsetY, displayW, displayH);
    if (DEBUG_MODE && maskImg) {
        push(); tint(0, 150, 255, 120);
        image(maskImg, offsetX, offsetY, displayW, displayH);
        pop();
    }
    pop();

    calculateMotion();

    // 一定間隔で新しい文字を生成
    if (frameCount % 5 === 0 && particles.length < MAX_PARTICLES) {
        particles.push(new Responsibility(random(width), -20));
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.applyMotion(motionCanvas, displayW, displayH);
        p.update(maskImg, offsetX, offsetY, displayW, displayH);
        p.display();
        if (p.isDead) particles.splice(i, 1);
    }
}

// 動き（払い）を計算する関数
function calculateMotion() {
    motionCanvas.clear();
    video.loadPixels();
    prevFrame.loadPixels();
    if (video.pixels.length > 0) {
        motionCanvas.loadPixels();
        for (let y = 0; y < VIDEO_H; y += 20) {
            for (let x = 0; x < VIDEO_W; x += 20) {
                let index = (x + y * VIDEO_W) * 4;
                // 前のフレームとの色の差を見て「動き」を検知
                if (abs(video.pixels[index] - prevFrame.pixels[index]) > MOTION_THRESHOLD) {
                    motionCanvas.fill(255);
                    motionCanvas.ellipse(x / 2, y / 2, 50, 50);
                }
            }
        }
        prevFrame.copy(video, 0, 0, VIDEO_W, VIDEO_H, 0, 0, VIDEO_W, VIDEO_H);
    }
}

class Responsibility {
    constructor(x, y) {
        this.char = "責任";
        this.pos = createVector(x, y);
        this.vel = createVector(0, random(2, 4));
        this.acc = createVector(0, 0);
        this.isStacked = false;    // 積もっているかどうかのフラグ
        this.isFallingOff = false; // 払われて落下中かどうかのフラグ
        this.alpha = 255;
        this.isDead = false;
        this.rot = random(-0.2, 0.2);
        this.stickyCounter = 0;    // 粘着時間をカウントする変数
    }

    // 動きに触れたら落下させる処理
    applyMotion(mCanvas, dW, dH) {
        let mx = map(this.pos.x, (width - dW) / 2, (width + dW) / 2, VIDEO_W / 2, 0);
        let my = map(this.pos.y, (height - dH) / 2, (height + dH) / 2, 0, VIDEO_H / 2);
        if (mx > 0 && mx < VIDEO_W / 2 && my > 0 && my < VIDEO_H / 2) {
            if (mCanvas.get(mx, my)[0] > 200) {
                this.isStacked = false;
                this.isFallingOff = true; // 落下フラグを立てる
                // 下方向（Y軸）だけに力を加える
                this.vel = createVector(0, random(FALL_SPEED_MIN, FALL_SPEED_MAX));
            }
        }
    }

    update(mImg, offX, offY, dW, dH) {
        if (!this.isStacked) {
            // --- 自由落下状態 ---
            this.acc.y += GRAVITY; // 重力を加える
            this.vel.add(this.acc);
            this.vel.mult(FRICTION); // 空気抵抗
            this.pos.add(this.vel);
            this.acc.mult(0);

            // 体に当たったか判定
            if (!this.isFallingOff && mImg && mImg.pixels.length > 0) {
                let mx = floor(map(this.pos.x, offX + dW, offX, 0, VIDEO_W));
                let my = floor(map(this.pos.y, offY, offY + dH, 0, VIDEO_H));

                if (mx >= 0 && mx < VIDEO_W && my >= 0 && my < VIDEO_H) {
                    let idx = (mx + my * VIDEO_W) * 4;
                    if (mImg.pixels[idx] > STACK_SENSITIVITY) {
                        this.isStacked = true; // 積もり状態へ移行
                        this.vel.mult(0);
                        this.stickyCounter = STICKY_THRESHOLD; // 粘着タイマーリセット
                    }
                }
            }
        } else {
            // --- 積もっている状態（粘着ロジック） ---
            let mx = floor(map(this.pos.x, offX + dW, offX, 0, VIDEO_W));
            let my = floor(map(this.pos.y, offY, offY + dH, 0, VIDEO_H));
            let idx = (mx + my * VIDEO_W) * 4;

            // 今もシルエットの上にいるならタイマーを維持
            if (mImg.pixels[idx] > STACK_SENSITIVITY) {
                this.stickyCounter = STICKY_THRESHOLD;
            } else {
                this.stickyCounter--; // 外れたらカウントダウン開始
            }

            // タイマーが切れたら落下
            if (this.stickyCounter <= 0) {
                this.isStacked = false;
                this.vel.x = 0; // 横に飛ばないようにX速度をリセット
            }
        }

        // 画面外に出るか、落下フラグが立っている時の透明化処理
        if (this.pos.y > height || this.isFallingOff) {
            if (this.isFallingOff) this.alpha -= FADE_OUT_SPEED;
            if (this.alpha <= 0 || this.pos.y > height + 50) this.isDead = true;
        }
    }

    display() {
        if (this.alpha > 0) {
            push();
            translate(this.pos.x, this.pos.y);
            rotate(this.rot);
            fill(255, this.alpha);
            noStroke();
            text(this.char, 0, 0);
            pop();
        }
    }
}