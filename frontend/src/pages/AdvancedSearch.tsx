import { useState, useEffect } from 'react'
import { listFiles, FileInfo } from '../api/client'

interface SearchFilters {
  filename: string
  contentType: string
  sizeMin: number
  sizeMax: number
  dateFrom: string
  dateTo: string
  userId: string
}

interface SearchFacet {
  name: string
  count: number
  selected: boolean
}

export function AdvancedSearch() {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<SearchFilters>({
    filename: '',
    contentType: '',
    sizeMin: 0,
    sizeMax: 0,
    dateFrom: '',
    dateTo: '',
    userId: ''
  })
  const [results, setResults] = useState<FileInfo[]>([])
  const [facets, setFacets] = useState<{contentTypes: SearchFacet[], users: SearchFacet[]}>({
    contentTypes: [],
    users: []
  })
  const [loading, setLoading] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([])
  const [searchMode, setSearchMode] = useState<'basic' | 'advanced' | 'ai'>('basic')

  // AI-powered search suggestions
  useEffect(() => {
    if (query.length > 2) {
      // Simulate AI suggestions based on medical imaging terms
      const suggestions = [
        'CT scan brain',
        'MRI lumbar spine',
        'X-ray chest PA',
        'Ultrasound abdomen',
        'Mammogram bilateral',
        'PET scan whole body'
      ].filter(s => s.toLowerCase().includes(query.toLowerCase()))
      setAiSuggestions(suggestions.slice(0, 3))
    } else {
      setAiSuggestions([])
    }
  }, [query])

  const performSearch = async () => {
    setLoading(true)
    try {
      const { files } = await listFiles()

      // Apply filters
      const filtered = files.filter(file => {
        if (filters.filename && !file.filename.toLowerCase().includes(filters.filename.toLowerCase())) return false
        if (filters.contentType && file.content_type !== filters.contentType) return false
        if (filters.sizeMin && file.size < filters.sizeMin) return false
        if (filters.sizeMax && file.size > filters.sizeMax) return false
        if (filters.dateFrom && new Date(file.upload_timestamp) < new Date(filters.dateFrom)) return false
        if (filters.dateTo && new Date(file.upload_timestamp) > new Date(filters.dateTo)) return false
        if (filters.userId && file.user_id !== filters.userId) return false
        return true
      })

      // Calculate facets
      const contentTypeCounts = filtered.reduce((acc, file) => {
        const type = file.content_type || 'unknown'
        acc[type] = (acc[type] || 0) + 1
        return acc
      }, {} as Record<string, number>)

      const userCounts = filtered.reduce((acc, file) => {
        acc[file.user_id] = (acc[file.user_id] || 0) + 1
        return acc
      }, {} as Record<string, number>)

      setFacets({
        contentTypes: Object.entries(contentTypeCounts).map(([name, count]) => ({
          name,
          count,
          selected: filters.contentType === name
        })),
        users: Object.entries(userCounts).map(([name, count]) => ({
          name,
          count,
          selected: filters.userId === name
        }))
      })

      setResults(filtered)
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFacetClick = (facetType: 'contentType' | 'userId', value: string) => {
    setFilters(prev => ({
      ...prev,
      [facetType]: prev[facetType] === value ? '' : value
    }))
  }

  const clearFilters = () => {
    setFilters({
      filename: '',
      contentType: '',
      sizeMin: 0,
      sizeMax: 0,
      dateFrom: '',
      dateTo: '',
      userId: ''
    })
    setQuery('')
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '2rem', color: 'var(--text)' }}>🔍 Advanced Medical Image Search</h1>

      {/* Search Mode Toggle */}
      <div style={{ marginBottom: '1rem' }}>
        <button
          onClick={() => setSearchMode('basic')}
          style={{
            padding: '0.5rem 1rem',
            marginRight: '0.5rem',
            background: searchMode === 'basic' ? 'var(--primary)' : 'var(--surface)',
            color: searchMode === 'basic' ? 'white' : 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            cursor: 'pointer'
          }}
        >
          Basic Search
        </button>
        <button
          onClick={() => setSearchMode('advanced')}
          style={{
            padding: '0.5rem 1rem',
            marginRight: '0.5rem',
            background: searchMode === 'advanced' ? 'var(--primary)' : 'var(--surface)',
            color: searchMode === 'advanced' ? 'white' : 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            cursor: 'pointer'
          }}
        >
          Advanced Filters
        </button>
        <button
          onClick={() => setSearchMode('ai')}
          style={{
            padding: '0.5rem 1rem',
            background: searchMode === 'ai' ? 'var(--primary)' : 'var(--surface)',
            color: searchMode === 'ai' ? 'white' : 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            cursor: 'pointer'
          }}
        >
          🤖 AI-Powered Search
        </button>
      </div>

      {/* Search Input */}
      <div style={{ position: 'relative', marginBottom: '2rem' }}>
        <input
          type="text"
          placeholder={searchMode === 'ai' ? "Describe what you're looking for (e.g., 'recent CT scans of chest')" : "Search files..."}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && performSearch()}
          style={{
            width: '100%',
            padding: '1rem',
            fontSize: '1.1rem',
            border: '2px solid var(--border)',
            borderRadius: '0.5rem',
            background: 'var(--surface)',
            color: 'var(--text)'
          }}
        />
        <button
          onClick={performSearch}
          disabled={loading}
          style={{
            position: 'absolute',
            right: '0.5rem',
            top: '50%',
            transform: 'translateY(-50%)',
            padding: '0.5rem 1rem',
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            borderRadius: '0.25rem',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? '🔄' : '🔍'} Search
        </button>

        {/* AI Suggestions */}
        {aiSuggestions.length > 0 && searchMode === 'ai' && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            zIndex: 1000,
            maxHeight: '200px',
            overflowY: 'auto'
          }}>
            {aiSuggestions.map((suggestion, index) => (
              <div
                key={index}
                onClick={() => {
                  setQuery(suggestion)
                  setAiSuggestions([])
                }}
                style={{
                  padding: '0.5rem 1rem',
                  cursor: 'pointer',
                  borderBottom: index < aiSuggestions.length - 1 ? '1px solid var(--border)' : 'none'
                }}
              >
                🤖 {suggestion}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Advanced Filters */}
      {searchMode === 'advanced' && (
        <div style={{
          background: 'var(--surface)',
          padding: '1.5rem',
          borderRadius: '0.5rem',
          marginBottom: '2rem',
          border: '1px solid var(--border)'
        }}>
          <h3 style={{ marginBottom: '1rem' }}>Advanced Filters</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div>
              <label>Filename contains:</label>
              <input
                type="text"
                value={filters.filename}
                onChange={(e) => setFilters(prev => ({ ...prev, filename: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
              />
            </div>
            <div>
              <label>Content Type:</label>
              <select
                value={filters.contentType}
                onChange={(e) => setFilters(prev => ({ ...prev, contentType: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
              >
                <option value="">All types</option>
                <option value="application/dicom">DICOM</option>
                <option value="image/jpeg">JPEG</option>
                <option value="image/png">PNG</option>
                <option value="application/pdf">PDF</option>
              </select>
            </div>
            <div>
              <label>Min Size (bytes):</label>
              <input
                type="number"
                value={filters.sizeMin || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, sizeMin: Number(e.target.value) }))}
                style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
              />
            </div>
            <div>
              <label>Max Size (bytes):</label>
              <input
                type="number"
                value={filters.sizeMax || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, sizeMax: Number(e.target.value) }))}
                style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
              />
            </div>
            <div>
              <label>From Date:</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
              />
            </div>
            <div>
              <label>To Date:</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
              />
            </div>
          </div>
          <button
            onClick={clearFilters}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              background: 'var(--error)',
              color: 'white',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer'
            }}
          >
            Clear Filters
          </button>
        </div>
      )}

      {/* Facets */}
      {facets.contentTypes.length > 0 && (
        <div style={{ display: 'flex', gap: '2rem', marginBottom: '2rem' }}>
          <div>
            <h4>Content Types</h4>
            {facets.contentTypes.map(facet => (
              <div
                key={facet.name}
                onClick={() => handleFacetClick('contentType', facet.name)}
                style={{
                  padding: '0.25rem 0.5rem',
                  margin: '0.25rem 0',
                  cursor: 'pointer',
                  background: facet.selected ? 'var(--primary)' : 'var(--surface)',
                  color: facet.selected ? 'white' : 'var(--text)',
                  borderRadius: '0.25rem',
                  border: '1px solid var(--border)'
                }}
              >
                {facet.name} ({facet.count})
              </div>
            ))}
          </div>
          <div>
            <h4>Users</h4>
            {facets.users.map(facet => (
              <div
                key={facet.name}
                onClick={() => handleFacetClick('userId', facet.name)}
                style={{
                  padding: '0.25rem 0.5rem',
                  margin: '0.25rem 0',
                  cursor: 'pointer',
                  background: facet.selected ? 'var(--primary)' : 'var(--surface)',
                  color: facet.selected ? 'white' : 'var(--text)',
                  borderRadius: '0.25rem',
                  border: '1px solid var(--border)'
                }}
              >
                {facet.name} ({facet.count})
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      <div>
        <h3>Search Results ({results.length})</h3>
        {results.length === 0 && !loading && (
          <p style={{ color: 'var(--muted)' }}>No files found matching your criteria.</p>
        )}
        <div style={{ display: 'grid', gap: '1rem' }}>
          {results.map(file => (
            <div
              key={file.id}
              style={{
                background: 'var(--surface)',
                padding: '1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>{file.filename}</h4>
                <p style={{ margin: '0', color: 'var(--muted)', fontSize: '0.9rem' }}>
                  Size: {(file.size / 1024 / 1024).toFixed(2)} MB •
                  Type: {file.content_type || 'Unknown'} •
                  Uploaded: {new Date(file.upload_timestamp).toLocaleDateString()} •
                  User: {file.user_id}
                </p>
                {file.description && (
                  <p style={{ margin: '0.5rem 0 0 0', fontStyle: 'italic' }}>
                    {file.description}
                  </p>
                )}
              </div>
              <div>
                <button style={{
                  padding: '0.5rem 1rem',
                  background: 'var(--primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.25rem',
                  cursor: 'pointer',
                  marginRight: '0.5rem'
                }}>
                  📥 Download
                </button>
                <button style={{
                  padding: '0.5rem 1rem',
                  background: 'var(--secondary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.25rem',
                  cursor: 'pointer'
                }}>
                  👁️ Preview
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}