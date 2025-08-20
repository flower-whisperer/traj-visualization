import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import Papa from 'papaparse'
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

  // 区域状态（含是否禁渔区）
  const [regions, setRegions] = useState([]) // [{id,name,color,pointColor,visible,restricted}]
  // 存几何不引发重渲染
  const regionGeomRef = useRef({})      // { [regionId]: [{lon,lat}, ...] }

  // 告警日志
  const [alerts, setAlerts] = useState([]) // [{id, boatId, regionId, regionName, time}]

  // === 多船可变数据（不触发重渲染） ===
  const timersRef = useRef({})           // { [id]: intervalId | null }
  const indexRef = useRef({})            // { [id]: currentIndex }
  const boatDataRef = useRef({})         // { [id]: { actualPoints, predictedPoints, entity, hasActual, predIndex, predActive } }
  const boatAlertRef = useRef({})        // { [id]: { overlayId, inside:Set<regionId> } }

  // 上传的多艘船（仅用于渲染列表）
  const [boats, setBoats] = useState([])
  const [isPlayingMap, setIsPlayingMap] = useState({})

  // 右侧控制台（海洋风）折叠
  const [dockOpen, setDockOpen] = useState(true)
  const [secOpen, setSecOpen] = useState({ regions: true, boats: true, demo: false, alerts: true })

  // 原来的模拟轨迹（演示船）
  const gpsPoints = [
    { lon: 124.51551, lat: 32.2746 }, { lon: 124.49354, lat: 32.249954 },
    { lon: 124.49071, lat: 32.24899 }, { lon: 124.486374, lat: 32.245956 },
    { lon: 124.48278, lat: 32.24234 }, { lon: 124.47921, lat: 32.239037 },
    { lon: 124.47556, lat: 32.23594 }, { lon: 124.47229, lat: 32.2328 },
    { lon: 124.46841, lat: 32.22992 }, { lon: 124.46473, lat: 32.226456 },
    { lon: 124.46119, lat: 32.22362 }, { lon: 124.45577, lat: 32.221195 },
    { lon: 124.450005, lat: 32.218784 }, { lon: 124.4461, lat: 32.21696 },
    { lon: 124.44392, lat: 32.213673 }, { lon: 124.44189, lat: 32.210922 },
    { lon: 124.43826, lat: 32.209538 }, { lon: 124.43362, lat: 32.2073 },
    { lon: 124.43003, lat: 32.205505 }, { lon: 124.42654, lat: 32.203957 },
    { lon: 124.4221, lat: 32.200596 }, { lon: 124.41752, lat: 32.195885 },
    { lon: 124.41397, lat: 32.19218 }, { lon: 124.41038, lat: 32.189407 },
    { lon: 124.405525, lat: 32.187244 }, { lon: 124.40177, lat: 32.185795 },
    { lon: 124.40001, lat: 32.184185 }, { lon: 124.39847, lat: 32.181057 },
    { lon: 124.39506, lat: 32.17799 }, { lon: 124.39054, lat: 32.17522 },
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
      // terrainProvider: Cesium.createWorldTerrain(),
    })
    viewerRef.current = viewer
    viewer.scene.globe.depthTestAgainstTerrain = true

    // FXAA + Bloom（增强亮度/发光）
    viewer.scene.postProcessStages.fxaa.enabled = true
    const bloom = viewer.scene.postProcessStages.bloom
    bloom.enabled = true
    bloom.uniforms.glowOnly = false
    bloom.uniforms.delta = 1.2
    bloom.uniforms.sigma = 2.2
    bloom.uniforms.stepSize = 1.0
    bloom.uniforms.brightness = -0.2

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
        // 提升可见性
        color: Cesium.Color.fromCssColorString('#00e7ff'),
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        colorBlendAmount: 0.6,
        silhouetteColor: Cesium.Color.WHITE,
        silhouetteSize: 2.5
      },
      path: {
        resolution: 1,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.25,
          color: Cesium.Color.CYAN.withAlpha(0.9),
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
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
      const lon = Cesium.Math.toDegrees(cartographic.longitude)
      const lat = Cesium.Math.toDegrees(cartographic.latitude)

      positionsRef.current.push([lon, lat])

      // 临时端点（黄点，抬高 + 禁止地形裁剪）
      viewer.entities.add({
        id: `temp_point_${positionsRef.current.length}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 2),
        point: { pixelSize: 8, color: Cesium.Color.YELLOW, disableDepthTestDistance: Number.POSITIVE_INFINITY },
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
          material: Cesium.Color.RED.withAlpha(0.35),
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
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        position: center
      })

      // 顶点作为子实体（便于随 parent 显隐/删除）
      positionsRef.current.forEach((p, i) => {
        viewer.entities.add({
          id: `${id}_point_${i}`,
          parent: regionEntity,
          position: Cesium.Cartesian3.fromDegrees(p[0], p[1], 2),
          point: { pixelSize: 6, color: Cesium.Color.YELLOW, disableDepthTestDistance: Number.POSITIVE_INFINITY }
        })
      })

      // 保存几何用于点内判断
      regionGeomRef.current[id] = positionsRef.current.map(([lon, lat]) => ({ lon, lat }))

      // React 面板加入一条记录（默认视为禁渔区）
      setRegions(prev => ([
        ...prev,
        { id, name, color: '#ff0000', pointColor: '#ffff00', visible: true, restricted: true }
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

  const handleTextChange = (id, newText) => {
    const viewer = viewerRef.current
    const entity = viewer?.entities.getById(id)
    if (entity?.label) entity.label.text = newText
    setRegions(prev => prev.map(r => (r.id === id ? { ...r, name: newText } : r)))
  }

  const handleRegionColor = (id, hex) => {
    const viewer = viewerRef.current
    const entity = viewer?.entities.getById(id)
    if (entity?.polygon) {
      const col = Cesium.Color.fromCssColorString(hex)
      entity.polygon.material = col.withAlpha(0.35)
      entity.polygon.outlineColor = col
    }
    setRegions(prev => prev.map(r => (r.id === id ? { ...r, color: hex } : r)))
  }

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

  const handleToggleVisible = (id, checked) => {
    const viewer = viewerRef.current
    const entity = viewer?.entities.getById(id)
    if (entity) entity.show = checked
    setRegions(prev => prev.map(r => (r.id === id ? { ...r, visible: checked } : r)))
  }

  const handleToggleRestricted = (id, checked) => {
    setRegions(prev => prev.map(r => (r.id === id ? { ...r, restricted: checked } : r)))
  }

  const handleDelete = (id) => {
    const viewer = viewerRef.current
    if (!viewer) return
    const collection = viewer.entities
    const region = collection.getById(id)
    const children = collection.values.filter(
      (e) => (e.parent && e.parent.id === id) || (e.id && String(e.id).startsWith(`${id}_point_`))
    )
    children.forEach((child) => collection.remove(child))
    if (region) collection.remove(region)
    delete regionGeomRef.current[id]
    setRegions((prev) => prev.filter((r) => r.id !== id))
  }

  // === 工具：计算两点方位角（备用） ===
  const computeHeadingRadians = (lon1, lat1, lon2, lat2) => {
    const φ1 = Cesium.Math.toRadians(lat1)
    const φ2 = Cesium.Math.toRadians(lat2)
    const Δλ = Cesium.Math.toRadians(lon2 - lon1)
    const y = Math.sin(Δλ) * Math.cos(φ2)
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
    return Cesium.Math.zeroToTwoPi(Math.atan2(y, x))
  }

  // === 独立控制：基于 PapaParse 的上传逻辑 ===
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

        createIndependentBoat(actualPoints, predictPoints)
      }
    })
  }

  // === 线宽随缩放自适应 ===
  const makeWidthProperty = () =>
    new Cesium.CallbackProperty(() => {
      const h = viewerRef.current?.camera.positionCartographic.height || 1
      // 远时更粗，近时适中
      return Cesium.Math.clamp(3 + Math.log10(h) * 2.2, 3, 14)
    }, false)

  // === 核心：创建独立渔船 + 动态轨迹 + 告警叠加 ===
  const createIndependentBoat = (actualPoints, predictedPoints) => {
    const viewer = viewerRef.current
    if (!viewer) return

    const hasActual = actualPoints.length > 0
    const firstPoint = hasActual ? actualPoints[0] : (predictedPoints[0] || null)
    if (!firstPoint) return

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    indexRef.current[id] = 0
    timersRef.current[id] = null

    // 位置回调：返回当前索引对应的位置
    const positionCallback = new Cesium.CallbackProperty(() => {
      const idx = indexRef.current[id] ?? 0
      const p = (hasActual ? actualPoints : predictedPoints)[idx] || firstPoint
      return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)
    }, false)

    // ★ 与“演示渔船”一致：用 VelocityOrientationProperty 推导朝向
    const velOrientation = new Cesium.VelocityOrientationProperty(positionCallback)

    // 船模型
    const boatEntity = viewer.entities.add({
      position: positionCallback,
      orientation: velOrientation,
      model: {
        uri: '/models/boat.glb',
        scale: 5,
        minimumPixelSize: 50,
        color: Cesium.Color.fromCssColorString('#00e7ff'),
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        colorBlendAmount: 0.6,
        silhouetteColor: Cesium.Color.WHITE,
        silhouetteSize: 2.5
      },
    })

    // —— 船头发光“脉冲”点（增强动态感） —— //
    const pulseColor = new Cesium.CallbackProperty(() => {
      const t = performance.now() / 500
      const a = 0.4 + 0.3 * (0.5 + 0.5 * Math.sin(t))
      return Cesium.Color.CYAN.withAlpha(a)
    }, false)
    viewer.entities.add({
      id: `${id}_pulse`,
      parent: boatEntity,
      position: positionCallback,
      point: {
        pixelSize: 18,
        color: pulseColor,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })

    // —— 动态“实际轨迹”尾迹：双线（外发光 + 内亮线），随索引增长 —— //
    const widthOuter = makeWidthProperty()
    const widthInner = new Cesium.CallbackProperty(() => Math.max(2, widthOuter.getValue() - 2), false)

    const actualPosProp = new Cesium.CallbackProperty(() => {
      const idx = indexRef.current[id] ?? 0
      const take = Math.max(2, Math.min(idx + 1, actualPoints.length))
      return actualPoints.slice(0, take).map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0))
    }, false)

    viewer.entities.add({
      id: `${id}_trail_outer`,
      polyline: {
        positions: actualPosProp,
        width: widthOuter,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.25,
          color: Cesium.Color.CYAN.withAlpha(0.95)
        })
      }
    })
    viewer.entities.add({
      id: `${id}_trail_inner`,
      polyline: {
        positions: actualPosProp,
        width: widthInner,
        material: Cesium.Color.WHITE
      }
    })

    // —— 预测轨迹：在“分叉点”（实际轨迹末点）后才逐段显现，同样双线 —— //
    boatDataRef.current[id] = {
      actualPoints,
      predictedPoints,
      entity: boatEntity,
      hasActual,
      predIndex: 0,      // 当前显示到预测的第几个点
      predActive: false  // 是否已开始显示预测轨迹
    }

    const predWidthOuter = makeWidthProperty()
    const predWidthInner = new Cesium.CallbackProperty(() => Math.max(2, predWidthOuter.getValue() - 2), false)

    const predPosProp = new Cesium.CallbackProperty(() => {
      const bd = boatDataRef.current[id]
      const n = Math.max(0, Math.min(bd.predIndex, (bd.predictedPoints || []).length))
      if (!n) return []
      return bd.predictedPoints.slice(0, n).map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0))
    }, false)

    // viewer.entities.add({
    //   id: `${id}_pred_outer`,
    //   polyline: {
    //     positions: predPosProp,
    //     width: predWidthOuter,
    //     // 用虚线做“流动感”暗示（无需自定义材质）
    //     material: new Cesium.PolylineDashMaterialProperty({
    //       color: Cesium.Color.fromCssColorString('#ff6b6b').withAlpha(0.95),
    //       gapColor: Cesium.Color.fromCssColorString('#ff6b6b').withAlpha(0.25),
    //       dashLength: 20
    //     })
    //   }
    // })
    viewer.entities.add({
      id: `${id}_pred_inner`,
      polyline: {
        positions: predPosProp,
        width: predWidthInner,
        material: Cesium.Color.WHITE.withAlpha(0.95)
      }
    })

    // —— 告警标识（默认隐藏），绑定同一位置，屏幕右上偏移 —— //
    const overlayId = `${id}_alert`
    viewer.entities.add({
      id: overlayId,
      parent: boatEntity,
      position: positionCallback,
      label: {
        text: '非法捕捞',
        font: 'bold 14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.RED.withAlpha(0.9),
        pixelOffset: new Cesium.Cartesian2(24, -36),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: false,
      },
    })
    boatAlertRef.current[id] = { overlayId, inside: new Set() }

    // 上传后飞到第一个点
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(firstPoint.lon, firstPoint.lat, 200000),
      duration: 1.6
    })

    // 渲染列表用
    setBoats(prev => [...prev, { id }])
    setIsPlayingMap(prev => ({ ...prev, [id]: false }))
  }

  // === 多船独立控制 + 告警检测 + 预测显现 ===
  const startBoat = (id) => {
    const viewer = viewerRef.current
    const data = boatDataRef.current[id]
    if (!viewer || !data) return
    if (!data.hasActual) return // 没有实际轨迹就不动
    if (timersRef.current[id]) return // 已在播放

    timersRef.current[id] = setInterval(() => {
      const path = data.actualPoints
      const idx = indexRef.current[id] ?? 0

      // —— 告警检测（使用“当前点”）——
      const curr = path[Math.min(idx, path.length - 1)]
      if (curr) detectBoatInRestrictedZones(id, curr.lon, curr.lat)

      // —— 到达“分叉点”后启动预测轨迹的逐段显现 —— //
      if (idx >= path.length - 1 && (data.predictedPoints?.length || 0) > 1) {
        if (!data.predActive) data.predActive = true
        data.predIndex = Math.min(data.predIndex + 1, data.predictedPoints.length)
      }

      // 推进播放
      if (idx < path.length - 1) {
        indexRef.current[id] = idx + 1
      } else if (data.predActive && data.predIndex < (data.predictedPoints?.length || 0)) {
        // 仅预测显现阶段，船停在末点，但依旧刷新
      } else {
        clearInterval(timersRef.current[id])
        timersRef.current[id] = null
        setIsPlayingMap(prev => ({ ...prev, [id]: false }))
      }

      viewer.scene.requestRender?.()
    }, 1000)

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
    if (boatDataRef.current[id]) {
      boatDataRef.current[id].predIndex = 0
      boatDataRef.current[id].predActive = false
    }
    setBoatOverlayVisible(id, false)
    boatAlertRef.current[id]?.inside.clear()
    viewerRef.current?.scene.requestRender?.()
  }

  // —— 演示船控制（不变） —— //
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

  // =================== 告警逻辑 ===================

  const setBoatOverlayVisible = (boatId, visible) => {
    const viewer = viewerRef.current
    const overlayId = boatAlertRef.current[boatId]?.overlayId
    if (!overlayId) return
    const overlay = viewer?.entities.getById(overlayId)
    if (overlay?.label) overlay.label.show = visible
  }

  // 点是否在多边形内（经纬度平面射线法）
  const pointInPolygon = (lon, lat, polygonLonLat) => {
    let inside = false
    const n = polygonLonLat.length
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygonLonLat[i].lon, yi = polygonLonLat[i].lat
      const xj = polygonLonLat[j].lon, yj = polygonLonLat[j].lat
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)
      if (intersect) inside = !inside
    }
    return inside
  }

  // 检测某船是否处于任一禁渔区 & 生成日志
  const detectBoatInRestrictedZones = (boatId, lon, lat) => {
    const prevInside = boatAlertRef.current[boatId]?.inside ?? new Set()
    const nowInside = new Set()

    regions.forEach(r => {
      if (!r.restricted) return
      const poly = regionGeomRef.current[r.id]
      if (!poly || poly.length < 3) return
      if (pointInPolygon(lon, lat, poly)) {
        nowInside.add(r.id)
        if (!prevInside.has(r.id)) {
          setAlerts(prev => [
            {
              id: `${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
              boatId,
              regionId: r.id,
              regionName: r.name,
              time: new Date()
            },
            ...prev,
          ])
        }
      }
    })

    boatAlertRef.current[boatId].inside = nowInside
    setBoatOverlayVisible(boatId, nowInside.size > 0)
  }

  // =================== UI：海洋风统一控制台 ===================

  const Section = ({ title, openKey, children }) => (
    <div style={{ marginBottom: 12, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
      <button
        onClick={() => setSecOpen(s => ({ ...s, [openKey]: !s[openKey] }))}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '10px 12px',
          background: 'linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))',
          color: '#e8fbff',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 600,
          letterSpacing: '0.4px'
        }}
      >
        {title} <span style={{ float: 'right', opacity: .8 }}>{secOpen[openKey] ? '▾' : '▸'}</span>
      </button>
      {secOpen[openKey] && (
        <div style={{ padding: 12, background: 'rgba(0, 40, 70, 0.25)', backdropFilter: 'blur(6px)' }}>
          {children}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* 右侧海洋风控制台（可折叠 + 分组） */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: dockOpen ? 340 : 56,
          maxHeight: '90vh',
          overflow: 'auto',
          borderRadius: 16,
          boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          background: dockOpen
            ? 'linear-gradient(180deg, rgba(0,60,100,0.75), rgba(0,30,60,0.75))'
            : 'linear-gradient(180deg, rgba(0,60,100,0.35), rgba(0,30,60,0.35))',
          border: '1px solid rgba(255,255,255,0.18)',
          color: '#e8fbff',
          transition: 'width .25s ease',
          fontFamily: 'ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif',
          backdropFilter: 'blur(10px)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10 }}>
          <button
            onClick={() => setDockOpen(v => !v)}
            title={dockOpen ? '折叠' : '展开'}
            style={{
              width: 36, height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.08)', color: '#e8fbff', cursor: 'pointer'
            }}
          >
            {dockOpen ? '⟨' : '⟩'}
          </button>
          {dockOpen && <div style={{ fontWeight: 800, letterSpacing: 1.2 }}>海洋监测控制台</div>}
        </div>

        {dockOpen && (
          <div style={{ padding: '0 10px 12px' }}>
            <Section title="区域管理" openKey="regions">
              {regions.length === 0 && (
                <div style={{ color: '#b9e6ff' }}>
                  左键打点，右键结束绘制；完成后这里会出现可编辑的卡片。
                </div>
              )}
              {regions.map((r) => (
                <div key={r.id}
                  style={{ border: '1px dashed rgba(255,255,255,0.25)', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{r.name}</div>

                  <div style={{ display: 'grid', gap: 8 }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span>文字</span>
                      <input
                        value={r.name}
                        onChange={(e) => handleTextChange(r.id, e.target.value)}
                        style={{
                          padding: '6px 8px',
                          border: '1px solid rgba(255,255,255,0.25)',
                          background: 'rgba(255,255,255,0.08)',
                          color: '#e8fbff',
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
                        style={{ width: 48, height: 32, padding: 0, border: 'none', background: 'transparent' }}
                      />
                    </label>

                    <label style={{ display: 'grid', gap: 6 }}>
                      <span>顶点颜色</span>
                      <input
                        type="color"
                        value={r.pointColor}
                        onChange={(e) => handlePointColor(r.id, e.target.value)}
                        style={{ width: 48, height: 32, padding: 0, border: 'none', background: 'transparent' }}
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

                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!!r.restricted}
                        onChange={(e) => handleToggleRestricted(r.id, e.target.checked)}
                      />
                      禁渔区（触发告警）
                    </label>

                    <button
                      onClick={() => handleDelete(r.id)}
                      style={{
                        marginTop: 4,
                        padding: '6px 10px',
                        background: '#ff6b6b',
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
            </Section>

            <Section title="上传渔船控制" openKey="boats">
              <div style={{ marginBottom: 10 }}>
                <input type="file" accept=".csv"
                  onChange={handleFileUpload}
                  style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: '#e8fbff' }} />
              </div>
              {boats.length === 0 ? (
                <div style={{ color: '#b9e6ff' }}>尚未上传渔船 CSV（lat, lon, type[0实际/1预测]）。</div>
              ) : boats.map(boat => (
                <div key={boat.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: 8, marginBottom: 8 }}>
                  <div style={{ marginBottom: 8, opacity: .9 }}>船ID: {boat.id}</div>
                  <button onClick={() => startBoat(boat.id)} disabled={isPlayingMap[boat.id]} style={btnStyle}>开始</button>
                  <button onClick={() => pauseBoat(boat.id)} disabled={!isPlayingMap[boat.id]} style={btnStyle}>暂停</button>
                  <button onClick={() => resetBoat(boat.id)} style={btnStyle}>重置</button>
                </div>
              ))}
            </Section>

            <Section title="演示船控制" openKey="demo">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <button onClick={handleStart} disabled={isPlaying} style={btnStyle}>开始</button>
                <button onClick={handlePause} disabled={!isPlaying} style={btnStyle}>暂停</button>
                <button onClick={handleReset} style={btnStyle}>重置</button>
              </div>
            </Section>

            <Section title="告警日志" openKey="alerts">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                <button onClick={() => setAlerts([])} style={btnStyle}>清空</button>
              </div>
              {alerts.length === 0 ? (
                <div style={{ color: '#b9e6ff' }}>暂无告警</div>
              ) : (
                alerts.map(a => (
                  <div key={a.id} style={{ padding: '6px 8px', borderBottom: '1px dashed rgba(255,255,255,0.2)', lineHeight: 1.5 }}>
                    <div><strong>船</strong> {a.boatId}</div>
                    <div><strong>区域</strong> {a.regionName}</div>
                    <div style={{ color: '#c9f2ff' }}>{a.time.toLocaleString()}</div>
                  </div>
                ))
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}

const btnStyle = {
  padding: '8px 10px',
  background: 'linear-gradient(90deg, #00bcd4, #007bff)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer'
}

/* ----------------- 工具函数 ----------------- */

// 点击处获取 Cartesian3（优先 pickPosition，回退到 ellipsoid 相交）
function getClickCartesian(viewer, windowPosition) {
  const scene = viewer.scene
  if (scene.pickPositionSupported) {
    const cartesian = scene.pickPosition(windowPosition)
    if (Cesium.defined(cartesian)) return cartesian
  }
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
