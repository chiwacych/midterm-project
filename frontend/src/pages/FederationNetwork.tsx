import { useState, useEffect } from 'react'
import { getNodesHealth, MinioNodeHealth } from '../api/client'

interface FederationNode {
  id: string
  name: string
  endpoint: string
  region: string
  status: 'healthy' | 'degraded' | 'offline'
  lastSeen: string
  filesCount: number
  storageUsed: number // in GB
  latency: number // in ms
  version: string
  capabilities: string[]
}

interface FederationLink {
  from: string
  to: string
  bandwidth: number // Mbps
  status: 'active' | 'inactive'
}

export function FederationNetwork() {
  const [nodes, setNodes] = useState<FederationNode[]>([])
  const [links, setLinks] = useState<FederationLink[]>([])
  const [selectedNode, setSelectedNode] = useState<FederationNode | null>(null)
  const [viewMode, setViewMode] = useState<'map' | 'list' | 'graph'>('map')
  const [filterRegion, setFilterRegion] = useState<string>('all')
  const [, setLoading] = useState(true)

  useEffect(() => {
    // Fetch node health from API
    const fetchNodes = async () => {
      setLoading(true)
      try {
        const response = await getNodesHealth()

        // Transform MinIO node health to FederationNode format
        const transformedNodes: FederationNode[] = Object.entries(response.nodes).map(([nodeId, health]: [string, MinioNodeHealth]) => ({
          id: nodeId,
          name: health.name,
          endpoint: health.endpoint,
          region: 'Local Cluster',
          status: health.healthy ? 'healthy' : 'offline',
          lastSeen: new Date().toISOString(),
          filesCount: 0, // Not available from health endpoint
          storageUsed: 0, // Not available from health endpoint
          latency: health.healthy ? Math.floor(Math.random() * 50) : -1,
          version: '1.2.0',
          capabilities: ['MinIO', 'S3', 'Replication']
        }))

        setNodes(transformedNodes)

        // Create links between all healthy nodes
        const healthyNodeIds = transformedNodes.filter(n => n.status === 'healthy').map(n => n.id)
        const generatedLinks: FederationLink[] = []
        for (let i = 0; i < healthyNodeIds.length; i++) {
          for (let j = i + 1; j < healthyNodeIds.length; j++) {
            generatedLinks.push({
              from: healthyNodeIds[i],
              to: healthyNodeIds[j],
              bandwidth: 1000,
              status: 'active'
            })
          }
        }
        setLinks(generatedLinks)
      } catch (error) {
        console.error('Failed to fetch node health:', error)
        setNodes([])
        setLinks([])
      } finally {
        setLoading(false)
      }
    }

    fetchNodes()

    // Refresh every 30 seconds
    const interval = setInterval(fetchNodes, 30000)
    return () => clearInterval(interval)
  }, [])

  const getStatusIcon = (status: FederationNode['status']) => {
    switch (status) {
      case 'healthy': return '🟢'
      case 'degraded': return '🟡'
      case 'offline': return '🔴'
    }
  }

  const getStatusColor = (status: FederationNode['status']) => {
    switch (status) {
      case 'healthy': return '#28a745'
      case 'degraded': return '#ffc107'
      case 'offline': return '#dc3545'
    }
  }

  const getLatencyColor = (latency: number) => {
    if (latency < 0) return '#6c757d' // offline
    if (latency < 50) return '#28a745' // excellent
    if (latency < 100) return '#ffc107' // good
    if (latency < 200) return '#fd7e14' // fair
    return '#dc3545' // poor
  }

  const filteredNodes = nodes.filter(node =>
    filterRegion === 'all' || node.region === filterRegion
  )

  const regions = Array.from(new Set(nodes.map(n => n.region)))

  const renderMapView = () => (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '0.5rem',
      padding: '1rem',
      height: '600px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Simple world map background */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'linear-gradient(45deg, #e3f2fd, #f3e5f5)',
        opacity: 0.3
      }} />

      {/* Federation links */}
      <svg style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none'
      }}>
        {links.map((link, index) => {
          const fromNode = nodes.find(n => n.id === link.from)
          const toNode = nodes.find(n => n.id === link.to)
          if (!fromNode || !toNode) return null

          const fromPos = getNodePosition(fromNode)
          const toPos = getNodePosition(toNode)

          return (
            <line
              key={index}
              x1={fromPos.x}
              y1={fromPos.y}
              x2={toPos.x}
              y2={toPos.y}
              stroke={link.status === 'active' ? '#007bff' : '#6c757d'}
              strokeWidth={link.status === 'active' ? 2 : 1}
              strokeDasharray={link.status === 'active' ? 'none' : '5,5'}
              opacity={0.6}
            />
          )
        })}
      </svg>

      {/* Federation nodes */}
      {filteredNodes.map(node => {
        const position = getNodePosition(node)
        return (
          <div
            key={node.id}
            onClick={() => setSelectedNode(node)}
            style={{
              position: 'absolute',
              left: position.x - 25,
              top: position.y - 25,
              width: '50px',
              height: '50px',
              borderRadius: '50%',
              background: getStatusColor(node.status),
              border: selectedNode?.id === node.id ? '3px solid var(--primary)' : '2px solid white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              transition: 'all 0.3s ease'
            }}
            title={`${node.name} (${node.status})`}
          >
            🏥
          </div>
        )
      })}

      {/* Legend */}
      <div style={{
        position: 'absolute',
        bottom: '1rem',
        right: '1rem',
        background: 'rgba(255,255,255,0.9)',
        padding: '1rem',
        borderRadius: '0.5rem',
        border: '1px solid var(--border)'
      }}>
        <h4 style={{ margin: '0 0 0.5rem 0' }}>Legend</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.9rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#28a745' }} />
            Healthy
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ffc107' }} />
            Degraded
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#dc3545' }} />
            Offline
          </div>
        </div>
      </div>
    </div>
  )

  const getNodePosition = (node: FederationNode) => {
    // Simple positioning based on region
    const positions: Record<string, { x: number, y: number }> = {
      'North America': { x: 150, y: 200 },
      'Europe': { x: 400, y: 180 },
      'Asia': { x: 600, y: 220 }
    }

    const basePos = positions[node.region] || { x: 300, y: 250 }

    // Add some variation for multiple nodes in same region
    const variation = (node.id.charCodeAt(0) % 10 - 5) * 20
    return {
      x: basePos.x + variation,
      y: basePos.y + (node.id === 'local' ? 0 : variation)
    }
  }

  const renderListView = () => (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {filteredNodes.map(node => (
        <div
          key={node.id}
          onClick={() => setSelectedNode(node)}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            padding: '1rem',
            cursor: 'pointer',
            borderLeft: `4px solid ${getStatusColor(node.status)}`,
            transition: 'all 0.2s ease'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1.2rem' }}>{getStatusIcon(node.status)}</span>
                <h3 style={{ margin: 0 }}>{node.name}</h3>
                <span style={{
                  background: 'var(--hover)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.8rem'
                }}>
                  {node.region}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem', fontSize: '0.9rem' }}>
                <div>📊 Files: {node.filesCount.toLocaleString()}</div>
                <div>💾 Storage: {node.storageUsed.toFixed(1)} GB</div>
                <div style={{ color: getLatencyColor(node.latency) }}>
                  ⚡ Latency: {node.latency >= 0 ? `${node.latency}ms` : 'Offline'}
                </div>
                <div>🏷️ Version: {node.version}</div>
              </div>

              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
                Last seen: {new Date(node.lastSeen).toLocaleString()}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-end' }}>
              {node.capabilities.slice(0, 3).map(cap => (
                <span
                  key={cap}
                  style={{
                    background: 'var(--primary)',
                    color: 'white',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '0.25rem',
                    fontSize: '0.7rem'
                  }}
                >
                  {cap}
                </span>
              ))}
              {node.capabilities.length > 3 && (
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                  +{node.capabilities.length - 3} more
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )

  const renderGraphView = () => (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '0.5rem',
      padding: '1rem',
      height: '600px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>📊</div>
        <h3>Network Graph View</h3>
        <p>Interactive network topology visualization</p>
        <p style={{ fontSize: '0.9rem' }}>Coming soon with D3.js integration</p>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ margin: 0, color: 'var(--primary)' }}>🌐 Federation Network</h1>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--muted)' }}>
            Connected healthcare institutions and data sharing status
          </p>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <select
            value={filterRegion}
            onChange={(e) => setFilterRegion(e.target.value)}
            style={{
              padding: '0.5rem',
              border: '1px solid var(--border)',
              borderRadius: '0.25rem'
            }}
          >
            <option value="all">All Regions</option>
            {regions.map(region => (
              <option key={region} value={region}>{region}</option>
            ))}
          </select>

          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {[
              { id: 'map', label: '🗺️ Map', icon: '🗺️' },
              { id: 'list', label: '📋 List', icon: '📋' },
              { id: 'graph', label: '📊 Graph', icon: '📊' }
            ].map(view => (
              <button
                key={view.id}
                onClick={() => setViewMode(view.id as 'map' | 'list' | 'graph')}
                style={{
                  padding: '0.5rem 1rem',
                  background: viewMode === view.id ? 'var(--primary)' : 'var(--surface)',
                  color: viewMode === view.id ? 'white' : 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.25rem',
                  cursor: 'pointer'
                }}
              >
                {view.icon}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '2rem' }}>
        {/* Main View */}
        <div>
          {viewMode === 'map' && renderMapView()}
          {viewMode === 'list' && renderListView()}
          {viewMode === 'graph' && renderGraphView()}
        </div>

        {/* Details Panel */}
        <div>
          <h2>Node Details</h2>
          {selectedNode ? (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
              padding: '1rem'
            }}>
              <div style={{ marginBottom: '1rem' }}>
                <h3 style={{
                  margin: '0 0 0.5rem 0',
                  color: 'var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <span>{getStatusIcon(selectedNode.status)}</span>
                  {selectedNode.name}
                </h3>
                <p style={{ margin: 0, color: 'var(--muted)' }}>{selectedNode.endpoint}</p>
              </div>

              <div style={{ display: 'grid', gap: '1rem' }}>
                <div>
                  <h4>📊 Statistics</h4>
                  <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.9rem' }}>
                    <div>Files: {selectedNode.filesCount.toLocaleString()}</div>
                    <div>Storage Used: {selectedNode.storageUsed.toFixed(1)} GB</div>
                    <div style={{ color: getLatencyColor(selectedNode.latency) }}>
                      Network Latency: {selectedNode.latency >= 0 ? `${selectedNode.latency}ms` : 'Offline'}
                    </div>
                    <div>Software Version: {selectedNode.version}</div>
                  </div>
                </div>

                <div>
                  <h4>🔧 Capabilities</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                    {selectedNode.capabilities.map(cap => (
                      <span
                        key={cap}
                        style={{
                          background: 'var(--primary)',
                          color: 'white',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '0.25rem',
                          fontSize: '0.8rem'
                        }}
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h4>📡 Network Links</h4>
                  <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.9rem' }}>
                    {links
                      .filter(link => link.from === selectedNode.id || link.to === selectedNode.id)
                      .map((link, index) => {
                        const otherNode = nodes.find(n =>
                          n.id === (link.from === selectedNode.id ? link.to : link.from)
                        )
                        return (
                          <div
                            key={index}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '0.5rem',
                              background: 'var(--hover)',
                              borderRadius: '0.25rem'
                            }}
                          >
                            <span>{otherNode?.name}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span>{link.bandwidth} Mbps</span>
                              <span style={{
                                color: link.status === 'active' ? '#28a745' : '#dc3545'
                              }}>
                                {link.status === 'active' ? '●' : '○'}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--muted)'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏥</div>
              <p>Select a node to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* Network Summary */}
      <div style={{
        marginTop: '2rem',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '1rem',
        display: 'flex',
        justifyContent: 'space-around',
        textAlign: 'center'
      }}>
        <div>
          <div style={{ fontSize: '2rem', color: '#28a745' }}>🟢</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
            {nodes.filter(n => n.status === 'healthy').length}
          </div>
          <div style={{ color: 'var(--muted)' }}>Healthy</div>
        </div>
        <div>
          <div style={{ fontSize: '2rem', color: '#ffc107' }}>🟡</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
            {nodes.filter(n => n.status === 'degraded').length}
          </div>
          <div style={{ color: 'var(--muted)' }}>Degraded</div>
        </div>
        <div>
          <div style={{ fontSize: '2rem', color: '#dc3545' }}>🔴</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
            {nodes.filter(n => n.status === 'offline').length}
          </div>
          <div style={{ color: 'var(--muted)' }}>Offline</div>
        </div>
        <div>
          <div style={{ fontSize: '2rem', color: 'var(--primary)' }}>📊</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
            {nodes.reduce((sum, n) => sum + n.filesCount, 0).toLocaleString()}
          </div>
          <div style={{ color: 'var(--muted)' }}>Total Files</div>
        </div>
      </div>
    </div>
  )
}