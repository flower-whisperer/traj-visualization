import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = 4000;

// 本地开发跨域（若你已用 Vite 代理，可不需要）
app.use(cors({ origin: "http://localhost:5173" }));

app.get("/api/ocean", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "Invalid lat/lng" });
    }

    // 7 天窗口（和前端一致）
    const end = new Date().toISOString();
    const start = new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString();

    const url =
      `https://api.stormglass.io/v2/weather/point` +
      `?lat=${lat}&lng=${lng}` +
      `&params=waterTemperature` +
      `&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;

    // ⚠️ 在 Node 里用 process.env（不是 import.meta.env）
    const KEY =
      process.env.STORMGLASS_API_KEY || process.env.REACT_APP_STORMGLASS_API_KEY;
    if (!KEY) {
      console.error("Missing STORMGLASS_API_KEY in .env");
      return res.status(500).json({ error: "Missing STORMGLASS_API_KEY" });
    }

    const r = await fetch(url, { headers: { Authorization: KEY } });

    // 读取 body 便于调试
    const text = await r.text();

    if (!r.ok) {
      console.error("StormGlass error:", r.status, text);
      // 把真实状态码和错误体转发给前端（别统一 500）
      return res.status(r.status).send(text);
    }

    // 直接把 JSON 字符串回传（避免重复 parse/stringify）
    res.type("application/json").send(text);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Proxy server running at http://localhost:${PORT}`);
});
