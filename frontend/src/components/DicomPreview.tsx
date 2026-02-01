import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { FileInfo } from '../api/client'

interface DicomPreviewProps {
  file: FileInfo
  onClose?: () => void
}

export function DicomPreview({ file, onClose }: DicomPreviewProps) {
  // const handleClose = onClose || (() => window.history.back())
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [windowing, setWindowing] = useState({ center: 128, width: 256 })
  const [isDragging, setIsDragging] = useState(false)
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 })
  const [measurements, setMeasurements] = useState<Array<{ start: { x: number, y: number }, end: { x: number, y: number }, distance: number }>>([])
  const [isMeasuring, setIsMeasuring] = useState(false)
  const [currentMeasurement, setCurrentMeasurement] = useState<{ start?: { x: number, y: number }, end?: { x: number, y: number } }>({})

  // Extract DICOM metadata from file description or use defaults
  // In production, this would parse actual DICOM file metadata from backend
  const dicomMetadata = useMemo(() => {
    const parsedDescription = file.description || ''
    return {
      width: 512,
      height: 512,
      pixelData: new Uint8Array(512 * 512).map((_, i) => Math.sin(i * 0.01) * 127 + 128),
      patientName: parsedDescription.match(/Patient: ([^,]+)/)?.[1] || 'ANONYMOUS',
      patientId: parsedDescription.match(/ID: ([^,]+)/)?.[1] || file.user_id,
      studyDate: new Date(file.upload_timestamp).toISOString().slice(0, 10).replace(/-/g, ''),
      modality: file.content_type?.includes('ct') ? 'CT' : file.content_type?.includes('mri') ? 'MRI' : file.content_type?.includes('xray') ? 'CR' : 'OT',
      bodyPart: parsedDescription.match(/Body: ([^,]+)/)?.[1] || 'UNKNOWN',
      sliceThickness: '5.0mm',
      kvp: '120',
      mas: '100'
    }
  }, [file])

  const drawImage = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Apply windowing to pixel data
    const windowedData = dicomMetadata.pixelData.map(pixel => {
      const windowed = ((pixel - windowing.center + windowing.width / 2) / windowing.width) * 255
      return Math.max(0, Math.min(255, windowed))
    })

    // Create image data
    const imageData = ctx.createImageData(dicomMetadata.width, dicomMetadata.height)
    for (let i = 0; i < windowedData.length; i++) {
      const value = windowedData[i]
      imageData.data[i * 4] = value     // R
      imageData.data[i * 4 + 1] = value // G
      imageData.data[i * 4 + 2] = value // B
      imageData.data[i * 4 + 3] = 255   // A
    }

    // Save context
    ctx.save()

    // Apply zoom and pan
    ctx.translate(canvas.width / 2 + pan.x, canvas.height / 2 + pan.y)
    ctx.scale(zoom, zoom)
    ctx.translate(-dicomMetadata.width / 2, -dicomMetadata.height / 2)

    // Draw image
    ctx.putImageData(imageData, 0, 0)

    // Draw measurements
    ctx.strokeStyle = '#ff0000'
    ctx.lineWidth = 2 / zoom
    measurements.forEach(measurement => {
      ctx.beginPath()
      ctx.moveTo(measurement.start.x, measurement.start.y)
      ctx.lineTo(measurement.end.x, measurement.end.y)
      ctx.stroke()

      // Draw measurement label
      const midX = (measurement.start.x + measurement.end.x) / 2
      const midY = (measurement.start.y + measurement.end.y) / 2
      ctx.fillStyle = '#ff0000'
      ctx.font = `${12 / zoom}px Arial`
      ctx.fillText(`${measurement.distance.toFixed(1)}mm`, midX + 5, midY - 5)
    })

    // Draw current measurement line
    if (isMeasuring && currentMeasurement.start) {
      ctx.strokeStyle = '#00ff00'
      ctx.setLineDash([5 / zoom, 5 / zoom])
      ctx.beginPath()
      ctx.moveTo(currentMeasurement.start.x, currentMeasurement.start.y)
      if (currentMeasurement.end) {
        ctx.lineTo(currentMeasurement.end.x, currentMeasurement.end.y)
      }
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Restore context
    ctx.restore()
  }, [zoom, pan, windowing, measurements, isMeasuring, currentMeasurement, dicomMetadata])

  useEffect(() => {
    drawImage()
  }, [drawImage])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isMeasuring) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const x = (e.clientX - rect.left - pan.x - rect.width / 2) / zoom + dicomMetadata.width / 2
      const y = (e.clientY - rect.top - pan.y - rect.height / 2) / zoom + dicomMetadata.height / 2

      if (!currentMeasurement.start) {
        setCurrentMeasurement({ start: { x, y } })
      } else {
        const distance = Math.sqrt(
          Math.pow(x - currentMeasurement.start.x, 2) +
          Math.pow(y - currentMeasurement.start.y, 2)
        ) * 0.5 // Mock pixel spacing

        setMeasurements(prev => [...prev, {
          start: currentMeasurement.start!,
          end: { x, y },
          distance
        }])
        setCurrentMeasurement({})
        setIsMeasuring(false)
      }
    } else {
      setIsDragging(true)
      setLastMousePos({ x: e.clientX, y: e.clientY })
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      const deltaX = e.clientX - lastMousePos.x
      const deltaY = e.clientY - lastMousePos.y
      setPan(prev => ({ x: prev.x + deltaX, y: prev.y + deltaY }))
      setLastMousePos({ x: e.clientX, y: e.clientY })
    } else if (isMeasuring && currentMeasurement.start) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const x = (e.clientX - rect.left - pan.x - rect.width / 2) / zoom + dicomMetadata.width / 2
      const y = (e.clientY - rect.top - pan.y - rect.height / 2) / zoom + dicomMetadata.height / 2

      setCurrentMeasurement(prev => ({ ...prev, end: { x, y } }))
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(prev => Math.max(0.1, Math.min(5, prev * zoomFactor)))
  }

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setWindowing({ center: 128, width: 256 })
  }

  const clearMeasurements = () => {
    setMeasurements([])
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.9)',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{
        background: 'var(--surface)',
        padding: '1rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid var(--border)'
      }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--text)' }}>🩺 DICOM Viewer - {file.filename}</h2>
          <div style={{ fontSize: '0.9rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
            Patient: {dicomMetadata.patientName} • ID: {dicomMetadata.patientId} •
            Study: {dicomMetadata.studyDate} • Modality: {dicomMetadata.modality}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--error)',
            color: 'white',
            border: 'none',
            borderRadius: '0.25rem',
            cursor: 'pointer'
          }}
        >
          ✕ Close
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={{
          width: '300px',
          background: 'var(--surface)',
          padding: '1rem',
          borderRight: '1px solid var(--border)',
          overflowY: 'auto'
        }}>
          {/* DICOM Metadata */}
          <div style={{ marginBottom: '2rem' }}>
            <h3>📋 Study Information</h3>
            <div style={{ fontSize: '0.9rem', lineHeight: '1.5' }}>
              <div><strong>Body Part:</strong> {dicomMetadata.bodyPart}</div>
              <div><strong>Slice Thickness:</strong> {dicomMetadata.sliceThickness}</div>
              <div><strong>KVP:</strong> {dicomMetadata.kvp}</div>
              <div><strong>mAs:</strong> {dicomMetadata.mas}</div>
              <div><strong>Dimensions:</strong> {dicomMetadata.width}×{dicomMetadata.height}</div>
            </div>
          </div>

          {/* Tools */}
          <div style={{ marginBottom: '2rem' }}>
            <h3>🔧 Tools</h3>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <button
                onClick={() => setIsMeasuring(!isMeasuring)}
                style={{
                  padding: '0.5rem',
                  background: isMeasuring ? 'var(--primary)' : 'var(--surface)',
                  color: isMeasuring ? 'white' : 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.25rem',
                  cursor: 'pointer'
                }}
              >
                📏 Measure Distance
              </button>
              <button
                onClick={clearMeasurements}
                style={{
                  padding: '0.5rem',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.25rem',
                  cursor: 'pointer'
                }}
              >
                🗑️ Clear Measurements
              </button>
              <button
                onClick={resetView}
                style={{
                  padding: '0.5rem',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.25rem',
                  cursor: 'pointer'
                }}
              >
                🔄 Reset View
              </button>
            </div>
          </div>

          {/* Windowing Controls */}
          <div style={{ marginBottom: '2rem' }}>
            <h3>🎛️ Windowing</h3>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <div>
                <label>Window Center: {windowing.center}</label>
                <input
                  type="range"
                  min="-1000"
                  max="3000"
                  value={windowing.center}
                  onChange={(e) => setWindowing(prev => ({ ...prev, center: Number(e.target.value) }))}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label>Window Width: {windowing.width}</label>
                <input
                  type="range"
                  min="1"
                  max="4000"
                  value={windowing.width}
                  onChange={(e) => setWindowing(prev => ({ ...prev, width: Number(e.target.value) }))}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
                <button
                  onClick={() => setWindowing({ center: 400, width: 1800 })}
                  style={{
                    padding: '0.25rem',
                    fontSize: '0.8rem',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.25rem',
                    cursor: 'pointer'
                  }}
                >
                  Lung
                </button>
                <button
                  onClick={() => setWindowing({ center: 40, width: 400 })}
                  style={{
                    padding: '0.25rem',
                    fontSize: '0.8rem',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.25rem',
                    cursor: 'pointer'
                  }}
                >
                  Soft Tissue
                </button>
                <button
                  onClick={() => setWindowing({ center: 1000, width: 2000 })}
                  style={{
                    padding: '0.25rem',
                    fontSize: '0.8rem',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.25rem',
                    cursor: 'pointer'
                  }}
                >
                  Bone
                </button>
                <button
                  onClick={() => setWindowing({ center: 128, width: 256 })}
                  style={{
                    padding: '0.25rem',
                    fontSize: '0.8rem',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.25rem',
                    cursor: 'pointer'
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Measurements */}
          {measurements.length > 0 && (
            <div>
              <h3>📏 Measurements ({measurements.length})</h3>
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {measurements.map((measurement, index) => (
                  <div
                    key={index}
                    style={{
                      padding: '0.5rem',
                      margin: '0.25rem 0',
                      background: 'var(--hover)',
                      borderRadius: '0.25rem',
                      fontSize: '0.9rem'
                    }}
                  >
                    Measurement {index + 1}: {measurement.distance.toFixed(1)}mm
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, position: 'relative', background: '#000' }}>
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            style={{
              cursor: isMeasuring ? 'crosshair' : isDragging ? 'grabbing' : 'grab',
              maxWidth: '100%',
              maxHeight: '100%',
              imageRendering: 'pixelated'
            }}
          />

          {/* Zoom indicator */}
          <div style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            padding: '0.5rem',
            borderRadius: '0.25rem',
            fontSize: '0.9rem'
          }}>
            Zoom: {(zoom * 100).toFixed(0)}%
          </div>

          {/* Instructions */}
          <div style={{
            position: 'absolute',
            bottom: '1rem',
            left: '1rem',
            background: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            padding: '0.5rem',
            borderRadius: '0.25rem',
            fontSize: '0.8rem',
            maxWidth: '300px'
          }}>
            <div><strong>Controls:</strong></div>
            <div>• Drag to pan • Scroll to zoom</div>
            <div>• Click &quot;Measure Distance&quot; then click two points</div>
            <div>• Use windowing controls to adjust contrast</div>
          </div>
        </div>
      </div>
    </div>
  )
}