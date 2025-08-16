import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import Papa from 'papaparse' // 保留你的 papaparse

export default function App() {
  const containerRef = useRef(null)
  const viewerRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)

  // === 独立控制新增：为多船维护可变数据（不触发重渲染） ===
  const timersRef = useRef({})           // { [id]: intervalId | null }
  const indexRef = useRef({})            // { [id]: currentIndex }
  const boatDataRef = useRef({})         // { [id]: { actualPoints, predictedPoints, entity } }

  // 存放上传的多艘船（仅用于渲染列表）
  const [boats, setBoats] = useState([])
  const [isPlayingMap, setIsPlayingMap] = useState({})

  // 原来的模拟轨迹
  const gpsPoints = [
    { lon: 124.51551, lat: 32.2746 },
    { lon: 124.49354, lat: 32.249954 },
    { lon: 124.49071, lat: 32.24899 },
    { lon: 124.486374, lat: 32.245956 },
    { lon: 124.48278, lat: 32.24234 },
    { lon: 124.47921, lat: 32.239037 },
    { lon: 124.47556, lat: 32.23594 },
    { lon: 124.47229, lat: 32.2328 },
    { lon: 124.46841, lat: 32.22992 },
    { lon: 124.46473, lat: 32.226456 },
    { lon: 124.46119, lat: 32.22362 },
    { lon: 124.45577, lat: 32.221195 },
    { lon: 124.450005, lat: 32.218784 },
    { lon: 124.4461, lat: 32.21696 },
    { lon: 124.44392, lat: 32.213673 },
    { lon: 124.44189, lat: 32.210922 },
    { lon: 124.43826, lat: 32.209538 },
    { lon: 124.43362, lat: 32.2073 },
    { lon: 124.43003, lat: 32.205505 },
    { lon: 124.42654, lat: 32.203957 },
    { lon: 124.4221, lat: 32.200596 },
    { lon: 124.41752, lat: 32.195885 },
    { lon: 124.41397, lat: 32.19218 },
    { lon: 124.41038, lat: 32.189407 },
    { lon: 124.405525, lat: 32.187244 },
    { lon: 124.40177, lat: 32.185795 },
    { lon: 124.40001, lat: 32.184185 },
    { lon: 124.39847, lat: 32.181057 },
    { lon: 124.39506, lat: 32.17799 },
    { lon: 124.39054, lat: 32.17522 },
    { lon: 124.38736, lat: 32.172894 }
  ]

  useEffect(() => {
    Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN

    const viewer = new Cesium.Viewer(containerRef.current, {
      timeline: false,
      animation: false,
      geocoder: false,
      baseLayerPicker: false,
      sceneModePicker: false,
      homeButton: false,
      navigationHelpButton: false,
      infoBox: false,
      selectionIndicator: false,
    })
    viewerRef.current = viewer

    // 相机锁定/解锁
    const lockCameraControls = (lock) => {
      const c = viewer.scene.screenSpaceCameraController
      c.enableRotate = !lock
      c.enableTranslate = !lock
      c.enableZoom = !lock
      c.enableTilt = !lock
      c.enableLook = !lock
    }
    lockCameraControls(true)

    // 初始视角
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0, 0, 20000000),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-90),
        roll: 0,
      }
    })

    // 缓慢自转
    let isRotating = true
    const rotationSpeed = Cesium.Math.toRadians(30)
    const rotationHandler = () => {
      if (isRotating) {
        viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -rotationSpeed / 60)
      }
    }
    viewer.clock.onTick.addEventListener(rotationHandler)

    // 原始演示船（保留）
    const positionProperty = new Cesium.SampledPositionProperty()
    const start = Cesium.JulianDate.now()
    const totalSeconds = gpsPoints.length * 5
    const stop = Cesium.JulianDate.addSeconds(start, totalSeconds, new Cesium.JulianDate())

    viewer.clock.startTime = start.clone()
    viewer.clock.stopTime = stop.clone()
    viewer.clock.currentTime = start.clone()
    viewer.clock.clockRange = Cesium.ClockRange.CLAMPED
    viewer.clock.shouldAnimate = false

    gpsPoints.forEach((pt, i) => {
      const time = Cesium.JulianDate.addSeconds(start, i * 5, new Cesium.JulianDate())
      const pos = Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 0)
      positionProperty.addSample(time, pos)
    })

    viewer.entities.add({
      availability: new Cesium.TimeIntervalCollection([
        new Cesium.TimeInterval({ start, stop } ),
      ]),
      position: positionProperty,
      orientation: new Cesium.VelocityOrientationProperty(positionProperty),
      model: {
        uri: "/models/boat.glb",
        scale: 5,
        minimumPixelSize: 50,
      },
      path: {
        resolution: 1,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: Cesium.Color.YELLOW,
        }),
        width: 6,
      },
    })

    // 点击事件
    let firstClick = true
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(() => {
      isRotating = false
      if (firstClick) {
        firstClick = false
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(123.0, 30.0, 200000),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-60),
            roll: 0,
          },
          duration: 3,
          complete: () => {
            lockCameraControls(false)
          }
        })
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => {
      viewer.clock.onTick.removeEventListener(rotationHandler)
      handler.destroy()
      viewer && !viewer.isDestroyed() && viewer.destroy()
    }
  }, [])

  // === 工具：计算两点方位角，生成朝向四元数（供独立控制的船使用） ===
  const computeHeadingRadians = (lon1, lat1, lon2, lat2) => {
    const φ1 = Cesium.Math.toRadians(lat1)
    const φ2 = Cesium.Math.toRadians(lat2)
    const Δλ = Cesium.Math.toRadians(lon2 - lon1)
    const y = Math.sin(Δλ) * Math.cos(φ2)
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
    return Cesium.Math.zeroToTwoPi(Math.atan2(y, x))
  }

  // === 独立控制：基于 PapaParse 的上传逻辑（保留） ===
  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return

    Papa.parse(file, {
      complete: (result) => {
        const rows = result.data.filter(r => r.length >= 3 && !isNaN(r[0]))
        if (!rows.length) return

        const actualPoints = []
        const predictPoints = []
        rows.forEach(r => {
          const lat = parseFloat(r[0])
          const lon = parseFloat(r[1])
          const type = parseInt(r[2])
          if (type === 0) actualPoints.push({ lon, lat })
          else if (type === 1) predictPoints.push({ lon, lat })
        })

        // 创建独立控制的船
        createIndependentBoat(actualPoints, predictPoints)
      }
    })
  }

  // === 核心：用 CallbackProperty + setInterval 做每艘船独立播放 ===
  const createIndependentBoat = (actualPoints, predictPoints) => {
    const viewer = viewerRef.current
    if (!viewer) return

    // 若实际轨迹为空，则不创建可移动船；只画预测轨迹并飞到该点
    const hasActual = actualPoints.length > 0
    const firstPoint = hasActual ? actualPoints[0] : (predictPoints[0] || null)
    if (!firstPoint) return

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    indexRef.current[id] = 0
    timersRef.current[id] = null

    // 位置回调：返回当前索引对应的位置
    const positionCallback = new Cesium.CallbackProperty(() => {
      const idx = indexRef.current[id] ?? 0
      const p = (hasActual ? actualPoints : predictPoints)[idx] || firstPoint
      return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)
    }, false)

    // 朝向回调：由当前点与相邻点计算航向
    const orientationCallback = new Cesium.CallbackProperty(() => {
      const idx = indexRef.current[id] ?? 0
      const path = hasActual ? actualPoints : predictPoints
      const curr = path[Math.min(idx, path.length - 1)]
      const next = path[Math.min(idx + 1, path.length - 1)] || curr
      const heading = computeHeadingRadians(curr.lon, curr.lat, next.lon, next.lat)
      const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0)
      const pos = Cesium.Cartesian3.fromDegrees(curr.lon, curr.lat, 0)
      return Cesium.Transforms.headingPitchRollQuaternion(pos, hpr)
    }, false)

    // 船模型（独立控制，不使用全局 clock）
    const boatEntity = viewer.entities.add({
      position: positionCallback,
      orientation: orientationCallback,
      model: { uri: "/models/boat.glb", scale: 5, minimumPixelSize: 50 },
      // 不使用 entity.path（它依赖全局时间），改为静态 polyline 在下面绘制
    })

    // 实际轨迹（黄色，发光）
    if (actualPoints.length > 1) {
      viewer.entities.add({
        polyline: {
          positions: actualPoints.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)),
          width: 6,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: Cesium.Color.YELLOW
          })
        }
      })
    }

    // 预测轨迹（红色，静态）
    if (predictPoints.length > 1) {
      viewer.entities.add({
        polyline: {
          positions: predictPoints.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)),
          width: 4,
          material: Cesium.Color.RED.withAlpha(0.9)
        }
      })
    }

    // 上传后飞到第一个点
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(firstPoint.lon, firstPoint.lat, 200000),
      duration: 1.6
    })

    // 记录该船数据用于控制
    boatDataRef.current[id] = { actualPoints, predictedPoints: predictPoints, entity: boatEntity, hasActual }

    // 渲染列表用
    setBoats(prev => [...prev, { id }])
    setIsPlayingMap(prev => ({ ...prev, [id]: false }))
  }

  // === 多船独立控制 ===
  const startBoat = (id) => {
    const viewer = viewerRef.current
    const data = boatDataRef.current[id]
    if (!viewer || !data) return
    if (!data.hasActual) return // 没有实际轨迹就不动
    if (timersRef.current[id]) return // 已在播放

    timersRef.current[id] = setInterval(() => {
      const path = data.actualPoints
      const idx = indexRef.current[id] ?? 0
      if (idx < path.length - 1) {
        indexRef.current[id] = idx + 1
      } else {
        // 播放完毕，自动停下
        clearInterval(timersRef.current[id])
        timersRef.current[id] = null
        setIsPlayingMap(prev => ({ ...prev, [id]: false }))
      }
      // 触发渲染（在 requestRenderMode=true 时才需要；保险起见保留）
      viewer.scene.requestRender?.()
    }, 1000) // 每 1 秒推进一个点（可自行改速度）

    setIsPlayingMap(prev => ({ ...prev, [id]: true }))
  }

  const pauseBoat = (id) => {
    if (timersRef.current[id]) {
      clearInterval(timersRef.current[id])
      timersRef.current[id] = null
      setIsPlayingMap(prev => ({ ...prev, [id]: false }))
    }
  }

  const resetBoat = (id) => {
    pauseBoat(id)
    indexRef.current[id] = 0
    // 立刻请求一次渲染，位置回调会返回第一点
    viewerRef.current?.scene.requestRender?.()
  }

  // —— 以下为你原来的“演示船控制”，保持不变（它仍然控制全局 clock） ——
  const handleStart = () => {
    viewerRef.current.clock.shouldAnimate = true
    setIsPlaying(true)
  }
  const handlePause = () => {
    viewerRef.current.clock.shouldAnimate = false
    setIsPlaying(false)
  }
  const handleReset = () => {
    const viewer = viewerRef.current
    viewer.clock.currentTime = viewer.clock.startTime.clone()
    viewer.clock.shouldAnimate = false
    setIsPlaying(false)
  }

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* 上传按钮（保留） */}
      <div style={{ position: 'absolute', top: 20, left: 20, background: '#fff', padding: 8 }}>
        <input type="file" accept=".csv" onChange={handleFileUpload} />
      </div>

      {/* 原始船控制面板（保留） */}
      <div style={{
        position: 'absolute',
        top: 200,
        right: 260,
        background: 'rgba(0,0,0,0.5)',
        padding: '12px 16px',
        borderRadius: 8,
        color: '#fff',
        minWidth: 160
      }}>
        <h4>演示船控制</h4>
        <button onClick={handleStart} disabled={isPlaying} style={{ width: '100%', marginBottom: 8 }}>开始</button>
        <button onClick={handlePause} disabled={!isPlaying} style={{ width: '100%', marginBottom: 8 }}>暂停</button>
        <button onClick={handleReset} style={{ width: '100%' }}>重置</button>
      </div>

      {/* 上传的多船控制面板（按钮现在独立控制每艘船） */}
      <div style={{
        position: 'absolute',
        top: 200,
        right: 20,
        background: 'rgba(0,0,0,0.5)',
        padding: '12px 16px',
        borderRadius: 8,
        color: '#fff',
        minWidth: 220
      }}>
        <h4>上传渔船控制</h4>
        {boats.map(boat => (
          <div key={boat.id} style={{ borderBottom: '1px solid #666', paddingBottom: 8, marginBottom: 8 }}>
            <div>船ID: {boat.id}</div>
            <button onClick={() => startBoat(boat.id)} disabled={isPlayingMap[boat.id]} style={{ marginRight: 8 }}>开始</button>
            <button onClick={() => pauseBoat(boat.id)} disabled={!isPlayingMap[boat.id]} style={{ marginRight: 8 }}>暂停</button>
            <button onClick={() => resetBoat(boat.id)}>重置</button>
          </div>
        ))}
      </div>
    </div>
  )
}
