import { useState, useEffect } from 'react'
import { getAccessSummary, getComplianceReport, AccessSummaryReport, ComplianceSummary } from '../api/client'

export function SettingsAccessControl() {
    const [compliance, setCompliance] = useState<ComplianceSummary | null>(null)
    const [accessSummary, setAccessSummary] = useState<AccessSummaryReport | null>(null)
    const [loading, setLoading] = useState(true)
    const [days, setDays] = useState(30)

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true)
            try {
                const [complianceData, accessData] = await Promise.all([
                    getComplianceReport(days),
                    getAccessSummary(days)
                ])
                setCompliance(complianceData)
                setAccessSummary(accessData)
            } catch (error) {
                console.error('Failed to fetch access data:', error)
            } finally {
                setLoading(false)
            }
        }
        fetchData()
    }, [days])

    const getScoreColor = (score: number) => {
        if (score >= 90) return '#28a745'
        if (score >= 70) return '#ffc107'
        return '#dc3545'
    }

    if (loading) {
        return (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
                <div style={{ fontSize: '2rem' }}>⏳</div>
                <p>Loading access control summary...</p>
            </div>
        )
    }

    return (
        <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            <h1>🔐 Access Control Summary</h1>

            {/* Period Selector */}
            <div style={{ marginBottom: '2rem' }}>
                <label style={{ marginRight: '1rem' }}>Report Period:</label>
                <select
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    style={{
                        padding: '0.5rem',
                        border: '1px solid var(--border)',
                        borderRadius: '0.25rem'
                    }}
                >
                    <option value={7}>Last 7 days</option>
                    <option value={30}>Last 30 days</option>
                    <option value={90}>Last 90 days</option>
                    <option value={365}>Last year</option>
                </select>
            </div>

            {compliance && (
                <>
                    {/* Compliance Score Card */}
                    <div style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '0.5rem',
                        padding: '2rem',
                        marginBottom: '2rem',
                        textAlign: 'center'
                    }}>
                        <h2>Compliance Score</h2>
                        <div style={{
                            fontSize: '4rem',
                            fontWeight: 'bold',
                            color: getScoreColor(compliance.compliance_score)
                        }}>
                            {compliance.compliance_score}%
                        </div>
                        <p style={{ color: 'var(--muted)' }}>
                            Based on {compliance.total_audit_events} events from {new Date(compliance.period_start).toLocaleDateString()} to {new Date(compliance.period_end).toLocaleDateString()}
                        </p>
                    </div>

                    {/* Stats Grid */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '1rem',
                        marginBottom: '2rem'
                    }}>
                        <StatCard title="Total Files" value={compliance.total_files} icon="📁" />
                        <StatCard title="Total Users" value={compliance.total_users} icon="👥" />
                        <StatCard title="Active Consents" value={compliance.active_consents} icon="✅" color="#28a745" />
                        <StatCard title="Expired Consents" value={compliance.expired_consents} icon="⏰" color="#ffc107" />
                        <StatCard title="Revoked Consents" value={compliance.revoked_consents} icon="🚫" color="#dc3545" />
                        <StatCard title="Failed Attempts" value={compliance.failed_access_attempts} icon="❌" color="#dc3545" />
                        <StatCard title="High Severity Events" value={compliance.high_severity_events} icon="⚠️" color="#fd7e14" />
                    </div>
                </>
            )}

            {accessSummary && (
                <>
                    {/* Access by Role */}
                    <div style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '0.5rem',
                        padding: '1.5rem',
                        marginBottom: '2rem'
                    }}>
                        <h3>📊 Access by Role</h3>
                        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                            {Object.entries(accessSummary.by_role).map(([role, count]) => (
                                <div key={role} style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{count}</div>
                                    <div style={{ color: 'var(--muted)', textTransform: 'capitalize' }}>{role}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* User Activity Table */}
                    <div style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '0.5rem',
                        padding: '1.5rem'
                    }}>
                        <h3>👤 User Activity</h3>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                                    <th style={{ textAlign: 'left', padding: '0.75rem' }}>User</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem' }}>Role</th>
                                    <th style={{ textAlign: 'center', padding: '0.75rem' }}>Uploads</th>
                                    <th style={{ textAlign: 'center', padding: '0.75rem' }}>Downloads</th>
                                    <th style={{ textAlign: 'center', padding: '0.75rem' }}>Deletes</th>
                                    <th style={{ textAlign: 'center', padding: '0.75rem' }}>Consents</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem' }}>Last Activity</th>
                                </tr>
                            </thead>
                            <tbody>
                                {accessSummary.by_user.map((user, idx) => (
                                    <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '0.75rem' }}>{user.user_email || `User #${user.user_id}`}</td>
                                        <td style={{ padding: '0.75rem', textTransform: 'capitalize' }}>{user.role}</td>
                                        <td style={{ textAlign: 'center', padding: '0.75rem' }}>{user.files_uploaded}</td>
                                        <td style={{ textAlign: 'center', padding: '0.75rem' }}>{user.files_downloaded}</td>
                                        <td style={{ textAlign: 'center', padding: '0.75rem' }}>{user.files_deleted}</td>
                                        <td style={{ textAlign: 'center', padding: '0.75rem' }}>{user.consents_granted}</td>
                                        <td style={{ padding: '0.75rem' }}>
                                            {user.last_activity ? new Date(user.last_activity).toLocaleString() : '-'}
                                        </td>
                                    </tr>
                                ))}
                                {accessSummary.by_user.length === 0 && (
                                    <tr>
                                        <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                                            No activity in this period
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    )
}

function StatCard({ title, value, icon, color }: { title: string; value: number; icon: string; color?: string }) {
    return (
        <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            padding: '1rem',
            textAlign: 'center'
        }}>
            <div style={{ fontSize: '1.5rem' }}>{icon}</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: color || 'var(--text)' }}>{value}</div>
            <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{title}</div>
        </div>
    )
}
