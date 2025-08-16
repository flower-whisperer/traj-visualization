import { useEffect, useRef } from "react";
import * as Cesium from "cesium";

export default function OceanCurrents() {
  const containerRef = useRef(null);

  useEffect(() => {
    // --- 1) 初始化 Cesium ---
    const viewer = new Cesium.Viewer(containerRef.current, {
      terrain: Cesium.Terrain.fromWorldTerrain(),
      // 关闭界面部件自行美化
      animation: false, timeline: false, geocoder: false, baseLayerPicker: false,
      sceneModePicker: false, navigationHelpButton: false, homeButton: false,
    });
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.requestRenderMode = true; // 只在需要时渲染

    // --- 2) 准备粒子画布 ---
    const canvas = document.createElement('canvas');
    const W = 2048, H = 1024; // 2K 级别就很细腻了
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 把 Canvas 挂为全球影像
    const canvasProvider = new Cesium.SingleTileImageryProvider({
      url: canvas.toDataURL(), // 先放一张空图
      rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
    });
    const canvasLayer = viewer.imageryLayers.addImageryProvider(canvasProvider);

    // --- 3) 加载/准备 U/V 网格（这里用模拟数据，替换成你的） ---
    // uGrid, vGrid: Float32Array 或普通数组，大小 [ny][nx]
    const nx = 360, ny = 181; // 1° 分辨率示例
    const uGrid = new Float32Array(nx * ny);
    const vGrid = new Float32Array(nx * ny);
    // TODO: 从你预处理的文件加载（fetch ArrayBuffer 或 Image 灰度再解码）
    // 这里先填入一个虚拟的副极地环流：
    for (let j = 0; j < ny; j++) {
      const lat = -90 + j;
      for (let i = 0; i < nx; i++) {
        const lon = -180 + i;
        const idx = j * nx + i;
        const r = Math.hypot(lat, lon) + 1e-6;
        uGrid[idx] = 0.3 * (-lat / r); // 只是演示
        vGrid[idx] = 0.3 * ( lon / r);
      }
    }

    // 采样函数（nearest 或 bilinear）
    function sampleUV(lonDeg, latDeg) {
      // 映射到 [0,nx), [0,ny)
      let x = ((lonDeg + 180) / 360) * (nx - 1);
      let y = ((latDeg + 90) / 180) * (ny - 1);
      const i0 = Math.floor(x), j0 = Math.floor(y);
      const i1 = Math.min(i0 + 1, nx - 1), j1 = Math.min(j0 + 1, ny - 1);
      const tx = x - i0, ty = y - j0;
      const idx = (ii, jj) => jj * nx + ii;

      const u = (1 - tx) * (1 - ty) * uGrid[idx(i0, j0)]
              + tx * (1 - ty) * uGrid[idx(i1, j0)]
              + (1 - tx) * ty * uGrid[idx(i0, j1)]
              + tx * ty * uGrid[idx(i1, j1)];
      const v = (1 - tx) * (1 - ty) * vGrid[idx(i0, j0)]
              + tx * (1 - ty) * vGrid[idx(i1, j0)]
              + (1 - tx) * ty * vGrid[idx(i0, j1)]
              + tx * ty * vGrid[idx(i1, j1)];
      return { u, v };
    }

    // --- 4) 初始化粒子 ---
    const N = 12000; // 粒子数，按性能调
    const particles = new Float32Array(N * 2); // [lon, lat]
    function randomize(k) {
      particles[2*k]   = -180 + 360 * Math.random();
      particles[2*k+1] = -90 + 180 * Math.random();
    }
    for (let k = 0; k < N; k++) randomize(k);

    // --- 5) 渲染循环（推进 + 绘制） ---
    const Rdeg = 111000; // 1° ≈ 111km，用于把 m/s -> °/s（若 u/v 已是°/s 可设为1）
    const dt = 1.0;      // 步长（秒）按需要调
    function step() {
      // 背景蒙一层半透明，形成拖影
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.9; // 越接近1越短暂
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(0, 0, W, H);

      ctx.globalAlpha = 1.0;
      ctx.lineWidth = 0.6;

      for (let k = 0; k < N; k++) {
        let lon = particles[2*k];
        let lat = particles[2*k+1];

        const { u, v } = sampleUV(lon, lat); // 假设 u/v 单位 m/s
        // 简化：把 m/s 粗暴转换为°/s（低纬近似；高纬可乘 cos(lat) 修正）
        const dLon = (u * dt) / (Rdeg * Math.cos(lat * Math.PI/180)) * 180/Math.PI * Math.PI; // 近似
        const dLat = (v * dt) / Rdeg * 180/Math.PI * Math.PI;

        const lon2 = lon + dLon;
        const lat2 = lat + dLat;

        // 画线段
        const x1 = ((lon + 180) / 360) * W;
        const y1 = (1 - (lat + 90) / 180) * H;
        const x2 = ((lon2 + 180) / 360) * W;
        const y2 = (1 - (lat2 + 90) / 180) * H;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // 更新粒子
        let nl = lon2, nt = lat2;
        // 回卷/丢弃策略
        if (nt < -90 || nt > 90 || isNaN(nl) || isNaN(nt)) {
          randomize(k);
        } else {
          // 经度环绕
          if (nl < -180) nl += 360;
          if (nl >  180) nl -= 360;
          particles[2*k]   = nl;
          particles[2*k+1] = nt;
        }
      }

      // 把最新 Canvas 映射到图层（替换 provider 的内部图像）
      // 简洁做法：把 canvas 画到一个 <img>，然后:
      canvasProvider._tileWidth = W;
      canvasProvider._tileHeight = H;
      // 触发重渲染
      viewer.scene.requestRender();
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);

    // --- 6) 时间控制（切换 u/v/sst/sss 数据） ---
    // 你可以监听一个 UI 的时间滑块，重新加载纹理/网格并平滑过渡

    return () => viewer?.destroy();
  }, []);

  return <div ref={containerRef} style={{width:'100%', height:'100vh'}} />;
}
