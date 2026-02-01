import { useState, useEffect } from 'react'
import { listAuditEvents, AuditEvent as ApiAuditEvent } from '../api/client'

interface AuditEvent {
  id: string
  timestamp: string
  eventType: string
  userId: string
  userRole: string
  action: string
  resource: string
  resourceId: string
  ipAddress: string
  userAgent: string
  status: 'success' | 'failure' | 'warning'
  details: Record<string, unknown>
  severity: 'low' | 'medium' | 'high' | 'critical'
}

export function AuditLogViewer() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [filteredEvents, setFilteredEvents] = useState<AuditEvent[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState({
    event_type: '',
    user_id: '',
    status: '',
    severity: '',
    date_from: '',
    date_to: ''
  })
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(20)
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null)
  const [viewMode, setViewMode] = useState<'table' | 'timeline' | 'analytics'>('table')
  const [, setLoading] = useState(true)
  const [, setTotalEvents] = useState(0)

  // Transform API event to local format
  const transformEvent = (e: ApiAuditEvent): AuditEvent => ({
    id: String(e.id),
    timestamp: e.timestamp,
    eventType: e.event_type,
    userId: String(e.user_id ?? 'unknown'),
    userRole: e.user_role ?? 'unknown',
    action: e.action,
    resource: e.resource ?? '',
    resourceId: e.resource_id ?? '',
    ipAddress: e.ip_address ?? '',
    userAgent: e.user_agent ?? '',
    status: e.status,
    severity: e.severity,
    details: e.details ?? {}
  })

  useEffect(() => {
    // Fetch audit events from API
    const fetchEvents = async () => {
      setLoading(true)
      try {
        const response = await listAuditEvents({
          event_type: filters.event_type || undefined,
          user_id: filters.user_id ? parseInt(filters.user_id) : undefined,
          status: filters.status || undefined,
          severity: filters.severity || undefined,
          date_from: filters.date_from || undefined,
          date_to: filters.date_to || undefined,
          page: currentPage,
          page_size: pageSize
        })
        const transformed = response.events.map(transformEvent)
        setEvents(transformed)
        setFilteredEvents(transformed)
        setTotalEvents(response.total)
      } catch (error) {
        console.error('Failed to fetch audit events:', error)
        // Set empty array on error
        setEvents([])
        setFilteredEvents([])
      } finally {
        setLoading(false)
      }
    }
    fetchEvents()
  }, [filters.event_type, filters.status, filters.severity, filters.date_from, filters.date_to, currentPage, pageSize])

  useEffect(() => {
    const filtered = events.filter(event => {
      if (searchQuery && !Object.values(event).some(value =>
        String(value).toLowerCase().includes(searchQuery.toLowerCase())
      )) return false

      if (filters.user_id && event.userId !== filters.user_id) return false

      return true
    })

    setFilteredEvents(filtered)
  }, [events, searchQuery, filters.user_id])

  const getStatusIcon = (status: AuditEvent['status']) => {
    switch (status) {
      case 'success': return '✅'
      case 'failure': return '❌'
      case 'warning': return '⚠️'
    }
  }

  const getStatusColor = (status: AuditEvent['status']) => {
    switch (status) {
      case 'success': return '#28a745'
      case 'failure': return '#dc3545'
      case 'warning': return '#ffc107'
    }
  }

  const getSeverityColor = (severity: AuditEvent['severity']) => {
    switch (severity) {
      case 'low': return '#6c757d'
      case 'medium': return '#007bff'
      case 'high': return '#fd7e14'
      case 'critical': return '#dc3545'
    }
  }

  const getEventTypeIcon = (eventType: string) => {
    if (eventType.includes('upload')) return '📤'
    if (eventType.includes('download')) return '📥'
    if (eventType.includes('delete')) return '🗑️'
    if (eventType.includes('login')) return '🔐'
    if (eventType.includes('consent')) return '📋'
    return '📝'
  }

  const paginatedEvents = filteredEvents.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  const totalPages = Math.ceil(filteredEvents.length / pageSize)

  const renderTableView = () => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem'
      }}>
        <thead>
          <tr style={{ background: 'var(--hover)' }}>
            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Time</th>
            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Event</th>
            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>User</th>
            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Action</th>
            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Status</th>
            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Severity</th>
          </tr>
        </thead>
        <tbody>
          {paginatedEvents.map(event => (
            <tr
              key={event.id}
              onClick={() => setSelectedEvent(event)}
              style={{
                cursor: 'pointer',
                borderBottom: '1px solid var(--border)'
              }}
            >
              <td style={{ padding: '0.75rem' }}>
                {new Date(event.timestamp).toLocaleString()}
              </td>
              <td style={{ padding: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>{getEventTypeIcon(event.eventType)}</span>
                  <span>{event.eventType}</span>
                </div>
              </td>
              <td style={{ padding: '0.75rem' }}>
                <div>
                  <div style={{ fontWeight: 'bold' }}>{event.userId}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{event.userRole}</div>
                </div>
              </td>
              <td style={{ padding: '0.75rem' }}>{event.action}</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{
                  color: getStatusColor(event.status),
                  fontWeight: 'bold'
                }}>
                  {getStatusIcon(event.status)} {event.status}
                </span>
              </td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{
                  background: getSeverityColor(event.severity),
                  color: 'white',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.8rem',
                  fontWeight: 'bold'
                }}>
                  {event.severity.toUpperCase()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const renderTimelineView = () => (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {paginatedEvents.map(event => (
        <div
          key={event.id}
          onClick={() => setSelectedEvent(event)}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            padding: '1rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem'
          }}
        >
          <div style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: getStatusColor(event.status),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem'
          }}>
            {getEventTypeIcon(event.eventType)}
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <h4 style={{ margin: '0 0 0.25rem 0' }}>{event.action}</h4>
                <p style={{ margin: '0', color: 'var(--muted)', fontSize: '0.9rem' }}>
                  {event.userId} ({event.userRole}) • {event.resource} • {event.resourceId}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
                  {new Date(event.timestamp).toLocaleString()}
                </div>
                <div style={{
                  background: getSeverityColor(event.severity),
                  color: 'white',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  display: 'inline-block',
                  marginTop: '0.25rem'
                }}>
                  {event.severity.toUpperCase()}
                </div>
              </div>
            </div>
          </div>

          <div style={{
            color: getStatusColor(event.status),
            fontSize: '1.2rem'
          }}>
            {getStatusIcon(event.status)}
          </div>
        </div>
      ))}
    </div>
  )

  const renderAnalyticsView = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
      {/* Event Type Distribution */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '1rem'
      }}>
        <h3>Event Types</h3>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {Object.entries(
            filteredEvents.reduce((acc, event) => {
              acc[event.eventType] = (acc[event.eventType] || 0) + 1
              return acc
            }, {} as Record<string, number>)
          ).map(([type, count]) => (
            <div key={type} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{type}</span>
              <span style={{ fontWeight: 'bold' }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Status Distribution */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '1rem'
      }}>
        <h3>Status Distribution</h3>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {Object.entries(
            filteredEvents.reduce((acc, event) => {
              acc[event.status] = (acc[event.status] || 0) + 1
              return acc
            }, {} as Record<string, number>)
          ).map(([status, count]) => (
            <div key={status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: getStatusColor(status as AuditEvent['status']) }}>
                {getStatusIcon(status as AuditEvent['status'])} {status}
              </span>
              <span style={{ fontWeight: 'bold' }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Severity Distribution */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '1rem'
      }}>
        <h3>Severity Levels</h3>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {Object.entries(
            filteredEvents.reduce((acc, event) => {
              acc[event.severity] = (acc[event.severity] || 0) + 1
              return acc
            }, {} as Record<string, number>)
          ).map(([severity, count]) => (
            <div key={severity} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{
                background: getSeverityColor(severity as AuditEvent['severity']),
                color: 'white',
                padding: '0.25rem 0.5rem',
                borderRadius: '0.25rem',
                fontSize: '0.8rem'
              }}>
                {severity.toUpperCase()}
              </span>
              <span style={{ fontWeight: 'bold' }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '1rem'
      }}>
        <h3>Recent Activity</h3>
        <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
          {filteredEvents.slice(0, 10).map(event => (
            <div key={event.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.9rem'
            }}>
              <span>{getEventTypeIcon(event.eventType)}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {event.action}
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ margin: 0, color: 'var(--primary)' }}>📊 Audit Log Viewer</h1>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--muted)' }}>
            Comprehensive security and activity monitoring
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {[
            { id: 'table', label: '📋 Table', icon: '📋' },
            { id: 'timeline', label: '⏱️ Timeline', icon: '⏱️' },
            { id: 'analytics', label: '📈 Analytics', icon: '📈' }
          ].map(view => (
            <button
              key={view.id}
              onClick={() => setViewMode(view.id as 'table' | 'timeline' | 'analytics')}
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

      {/* Search and Filters */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '1rem',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1rem', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search audit logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '0.5rem',
              border: '1px solid var(--border)',
              borderRadius: '0.25rem',
              width: '100%'
            }}
          />

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <select
              value={filters.event_type}
              onChange={(e) => setFilters(prev => ({ ...prev, event_type: e.target.value }))}
              style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '0.25rem' }}
            >
              <option value="">All Event Types</option>
              <option value="file.upload">File Upload</option>
              <option value="file.download">File Download</option>
              <option value="file.delete">File Delete</option>
              <option value="auth.login">Login</option>
              <option value="consent.grant">Consent Grant</option>
            </select>

            <select
              value={filters.status}
              onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
              style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '0.25rem' }}
            >
              <option value="">All Status</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="warning">Warning</option>
            </select>

            <select
              value={filters.severity}
              onChange={(e) => setFilters(prev => ({ ...prev, severity: e.target.value }))}
              style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '0.25rem' }}
            >
              <option value="">All Severity</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>

            <button
              onClick={() => {
                setSearchQuery('')
                setFilters({
                  event_type: '',
                  user_id: '',
                  status: '',
                  severity: '',
                  date_from: '',
                  date_to: ''
                })
              }}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--error)',
                color: 'white',
                border: 'none',
                borderRadius: '0.25rem',
                cursor: 'pointer'
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '2rem' }}>
        {/* Main Content */}
        <div>
          {viewMode === 'table' && renderTableView()}
          {viewMode === 'timeline' && renderTimelineView()}
          {viewMode === 'analytics' && renderAnalyticsView()}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '1rem',
              marginTop: '2rem'
            }}>
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                style={{
                  padding: '0.5rem 1rem',
                  background: currentPage === 1 ? 'var(--border)' : 'var(--primary)',
                  color: currentPage === 1 ? 'var(--muted)' : 'white',
                  border: 'none',
                  borderRadius: '0.25rem',
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
                }}
              >
                Previous
              </button>

              <span>
                Page {currentPage} of {totalPages} ({filteredEvents.length} events)
              </span>

              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                style={{
                  padding: '0.5rem 1rem',
                  background: currentPage === totalPages ? 'var(--border)' : 'var(--primary)',
                  color: currentPage === totalPages ? 'var(--muted)' : 'white',
                  border: 'none',
                  borderRadius: '0.25rem',
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
                }}
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Event Details */}
        <div>
          <h2>Event Details</h2>
          {selectedEvent ? (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
              padding: '1rem',
              fontSize: '0.9rem'
            }}>
              <div style={{ marginBottom: '1rem' }}>
                <h3 style={{
                  margin: '0 0 0.5rem 0',
                  color: 'var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <span>{getEventTypeIcon(selectedEvent.eventType)}</span>
                  {selectedEvent.action}
                </h3>
                <div style={{
                  color: getStatusColor(selectedEvent.status),
                  fontWeight: 'bold',
                  marginBottom: '0.5rem'
                }}>
                  {getStatusIcon(selectedEvent.status)} {selectedEvent.status.toUpperCase()}
                </div>
              </div>

              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <div>
                  <strong>Timestamp:</strong> {new Date(selectedEvent.timestamp).toLocaleString()}
                </div>
                <div>
                  <strong>Event Type:</strong> {selectedEvent.eventType}
                </div>
                <div>
                  <strong>User:</strong> {selectedEvent.userId} ({selectedEvent.userRole})
                </div>
                <div>
                  <strong>Resource:</strong> {selectedEvent.resource} ({selectedEvent.resourceId})
                </div>
                <div>
                  <strong>IP Address:</strong> {selectedEvent.ipAddress}
                </div>
                <div>
                  <strong>Severity:</strong>
                  <span style={{
                    background: getSeverityColor(selectedEvent.severity),
                    color: 'white',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '0.25rem',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    marginLeft: '0.5rem'
                  }}>
                    {selectedEvent.severity.toUpperCase()}
                  </span>
                </div>
                <div>
                  <strong>User Agent:</strong>
                  <div style={{
                    background: 'var(--hover)',
                    padding: '0.5rem',
                    borderRadius: '0.25rem',
                    fontSize: '0.8rem',
                    marginTop: '0.25rem',
                    wordBreak: 'break-all'
                  }}>
                    {selectedEvent.userAgent}
                  </div>
                </div>
                <div>
                  <strong>Details:</strong>
                  <pre style={{
                    background: 'var(--hover)',
                    padding: '0.5rem',
                    borderRadius: '0.25rem',
                    fontSize: '0.8rem',
                    marginTop: '0.25rem',
                    overflow: 'auto',
                    maxHeight: '200px'
                  }}>
                    {JSON.stringify(selectedEvent.details, null, 2)}
                  </pre>
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
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</div>
              <p>Select an event to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}