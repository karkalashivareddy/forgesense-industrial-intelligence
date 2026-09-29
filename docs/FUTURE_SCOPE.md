# Future Scope

Extension points, not fake features. Nothing on this page is implemented, and
nothing in the current UI implies it is.

Organised by **implemented / partially implemented / planned**, so a reviewer
can see exactly where the boundary is.

---

## Status summary

### Implemented
- Real-time STOMP transport with validation, dedup, ordering, coalescing and reconciliation
- Three.js digital twin with status / risk / dependency encoding
- Asset health, anomaly and failure-risk presentation with explicit data basis
- Alert lifecycle (NEW → ACKNOWLEDGED → INVESTIGATING → RESOLVED) with RBAC
- Maintenance workflow (RECOMMENDED → SCHEDULED → ACTIVE → COMPLETED / CANCELLED)
- What-if scenario simulation with dependency-graph impact
- Operational event timeline
- Platform observability surface
- Accessible, responsive operations shell

### Partially implemented
| Capability | Present | Missing |
| --- | --- | --- |
| Asset hierarchy | Zones and production lines | Full ISA-95 hierarchy, multi-factory, multi-site |
| Time series | Current + recent window per asset | Long-range history, downsampled rollups, gap filling |
| Telemetry | Simulator → Kafka/HTTP ingest | OPC UA, MQTT, Modbus, historian import |
| ML lifecycle | Versioned artefacts, provenance metadata | Registry, drift detection, scheduled retraining, A/B rollout |
| Impact analysis | Dependency-graph propagation with stated assumptions | Calibration against realised outcomes |
| Alerting | In-app alert centre with lifecycle | External routing (email, PagerDuty, Teams), on-call escalation |
| Security | JWT, RBAC, CSP, scoped session | OIDC/SAML, mTLS, audit log, fine-grained permissions |
| Digital twin | Representative geometry, 6 zones, 18 assets | Surveyed GLTF plant models, equipment sub-models |
| Analytics | Distribution, ranking, scatter, counts | Forecasting, cohort comparison, custom dashboards |

### Planned (not built)
- OPC UA and MQTT ingestion
- Unified Namespace / MQTT Sparkplug address space
- ISA-95 asset hierarchy with equipment → unit → area → line → site
- Multi-site and multi-factory rollups
- Tenant isolation
- Edge deployment with local buffering and store-and-forward
- Offline-first operator workflows
- Time-series database (TimescaleDB / InfluxDB) with continuous aggregates
- WebGPU rendering and GLTF industrial asset streaming
- Digital work instructions
- Computer-vision-based condition monitoring
- CMMS / EAM integration (SAP PM, IBM Maximo, Fiix)
- ERP integration (SAP, Oracle)
- Cloud IoT ingestion (Azure IoT, AWS IoT)
- Model registry with drift monitoring and model monitoring dashboards
- Human feedback loop (operator confirmation feeding label generation)
- Role-based workspaces and saved views
- Shift handover and annotation

---

## Where the seams already are

The current architecture was designed so these extensions land without a
rewrite.

| Extension | Seam |
| --- | --- |
| New ingest protocol | `TelemetrySample` is the contract; the validator, normalizer and pipeline are transport-agnostic. Add a broker client, keep the sample. |
| New topics | Add to `LIVE_TOPICS` in `types.ts` and handle in `applyEvents`. Validation and batching are generic. |
| New backend field | Add to `types.ts` and normalise it in `adapters.ts`. Everything downstream is typed. |
| New sensor | Add to `SensorType.java` and `SENSOR_UNITS`. The telemetry view derives its sensor list from data, so it appears automatically. |
| New chart | ECharts is tree-shaken per chart type — add the import and one option object. |
| New workspace | Add a route, a nav entry and a lazily-loaded component. The shell, auth and data layers need no change. |
| Different state library | Realtime state is isolated in `realtime/store.ts`; server state in TanStack Query. Neither is entangled with the view layer. |
| Real RUL in hours | The formatter is one function, and a unit test currently *forbids* a time unit. Changing the contract is a deliberate, visible edit. |
| Real data basis | `resolveBasis()` maps backend strings to the vocabulary. A real deployment changes the strings, not the UI. |

---

## Honest sequencing

If this were to become a production product, the order matters more than the
feature list:

1. **Real ingest and identity.** OPC UA/MQTT ingestion and an identity provider.
   Everything else is a demo until data is real and access is governed.
2. **Time-series storage.** The current retention is a container volume.
3. **Model lifecycle.** Registry, drift monitoring, retraining gates — plus
   calibration, so a risk number carries an uncertainty.
4. **Alerting integration.** An alert centre nobody is paged from is not
   operations.
5. **Calibrated impact.** Compare modelled downtime against realised downtime
   before anyone plans production around these numbers.
6. **Only then** the larger surface: multi-site, digital work instructions,
   computer vision.
