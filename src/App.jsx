import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import Papa from 'papaparse'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import * as echarts from 'echarts'
import ReactECharts from "echarts-for-react";
import Cookies from "js-cookie";


export default function App() {
  const containerRef = useRef(null)
  const viewerRef = useRef(null)

  // —— 多边形绘制 —— //
  const positionsRef = useRef([])

  // —— 停止自转与首次飞行 —— //
  const handlerRef = useRef(null)

  const [isPlaying, setIsPlaying] = useState(false)

  // 区域（含是否禁渔）
  const [regions, setRegions] = useState([]) // [{id,name,color,pointColor,visible,restricted}]
  const regionGeomRef = useRef({})          // { [regionId]: [{lon,lat}, ...] }

  // 警告日志
  const [alerts, setAlerts] = useState([])  // [{id, boatId, regionId, regionName, time}]

  // === 多船可变数据（不触发重渲染） ===
  const timersRef = useRef({})  // { [id]: intervalId | null }
  const indexRef  = useRef({})  // { [id]: currentIndex }
  /**
   * boatDataRef:
   * {
   *  [id]: {
   *    actualPoints: [{lon,lat}],
   *    altTracks: {1:[...],2:[...],...,7:[...]},
   *    altState: {1:{active,index},...,7:{active,index}},
   *    entity: Cesium.Entity,
   *    hasActual: boolean
   *  }
   * }
   */
  const boatDataRef  = useRef({})
  const boatAlertRef = useRef({}) // { [id]: { overlayId, inside:Set<regionId> } }

  // 上传渔船（渲染列表）
  const [boats, setBoats] = useState([])
  const [isPlayingMap, setIsPlayingMap] = useState({})

  // 右侧控制台折叠
  const [dockOpen, setDockOpen] = useState(true)
  const [secOpen, setSecOpen] = useState({ regions: true, boats: true, demo: false, alerts: true })
  const [boatPredState, setBoatPredState] = useState({}) 
  // { [id]: { predUnlocked:false, predReady:false, isLoadingPred:false } }

  const TRACK_HEIGHT = 8 // 米

  // 1~7 分支颜色
  const ALT_COLOR_MAP = {
    1: '#ffb703',
    2: '#f72585',
    3: '#7209b7',
    4: '#3a86ff',
    5: '#2ec4b6',
    6: '#ff9f1c',
    7: '#ff4d4d',
    8:'#92d806'
  }
  const LEGEND_MAP = {
  0: "Ground Truth",
  1: "ARIMA",
  2: "MLP",
  3: "TrAISformer",
  4: "LSTM",
  5: "ST-Seq2Seq",
  6: "VeTraNet",
  7: "METO-S2S",
  8: "TRFM-FS"
}
// —— 24h 警告趋势图 —— //
const trendDivRef = useRef(null)
const trendChartRef = useRef(null)

// 统计：近 24h 警告趋势（按小时 bin）
function computeAlertLast24h() {
  const bins = new Map()
  const end = new Date()
  const start = new Date(end.getTime() - 24*3600*1000)
  for (let i = 0; i <= 24; i++) {
    const t = new Date(start.getTime() + i*3600*1000)
    const key = t.toISOString().slice(0,13) + ':00'
    bins.set(key, 0)
  }
  alerts.forEach(a => {
    const t = a.time instanceof Date ? a.time : new Date(a.time)
    if (t >= start && t <= end) {
      const k = new Date(t); k.setMinutes(0,0,0)
      const key = k.toISOString().slice(0,13) + ':00'
      bins.set(key, (bins.get(key) || 0) + 1)
    }
  })
  return {
    labels: Array.from(bins.keys()),
    values: Array.from(bins.values()),
  }
}
useEffect(() => {
  if (!trendDivRef.current) return
  if (!trendChartRef.current) {
    trendChartRef.current = echarts.init(trendDivRef.current)
  }
  const { labels, values } = computeAlertLast24h()
  trendChartRef.current.setOption({
    title: { text:'近 24 小时警告趋势', left:'center', textStyle:{ color:'#e8fbff' } },
    tooltip: { trigger:'axis' },
    grid: { left: 40, right: 20, top: 40, bottom: 40 },
    xAxis: {
      type:'category',
      data: labels.map(s => s.slice(11,16)), // HH:mm
      axisLabel:{ color:'#cfefff', rotate:45 }
    },
    yAxis: { type:'value', minInterval:1, axisLabel:{ color:'#cfefff' } },
    dataZoom:[{ type:'inside' }, { type:'slider' }],
    series: [{
      type:'line',
      smooth:true,
      showSymbol:false,
      lineStyle:{ width:2 },
      areaStyle:{ opacity:0.15 },
      data: values
    }]
  })
  const onResize = () => trendChartRef.current?.resize()
  window.addEventListener('resize', onResize)
  return () => window.removeEventListener('resize', onResize)
}, [alerts])
// —— 系统统计面板所需 —— //

const [cursorLL, setCursorLL] = useState(null) // { lon, lat } | null
 
//海洋水温画图


  // 原演示轨迹
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

    // FXAA + Bloom
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
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 }
    })

    // 自转
    let isRotating = true
    const rotationSpeed = Cesium.Math.toRadians(30)
    const rotationHandler = () => {
      if (isRotating) viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -rotationSpeed / 60)
    }
    viewer.clock.onTick.addEventListener(rotationHandler)

    // 演示船
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
      const t = Cesium.JulianDate.addSeconds(start, i * 5, new Cesium.JulianDate())
      const pos = Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, TRACK_HEIGHT)
      positionProperty.addSample(t, pos)
    })

    viewer.entities.add({
      availability: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start, stop })]),
      position: positionProperty,
      orientation: new Cesium.VelocityOrientationProperty(positionProperty),
      model: {
        uri: "/models/boat.glb",
        scale: 5,
        minimumPixelSize: 50,
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

    // —— LEFT_CLICK：停止自转 + 首次飞行 —— //
    let firstClick = true
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(() => {
      isRotating = false
      if (firstClick) {
        firstClick = false
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(123.0, 30.0, 200000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-60), roll: 0 },
          duration: 4.0,
          maximumHeight: 5000000,
          easingFunction: Cesium.EasingFunction.QUADRATIC_OUT,
          complete: () => lockCameraControls(false)
        })
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    handlerRef.current = handler

    // —— 多边形绘制 —— //
    const drawHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    // 左键：打点
    drawHandler.setInputAction((movement) => {
      const cartesian = getClickCartesian(viewer, movement.position)
      if (!cartesian) return
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
      const lon = Cesium.Math.toDegrees(cartographic.longitude)
      const lat = Cesium.Math.toDegrees(cartographic.latitude)
      positionsRef.current.push([lon, lat])

      viewer.entities.add({
        id: `temp_point_${positionsRef.current.length}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 2),
        point: { pixelSize: 8, color: Cesium.Color.YELLOW, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      })
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    // 右键：完成
    drawHandler.setInputAction(() => {
      if (positionsRef.current.length < 3) return alert('至少需要 3 个点来绘制多边形')
      const id = `region_${Date.now()}`
      const name = prompt('请输入该区域的名称', `区域 ${regions.length + 1}`) || `区域 ${regions.length + 1}`

      const center = getCenterOfPositions(positionsRef.current)
      const flat = positionsRef.current.flat()

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

      positionsRef.current.forEach((p, i) => {
        viewer.entities.add({
          id: `${id}_point_${i}`,
          parent: regionEntity,
          position: Cesium.Cartesian3.fromDegrees(p[0], p[1], 2),
          point: { pixelSize: 6, color: Cesium.Color.YELLOW, disableDepthTestDistance: Number.POSITIVE_INFINITY }
        })
      })

      regionGeomRef.current[id] = positionsRef.current.map(([lon, lat]) => ({ lon, lat }))
      setRegions(prev => ([...prev, { id, name, color: '#ff0000', pointColor: '#ffff00', visible: true, restricted: true }]))

      removeTempPoints(viewer)
      positionsRef.current = []
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)

    // —— 经纬度 label（只显示 Label，不再引用未定义的十字线） —— //
    let crossLabel = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(0, 0),
      label: {
        text: "",
        font: "bold 14px sans-serif",
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
        pixelOffset: new Cesium.Cartesian2(0, -20),
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      show: false
    })

    const moveHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    moveHandler.setInputAction((movement) => {
      const v = viewerRef.current
      if (!v) return
      const camHeight = v.camera.positionCartographic.height
      const showCross = camHeight < 1_000_000
      const cartesian = getClickCartesian(v, movement.endPosition)
      if (!cartesian || !showCross) { crossLabel.show = false; setCursorLL(null);return }

      const carto = Cesium.Cartographic.fromCartesian(cartesian)
      const lon = Cesium.Math.toDegrees(carto.longitude)
      const lat = Cesium.Math.toDegrees(carto.latitude)
      setCursorLL({ lon, lat })
      const lonAbs = Math.abs(lon).toFixed(6)
      const latAbs = Math.abs(lat).toFixed(6)
      const lonDir = lon >= 0 ? 'E' : 'W'
      const latDir = lat >= 0 ? 'N' : 'S'
      crossLabel.position = Cesium.Cartesian3.fromDegrees(lon, lat)
      crossLabel.label.text = `${latAbs}°${latDir}, ${lonAbs}°${lonDir}`
      crossLabel.show = true
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    viewer.crossMoveHandler = moveHandler
    viewer.camera.flyHome(0)

    return () => {
      viewer.clock.onTick.removeEventListener(rotationHandler)
      handler.destroy()
      drawHandler.destroy()
      viewer.crossMoveHandler && viewer.crossMoveHandler.destroy()
      viewer && !viewer.isDestroyed() && viewer.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 区域控制面板回调 ----------

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
      .forEach(pt => { if (pt.point) pt.point.color = color })
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

  // === 上传 CSV：similar 0..7 ===
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    Papa.parse(file, {
      complete: (result) => {
        const rows = result.data.filter(r => r.length >= 3 && !isNaN(parseFloat(r[0])) && !isNaN(parseFloat(r[1])))
        if (!rows.length) return

        const actualPoints = []
        const altTracks = {1:[],2:[],3:[],4:[],5:[],6:[],7:[],8:[]}

        rows.forEach(r => {
          const lat = parseFloat(r[0])
          const lon = parseFloat(r[1])
          const type = parseInt(r[2], 10)
          if (type === 0) actualPoints.push({ lon, lat })
          else if (type >= 1 && type <= 8) altTracks[type].push({ lon, lat })
        })

        const name = prompt('请输入该渔船的船名或ID', `渔船 ${boats.length + 1}`) || `渔船 ${boats.length + 1}`
        createIndependentBoat(actualPoints, altTracks, name)
      }
    })
  }

  // === 线宽随缩放自适应 ===
  const makeWidthProperty = () =>
    new Cesium.CallbackProperty(() => {
      const h = viewerRef.current?.camera.positionCartographic.height || 1
      return Cesium.Math.clamp(3 + Math.log10(h) * 2.2, 3, 14)
    }, false)

  // === 创建独立渔船（实际 + 多分支） ===
  const createIndependentBoat = (actualPoints, altTracks, displayName) => {
    const viewer = viewerRef.current
    if (!viewer) return

    const hasActual = actualPoints.length > 0
    const firstPoint =
      hasActual ? actualPoints[0]
               : (altTracks[8]?.[0] || altTracks[1]?.[0] || null)
    if (!firstPoint) return

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    indexRef.current[id] = 0
    timersRef.current[id] = null

    // 船位置（跟随实际轨迹）
    const positionCallback = new Cesium.CallbackProperty(() => {
      const idx = indexRef.current[id] ?? 0
      const p = (hasActual ? actualPoints : (altTracks[8]?.length ? altTracks[8] : altTracks[1]))[idx] || firstPoint
      return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)
    }, false)

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

    // 船名
    viewer.entities.add({
      id: `${id}_nameLabel`,
      parent: boatEntity,
      position: positionCallback,
      label: {
        text: displayName,
        font: 'bold 14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.GREEN.withAlpha(0.6),
        pixelOffset: new Cesium.Cartesian2(-20, -20),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.RIGHT,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })

    // 船头脉冲
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

    // —— 实际轨迹：双线尾迹 —— //
    if (hasActual) {
      const widthOuter = makeWidthProperty()
      const actualPosProp = new Cesium.CallbackProperty(() => {
        const idx = indexRef.current[id] ?? 0
        const take = Math.max(2, Math.min(idx + 1, actualPoints.length))
        return actualPoints.slice(0, take).map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, TRACK_HEIGHT))
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
          width: 5, // 内亮线固定宽度，避免引用另一 CallbackProperty
          material: Cesium.Color.WHITE
        }
      })
    }

    // —— 分支 1..7：虚线 + 各自颜色（预测解锁后逐段显现） —— //
    const altState = {}
    for (let t = 1; t <= 8; t++) altState[t] = { active: false, index: 0 }

    for (let t = 1; t <= 8; t++) {
      const track = altTracks[t] || []
      const posProp = new Cesium.CallbackProperty(() => {
        const st = altState[t]
        const n = Math.max(0, Math.min(st.index, track.length))
        if (n < 2) return []
        return track.slice(0, n).map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, TRACK_HEIGHT))
      }, false)

      // const w = makeWidthProperty()
      viewer.entities.add({
        id: `${id}_alt_${t}`,
        polyline: {
          positions: posProp,
          width: 8,
          material: Cesium.Color.fromCssColorString(ALT_COLOR_MAP[t]).withAlpha(0.95),
          clampToGround: false
        }
      })
    }

    // —— 警告标识 —— //
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

    // 镜头
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(firstPoint.lon, firstPoint.lat, 200000),
      duration: 1.6
    })

    // 保存
    boatDataRef.current[id] = { actualPoints, altTracks, altState, entity: boatEntity, hasActual }
    setBoats(prev => [...prev, { id, name: displayName }])
    setIsPlayingMap(prev => ({ ...prev, [id]: false }))
    setBoatPredState(prev => ({ ...prev, [id]: { predUnlocked:false, predReady:false, isLoadingPred:false } }))
  }

  // === 播放 / 暂停 / 重置（含分支显现） ===
  const startBoat = (id) => {
    const viewer = viewerRef.current
    const data = boatDataRef.current[id]
    if (!viewer || !data) return
    if (!data.hasActual) return
    if (timersRef.current[id]) return

    timersRef.current[id] = setInterval(() => {
      const path = data.actualPoints
      const idx = indexRef.current[id] ?? 0

      // 第 30 个点解锁预测
      if (!boatPredState[id]?.predReady && idx >= 29) {
        setBoatPredState(prev => ({ ...prev, [id]: { ...(prev[id]||{}), predUnlocked: true } }))
        pauseBoat(id)
        return
      }

      // 警告检测
      const curr = path[Math.min(idx, path.length - 1)]
      if (curr) detectBoatInRestrictedZones(id, curr.lon, curr.lat)

      // 预测（分支 1..7）逐段显现
      if (boatPredState[id]?.predReady) {
        for (let t = 1; t <= 8; t++) {
          const track = data.altTracks[t] || []
          const st = data.altState[t]
          if (track.length > 1) {
            if (!st.active) st.active = true
            st.index = Math.min(st.index + 1, track.length)
          }
        }
      }

      // 推进实际轨迹
      if (idx < path.length - 1) {
        indexRef.current[id] = idx + 1
      } else {
        // 实际轨迹结束，等待分支全部显现完成
        const allAltDone = (() => {
          for (let t = 1; t <= 8; t++) {
            const track = data.altTracks[t] || []
            const st = data.altState[t]
            if (track.length > 1 && st.index < track.length) return false
          }
          return true
        })()

        if (allAltDone) {
          clearInterval(timersRef.current[id])
          timersRef.current[id] = null
          setIsPlayingMap(prev => ({ ...prev, [id]: false }))
        }
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
    const bd = boatDataRef.current[id]
    if (bd) {
      for (let t = 1; t <= 8; t++) {
        bd.altState[t].index = 0
        bd.altState[t].active = false
      }
    }
    setBoatOverlayVisible(id, false)
    boatAlertRef.current[id]?.inside.clear()
    setBoatPredState(prev => ({ ...prev, [id]: { predUnlocked:false, predReady:false, isLoadingPred:false } }))
    viewerRef.current?.scene.requestRender?.()
  }

  // —— 演示船控制 —— //
  const handleStart = () => { viewerRef.current.clock.shouldAnimate = true; setIsPlaying(true) }
  const handlePause = () => { viewerRef.current.clock.shouldAnimate = false; setIsPlaying(false) }
  const handleReset = () => {
    const viewer = viewerRef.current
    viewer.clock.currentTime = viewer.clock.startTime.clone()
    viewer.clock.shouldAnimate = false
    setIsPlaying(false)
  }

  // =================== 警告逻辑 ===================
  const setBoatOverlayVisible = (boatId, visible) => {
    const viewer = viewerRef.current
    const overlayId = boatAlertRef.current[boatId]?.overlayId
    if (!overlayId) return
    const overlay = viewer?.entities.getById(overlayId)
    if (overlay?.label) overlay.label.show = visible
  }

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
            { id: `${Date.now()}_${Math.random().toString(36).slice(2,6)}`, boatId, regionId: r.id, regionName: r.name, time: new Date() },
            ...prev,
          ])
        }
      }
    })

    boatAlertRef.current[boatId].inside = nowInside
    setBoatOverlayVisible(boatId, nowInside.size > 0)
  }

  // =================== UI ===================
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
      


      {/* —— 系统统计面板 —— */}
<div style={{
  position:'absolute',
  top:112, left:20, zIndex:1000,
  width: 280,
  padding:'12px 16px',
  borderRadius:10,
  background:'linear-gradient(135deg, rgba(0,0,0,0.5), rgba(40,40,40,0.3))',
  border:'1px solid rgba(255,255,255,0.25)',
  color:'#e8fbff',
  fontFamily:'Segoe UI, Roboto, sans-serif'
}}>
  <div style={{fontWeight:800, marginBottom:8}}>系统统计</div>
  <div style={{display:'grid', gridTemplateColumns:'auto 1fr', rowGap:6, columnGap:10, alignItems:'center'}}>
    <div style={{opacity:.75}}>上传渔船数量</div>
    <div>{boats.length}</div>

    <div style={{opacity:.75}}>禁渔区数量</div>
    <div>{regions.filter(r => r.restricted).length}</div>

    <div style={{opacity:.75}}>警告数量</div>
    <div>{alerts.length}</div>

    <div style={{opacity:.75}}>鼠标经纬度</div>
    <div>
      {cursorLL
        ? `${Math.abs(cursorLL.lat).toFixed(6)}°${cursorLL.lat >= 0 ? 'N' : 'S'}, `
          + `${Math.abs(cursorLL.lon).toFixed(6)}°${cursorLL.lon >= 0 ? 'E' : 'W'}`
        : '—'}
    </div>
  </div>
</div>

      {/* 近 24h 警告趋势（右下角） */}
<div style={{
  position:'absolute',
  right: 20,
  bottom: 20,
  zIndex: 1000,
  width: 420,
  height: 240,
  borderRadius: 12,
  border:'1px solid rgba(255,255,255,0.2)',
  background:'linear-gradient(135deg, rgba(0,0,0,0.45), rgba(40,40,40,0.25))',
  backdropFilter:'blur(6px)'
}}>
  <div ref={trendDivRef} style={{ width:'100%', height:'100%' }} />
</div>

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* 图例 */}
  <div style={{
    position: 'absolute',
    bottom: 20,
    left: 20,
    background: 'rgba(0,0,0,0.6)',
    padding: '10px 14px',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    lineHeight: 1.6,
    zIndex: 1000
  }}>
    {Object.entries(LEGEND_MAP).map(([k, v]) => (
      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <div style={{
          width: 14, height: 14, borderRadius: 3,
          background: k === "0" ? "#00e7ff" : (ALT_COLOR_MAP[k] || "#9e9e9e")
        }} />
        <span>{k}: {v}</span>
      </div>
    ))}
  </div>

      {/* 左上角项目名 */}
      <div style={{
        position: 'absolute',
        top: 20, left: 20, zIndex: 1000,
        padding: '10px 16px', borderRadius: 8,
        background: 'linear-gradient(135deg, rgba(0,0,0,0.55), rgba(40,40,40,0.35))',
        border: '1px solid rgba(255,255,255,0.25)', backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.35)', lineHeight: 1.2,
        fontFamily: 'Segoe UI, Roboto, sans-serif'
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: '1px', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
          HUAWEI CUP
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#ffffff', marginTop: 4, textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
          渔航智轨
        </div>
      </div>

      {/* 右侧控制台 */}
      <div
        style={{
          position: 'absolute',
          top: 16, right: 16,
          width: dockOpen ? 340 : 56,
          maxHeight: '90vh', overflow: 'auto',
          borderRadius: 16, boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          background: dockOpen ? 'linear-gradient(180deg, rgba(0,60,100,0.75), rgba(0,30,60,0.75))'
                               : 'linear-gradient(180deg, rgba(0,60,100,0.35), rgba(0,30,60,0.35))',
          border: '1px solid rgba(255,255,255,0.18)', color: '#e8fbff',
          transition: 'width .25s ease', fontFamily: 'ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif',
          backdropFilter: 'blur(10px)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10 }}>
          <button
            onClick={() => setDockOpen(v => !v)}
            title={dockOpen ? '折叠' : '展开'}
            style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#e8fbff', cursor: 'pointer' }}
          >
            {dockOpen ? '⟨' : '⟩'}
          </button>
          {dockOpen && <div style={{ fontWeight: 800, letterSpacing: 1.2 }}>海洋监测控制台</div>}
        </div>

        {dockOpen && (
          <div style={{ padding: '0 10px 12px' }}>
            <Section title="区域管理" openKey="regions">
              {regions.length === 0 && <div style={{ color: '#b9e6ff' }}>左键打点，右键结束绘制；完成后这里会出现可编辑的卡片。</div>}
              {regions.map((r) => (
                <div key={r.id} style={{ border: '1px dashed rgba(255,255,255,0.25)', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{r.name}</div>

                  <div style={{ display: 'grid', gap: 8 }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span>文字</span>
                      <input value={r.name} onChange={(e) => handleTextChange(r.id, e.target.value)}
                        style={{ padding: '6px 8px', border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.08)', color: '#e8fbff', borderRadius: 8 }} />
                    </label>

                    <label style={{ display: 'grid', gap: 6 }}>
                      <span>区域颜色</span>
                      <input type="color" value={r.color} onChange={(e) => handleRegionColor(r.id, e.target.value)}
                        style={{ width: 48, height: 32, padding: 0, border: 'none', background: 'transparent' }} />
                    </label>

                    <label style={{ display: 'grid', gap: 6 }}>
                      <span>顶点颜色</span>
                      <input type="color" value={r.pointColor} onChange={(e) => handlePointColor(r.id, e.target.value)}
                        style={{ width: 48, height: 32, padding: 0, border: 'none', background: 'transparent' }} />
                    </label>

                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="checkbox" checked={r.visible} onChange={(e) => handleToggleVisible(r.id, e.target.checked)} />
                      可见
                    </label>

                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="checkbox" checked={!!r.restricted} onChange={(e) => handleToggleRestricted(r.id, e.target.checked)} />
                      禁渔区（触发警告）
                    </label>

                    <button onClick={() => handleDelete(r.id)}
                      style={{ marginTop: 4, padding: '6px 10px', background: '#ff6b6b', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </Section>

            <Section title="上传渔船控制" openKey="boats">
              <div style={{ marginBottom: 10 }}>
                <input type="file" accept=".csv" onChange={handleFileUpload}
                  style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: '#e8fbff' }} />
              </div>

              {boats.length === 0 ? (
                <div style={{ color: '#b9e6ff' }}>尚未上传渔船 CSV</div>
              ) : boats.map(boat => (
                <div key={boat.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: 8, marginBottom: 8 }}>
                  <div style={{ marginBottom: 8, opacity: .9 }}>
                    {boat.name} <span style={{ fontSize: 12, opacity: 0.6 }}>({boat.id})</span>
                  </div>
                  <button onClick={() => startBoat(boat.id)} disabled={isPlayingMap[boat.id]} style={btnStyle}>开始</button>
                  <button onClick={() => pauseBoat(boat.id)} disabled={!isPlayingMap[boat.id]} style={btnStyle}>暂停</button>
                  <button onClick={() => resetBoat(boat.id)} style={btnStyle}>重置</button>

                  <button
                    onClick={() => {
                      setBoatPredState(prev => ({ ...prev, [boat.id]: { ...(prev[boat.id]||{}), isLoadingPred:true } }))
                      setTimeout(() => {
                        setBoatPredState(prev => ({ ...prev, [boat.id]: { ...(prev[boat.id]||{}), predUnlocked:true, predReady:true, isLoadingPred:false } }))
                        // 激活所有分支并自动播放
                        const bd = boatDataRef.current[boat.id]
                        if (bd) { for (let t = 1; t <= 8; t++) bd.altState[t].active = true }
                        startBoat(boat.id)
                      }, 1000)
                    }}
                    disabled={!boatPredState[boat.id]?.predUnlocked || boatPredState[boat.id]?.predReady}
                    style={{
                      ...btnStyle,
                      background: boatPredState[boat.id]?.predReady ? 'linear-gradient(90deg, #4caf50, #2e7d32)' : btnStyle.background,
                      opacity: !boatPredState[boat.id]?.predUnlocked ? 0.5 : 1,
                      cursor: !boatPredState[boat.id]?.predUnlocked ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {boatPredState[boat.id]?.isLoadingPred ? '预测中' : boatPredState[boat.id]?.predReady ? '已预测' : '预测'}
                  </button>
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

            <Section title="警告日志" openKey="alerts">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                <button onClick={() => setAlerts([])} style={btnStyle}>清空</button>
              </div>
              {alerts.length === 0 ? (
                <div style={{ color: '#b9e6ff' }}>暂无警告</div>
              ) : alerts.map(a => (
                <div key={a.id} style={{ padding: '6px 8px', borderBottom: '1px dashed rgba(255,255,255,0.2)', lineHeight: 1.5 }}>
                  <div><strong>船</strong> {a.boatId}</div>
                  <div><strong>区域</strong> {a.regionName}</div>
                  <div style={{ color: '#c9f2ff' }}>{a.time.toLocaleString()}</div>
                </div>
              ))}
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
  cursor: 'pointer',
  marginLeft:16
}

/* ----------------- 工具函数 ----------------- */

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

function getCenterOfPositions(lonlatArr) {
  const pts = lonlatArr.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))
  const bs = Cesium.BoundingSphere.fromPoints(pts)
  return bs.center
}

function removeTempPoints(viewer) {
  const toRemove = viewer.entities.values.filter((e) => e.id && String(e.id).startsWith('temp_point_'))
  toRemove.forEach((e) => viewer.entities.remove(e))
}
