# High Availability Architecture

## Overview
This system implements a fully redundant, highly available architecture with automatic failover for both storage and database layers.

## Storage Layer (MinIO Cluster)
- **3 MinIO nodes** (minio1, minio2, minio3) providing distributed object storage
- **Replication strategy**: All files are replicated across all 3 nodes
- **Fault tolerance**: System continues operating with 2/3 nodes available
- **Health monitoring**: Real-time health checks every 30 seconds
- **Automatic failover**: Downloads automatically route to healthy nodes

### MinIO Node Status
- **minio1**: Port 9000, Console 9001
- **minio2**: Port 9010, Console 9002  
- **minio3**: Port 9020, Console 9003

## Database Layer (PostgreSQL Cluster)

### Current Setup (Manual Failover)
- **Primary**: postgres-primary (port 5432)
- **Replica 1**: postgres-replica1 (port 5433)
- **Replica 2**: postgres-replica2 (port 5434)
- **Replication**: Streaming replication with WAL archiving

### Recommended: etcd + Patroni (Automatic Failover)

For production, implement etcd-based automatic failover:

#### etcd Cluster
```yaml
services:
  etcd1:
    image: quay.io/coreos/etcd:v3.5.11
    container_name: etcd1
    environment:
      ETCD_NAME: etcd1
      ETCD_INITIAL_CLUSTER: etcd1=http://etcd1:2380,etcd2=http://etcd2:2380,etcd3=http://etcd3:2380
      ETCD_INITIAL_CLUSTER_STATE: new
      ETCD_INITIAL_CLUSTER_TOKEN: etcd-cluster
      ETCD_LISTEN_CLIENT_URLS: http://0.0.0.0:2379
      ETCD_ADVERTISE_CLIENT_URLS: http://etcd1:2379
      ETCD_LISTEN_PEER_URLS: http://0.0.0.0:2380
      ETCD_INITIAL_ADVERTISE_PEER_URLS: http://etcd1:2380
    ports:
      - "2379:2379"
      - "2380:2380"
    networks:
      - dfs-network
```

#### Patroni Configuration
Patroni manages PostgreSQL clustering with automatic leader election via etcd:

```yaml
scope: postgres-cluster
namespace: /db/
name: postgres-primary

restapi:
  listen: 0.0.0.0:8008
  connect_address: postgres-primary:8008

etcd3:
  hosts: etcd1:2379,etcd2:2379,etcd3:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576
    postgresql:
      use_pg_rewind: true
      parameters:
        wal_level: replica
        hot_standby: "on"
        max_wal_senders: 10
        max_replication_slots: 10

postgresql:
  listen: 0.0.0.0:5432
  connect_address: postgres-primary:5432
  data_dir: /var/lib/postgresql/data
  authentication:
    replication:
      username: replicator
      password: replicator_password
    superuser:
      username: postgres
      password: postgres_password
```

## Benefits of etcd + Patroni

### Automatic Failover
- **Leader election**: etcd coordinates which PostgreSQL node is primary
- **Failover time**: < 30 seconds typical
- **Zero configuration**: No manual intervention required
- **Consensus-based**: Prevents split-brain scenarios

### Health Monitoring
- Continuous health checks every 10 seconds
- Automatic removal of failed nodes from cluster
- Automatic promotion of standby to primary
- Graceful failover with minimal data loss

### Application Benefits
- **Connection management**: FastAPI connects via etcd service discovery
- **Read scaling**: Route reads to any replica
- **Write routing**: Always routes to current primary
- **Transparent failover**: Application doesn't need to handle failover logic

## Current Dashboard Features

The Dashboard at `http://localhost:8000` displays:

1. **Storage Nodes Status**
   - Real-time health indicators (green/red)
   - Files count per node
   - Storage usage per node
   - Last health check timestamp

2. **System Statistics**
   - Total files across cluster
   - Total storage usage
   - Patient count (for doctors/admins)
   - Upload success rate

3. **Pending Access Requests**
   - Consent requests awaiting approval
   - Requester information
   - Request reason and timestamp

## Testing Fault Tolerance

### MinIO Node Failure
```bash
# Simulate node failure
docker stop minio2

# Verify continued operation
curl http://localhost:8000/api/files

# Check dashboard shows node as offline
# Downloads automatically route to minio1 or minio3

# Restore node
docker start minio2
```

### PostgreSQL Failover (Manual)
```bash
# Stop primary
docker stop postgres-primary

# Promote replica1 to primary
docker exec -it postgres-replica1 pg_ctl promote

# Update DATABASE_URL to point to replica1:5433
```

### PostgreSQL Failover (with Patroni - Automatic)
```bash
# Stop primary
docker stop postgres-primary

# Patroni automatically:
# 1. Detects primary failure (within 10s)
# 2. Elects new leader via etcd consensus
# 3. Promotes standby to primary
# 4. Updates etcd with new primary endpoint
# 5. FastAPI automatically connects to new primary

# No manual intervention required!
```

## Monitoring & Alerting

### Prometheus Metrics
- `minio_node_health{node="minio1"}` - MinIO health status
- `postgres_up{role="primary"}` - PostgreSQL primary status
- `etcd_server_has_leader` - etcd cluster has leader
- `patroni_postgres_running` - Patroni managed instance status

### Grafana Dashboards
Access at `http://localhost:3001` (credentials: admin/admin123)
- MinIO Cluster Overview
- PostgreSQL Replication Status
- etcd Cluster Health (if configured)
- System Resource Usage

## Implementation Checklist

Current Setup (✅ Completed):
- [x] 3-node MinIO cluster with replication
- [x] PostgreSQL primary + 2 replicas
- [x] Dashboard showing storage node health
- [x] Real-time health monitoring
- [x] Automatic download failover

Recommended Additions:
- [ ] etcd 3-node cluster for consensus
- [ ] Patroni on all PostgreSQL nodes
- [ ] HAProxy for database load balancing
- [ ] Automated backup with pgBackRest
- [ ] PgBouncer for connection pooling

## Next Steps

1. **Review current HA features** on Dashboard
2. **Test MinIO failover** - stop a node and verify operations continue
3. **Plan etcd integration** - for automatic PostgreSQL failover
4. **Configure monitoring** - set up alerts for node failures
5. **Document runbooks** - procedures for common failure scenarios

## References
- [Patroni Documentation](https://patroni.readthedocs.io/)
- [etcd Operations Guide](https://etcd.io/docs/latest/op-guide/)
- [MinIO Multi-Node Setup](https://min.io/docs/minio/linux/operations/install-deploy-manage/deploy-minio-multi-node-multi-drive.html)
