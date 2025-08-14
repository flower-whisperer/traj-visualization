import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'

export default function App() {
  const containerRef = useRef(null)
  const viewerRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)

  // 模拟的 GPS 轨迹数据（你后面替换成真实的）
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
];



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
  //   viewer.imageryLayers.removeAll()
  //   viewer.imageryLayers.addImageryProvider(
  // new Cesium.UrlTemplateImageryProvider({
  //   url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  // })
// );

    viewerRef.current = viewer
    
    // ===== 相机交互锁定/解锁函数 =====
    const lockCameraControls = (lock) => {
      const c = viewer.scene.screenSpaceCameraController
      c.enableRotate = !lock
      c.enableTranslate = !lock
      c.enableZoom = !lock
      c.enableTilt = !lock
      c.enableLook = !lock
    }
    lockCameraControls(true)

    // ===== 初始视角 =====
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0, 0, 20000000),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-90),
        roll: 0,
      }
    })

    // ===== 缓慢自转 =====
    let isRotating = true
    const rotationSpeed = Cesium.Math.toRadians(30)
    const rotationHandler = () => {
      if (isRotating) {
        viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -rotationSpeed / 60)
      }
    }
    viewer.clock.onTick.addEventListener(rotationHandler)

    // ===== 创建轨迹 PositionProperty =====
    const positionProperty = new Cesium.SampledPositionProperty()
    const start = Cesium.JulianDate.now()
    const totalSeconds = gpsPoints.length * 5 // 每点5秒
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

    // ===== 加载渔船模型 =====
    const boatEntity = viewer.entities.add({
      availability: new Cesium.TimeIntervalCollection([
        new Cesium.TimeInterval({ start, stop }),
      ]),
      position: positionProperty,
      orientation: new Cesium.VelocityOrientationProperty(positionProperty),
      model: {
        uri: "/models/boat_a.glb",
        scale: 20,
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

    // ===== 点击事件处理（保留原逻辑） =====
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

  // ===== 控制按钮 =====
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

      {/* 半透明悬浮控制面板 */}
      <div style={{
        position: 'absolute',
        top: 200,
        right: 200,
        background: 'rgba(0,0,0,0.5)',
        padding: '12px 16px',
        borderRadius: 8,
        color: '#fff',
        minWidth: 160
      }}>
        <h4 style={{ margin: '0 0 8px 0' }}>渔船控制</h4>
        <button onClick={handleStart} disabled={isPlaying} style={{ width: '100%', marginBottom: 8 }}>开始</button>
        <button onClick={handlePause} disabled={!isPlaying} style={{ width: '100%', marginBottom: 8 }}>暂停</button>
        <button onClick={handleReset} style={{ width: '100%' }}>重置</button>
      </div>
    </div>
  )
}
