import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import Papa from 'papaparse' // 保留你的 papaparse
import 'cesium/Build/Cesium/Widgets/widgets.css'

export default function App() {
  const containerRef = useRef(null)
  const viewerRef = useRef(null)

  // —— 多边形绘制相关 —— //
  const positionsRef = useRef([])       // 当前正在绘制的经纬度点 [[lon,lat], ...]
  const drawHandlerRef = useRef(null)   // 多边形绘制事件处理器

  // —— 你原有的 handler（用于停止自转与首次飞行） —— //
  const handlerRef = useRef(null)

  const [isPlaying, setIsPlaying] = useState(false)
  // React 层的区域状态，用于渲染控制面板
  const [regions, setRegions] = useState([]) // [{id, name, color, pointColor, visible}]

  // === 独立控制新增：为多船维护可变数据（不触发重渲染） ===
  const timersRef = useRef({})           // { [id]: intervalId | null }
  const indexRef = useRef({})            // { [id]: currentIndex }
  const boatDataRef = useRef({})         // { [id]: { actualPoints, predictedPoints, entity, hasActual } }

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
      // 需要地形可加：terrainProvider: Cesium.createWorldTerrain(),
    })
    viewerRef.current = viewer
    viewer.scene.globe.depthTestAgainstTerrain = true

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
        new Cesium.TimeInterval({ start, stop }),
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

    // —— 你的原 LEFT_CLICK：停止自转 + 首次飞行 —— //
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
    handlerRef.current = handler

    // —— 新增：多边形绘制事件（独立 handler，与上面的 LEFT_CLICK 并存） —— //
    const drawHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    // 左键：打点
    drawHandler.setInputAction((movement) => {
      const cartesian = getClickCartesian(viewer, movement.position)
      if (!cartesian) return
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const h = cartographic.height || 0; 

      positionsRef.current.push([lon, lat])

      // 临时端点（黄点）
      viewer.entities.add({
        id: `temp_point_${positionsRef.current.length}`,
        //把文字信息抬高
        position: Cesium.Cartesian3.fromDegrees(lon, lat,h+2),
        point: { pixelSize: 8, color: Cesium.Color.YELLOW },
        disableDepthTestDistance: Number.POSITIVE_INFINITY, // 不被地形裁剪
      })
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    // 右键：完成绘制
    drawHandler.setInputAction(() => {
      if (positionsRef.current.length < 3) {
        alert('至少需要 3 个点来绘制多边形')
        return
      }
      const id = `region_${Date.now()}`
      const name = prompt('请输入该区域的名称', `区域 ${regions.length + 1}`) || `区域 ${regions.length + 1}`

      const center = getCenterOfPositions(positionsRef.current)
      const flat = positionsRef.current.flat()

      // 区域主体（polygon + label）
      const regionEntity = viewer.entities.add({
        id,
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(flat),
          material: Cesium.Color.RED.withAlpha(0.4),
          outline: true,
          outlineColor: Cesium.Color.RED
        },
        label: {
          text: name,
          font: '16px sans-serif',
          fillColor: Cesium.Color.BLACK,
          showBackground: true,
          backgroundColor: Cesium.Color.WHITE.withAlpha(0.7),
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY, // 文字不被地形裁剪
        },
        position: center
      })

      // 顶点作为子实体（便于随 parent 显隐/删除）
      positionsRef.current.forEach((p, i) => {
        const pos = Cesium.Cartesian3.fromDegrees(p[0], p[1], 2);
        viewer.entities.add({
          id: `${id}_point_${i}`,
          parent: regionEntity,
          position: pos,
          point: { pixelSize: 6, color: Cesium.Color.YELLOW,disableDepthTestDistance: Number.POSITIVE_INFINITY,}
        })
      })

      // React 面板加入一条记录
      setRegions(prev => ([
        ...prev,
        { id, name, color: '#ff0000', pointColor: '#ffff00', visible: true }
      ]))

      // 清理临时点 & 当前绘制缓存
      removeTempPoints(viewer)
      positionsRef.current = []
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)

    drawHandlerRef.current = drawHandler

    // 默认视角
    viewer.camera.flyHome(0)

    return () => {
      viewer.clock.onTick.removeEventListener(rotationHandler)
      handler.destroy()
      drawHandler.destroy()
      viewer && !viewer.isDestroyed() && viewer.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 只在初次挂载时运行

  // ---------- 区域控制面板回调（同步 Cesium & React 状态） ----------

  // 更新文字
  const handleTextChange = (id, newText) => {
    const viewer = viewerRef.current
    const entity = viewer?.entities.getById(id)
    if (entity?.label) entity.label.text = newText
    setRegions(prev => prev.map(r => (r.id === id ? { ...r, name: newText } : r)))
  }

  // 更新区域颜色
  const handleRegionColor = (id, hex) => {
    const viewer = viewerRef.current
    const entity = viewer?.entities.getById(id)
    if (entity?.polygon) {
      const col = Cesium.Color.fromCssColorString(hex)
      entity.polygon.material = col.withAlpha(0.4)
      entity.polygon.outlineColor = col
    }
    setRegions(prev => prev.map(r => (r.id === id ? { ...r, color: hex } : r)))
  }

  // 更新顶点颜色
  const handlePointColor = (id, hex) => {
    const viewer = viewerRef.current
    const color = Cesium.Color.fromCssColorString(hex)
    viewer?.entities.values
      .filter(en => en.id && String(en.id).startsWith(`${id}_point_`))
      .forEach(pt => {
        if (pt.point) pt.point.color = color
      })
    setRegions(prev => prev.map(r => (r.id === id ? { ...r, pointColor: hex } : r)))
  }

  // 显示/隐藏（包含 polygon + label + 顶点）
  const handleToggleVisible = (id, checked) => {
    const viewer = viewerRef.current
    const entity = viewer?.entities.getById(id)
    if (entity) entity.show = checked
    setRegions(prev => prev.map(r => (r.id === id ? { ...r, visible: checked } : r)))
  }

  // 删除（连带子实体：所有顶点）
  const handleDelete = (id) => {
    const viewer = viewerRef.current
    if (!viewer) return

    const collection = viewer.entities

    // 1) 找到该区域实体
    const region = collection.getById(id)

    // 2) 找出所有属于该区域的子实体（更稳妥：通过 parent 判断）
    const children = collection.values.filter(
      (e) =>
        // 通过 parent 关系匹配
        (e.parent && e.parent.id === id) ||
        // 兜底：按命名约定匹配（兼容历史/外部创建的点）
        (e.id && String(e.id).startsWith(`${id}_point_`))
    )

    // 3) 先删子实体，再删父实体
    children.forEach((child) => collection.remove(child))
    if (region) collection.remove(region)

    // 4) 更新面板状态
    setRegions((prev) => prev.filter((r) => r.id !== id))
  }


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
      model: { uri: '/models/boat.glb', scale: 5, minimumPixelSize: 50 },
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

  // —— 以下为你原来的“演示船控制”，保持不变（它仍然控制全局 clock） —— //
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
      <div style={{ position: 'absolute', top: 20, left: 20, background: '#fff', padding: 8, borderRadius: 8 }}>
        <input type="file" accept=".csv" onChange={handleFileUpload} />
      </div>

      {/* 区域管理面板（新） */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          width: 280,
          maxHeight: '70vh',
          overflow: 'auto',
          background: '#ffffff',
          borderRadius: 12,
          boxShadow: '0 6px 16px rgba(0,0,0,0.15)',
          padding: 12,
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          fontSize: 14,
        }}
      >
        <h3 style={{ margin: '4px 0 12px' }}>区域管理</h3>
        {regions.length === 0 && (
          <div style={{ color: '#666', lineHeight: 1.6 }}>
            左键打点，右键结束绘制；完成后这里会出现可编辑的卡片。
          </div>
        )}
        {regions.map((r) => (
          <div
            key={r.id}
            style={{
              border: '1px solid #eee',
              borderRadius: 10,
              padding: 10,
              marginBottom: 10,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{r.name}</div>

            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>文字</span>
                <input
                  value={r.name}
                  onChange={(e) => handleTextChange(r.id, e.target.value)}
                  style={{
                    padding: '6px 8px',
                    border: '1px solid #ddd',
                    borderRadius: 8,
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span>区域颜色</span>
                <input
                  type="color"
                  value={r.color}
                  onChange={(e) => handleRegionColor(r.id, e.target.value)}
                  style={{ width: 48, height: 32, padding: 0, border: 'none' }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span>顶点颜色</span>
                <input
                  type="color"
                  value={r.pointColor}
                  onChange={(e) => handlePointColor(r.id, e.target.value)}
                  style={{ width: 48, height: 32, padding: 0, border: 'none' }}
                />
              </label>

              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={r.visible}
                  onChange={(e) => handleToggleVisible(r.id, e.target.checked)}
                />
                可见
              </label>

              <button
                onClick={() => handleDelete(r.id)}
                style={{
                  marginTop: 4,
                  padding: '6px 10px',
                  background: '#ff4d4f',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 原始船控制面板（保留） */}
      <div style={{
        position: 'absolute',
        top: 200,
        right: 300,
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

/* ----------------- 工具函数 ----------------- */

// 点击处获取 Cartesian3（优先 pickPosition，回退到 ellipsoid 相交）
function getClickCartesian(viewer, windowPosition) {
  const scene = viewer.scene
  // a) 3D 瓦片/模型/地形上拾取
  if (scene.pickPositionSupported) {
    const cartesian = scene.pickPosition(windowPosition)
    if (Cesium.defined(cartesian)) return cartesian
  }
  // b) 回退：从摄像头射线与椭球求交
  const ray = viewer.camera.getPickRay(windowPosition)
  const cartesian = scene.globe.pick(ray, scene)
  return cartesian || null
}

// 计算多边形（经纬度数组）中心
function getCenterOfPositions(lonlatArr) {
  const pts = lonlatArr.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))
  const bs = Cesium.BoundingSphere.fromPoints(pts)
  return bs.center
}

// 移除临时端点
function removeTempPoints(viewer) {
  const toRemove = viewer.entities.values.filter(
    (e) => e.id && String(e.id).startsWith('temp_point_')
  )
  toRemove.forEach((e) => viewer.entities.remove(e))
}
