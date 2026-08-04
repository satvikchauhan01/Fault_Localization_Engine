/**
 * @file Types - JSDoc type definitions matching Section F of the Master Architecture Plan.
 */

/**
 * @typedef {Object} Pole
 * @property {string} id - Unique pole identifier
 * @property {number} lat - Latitude
 * @property {number} lon - Longitude
 * @property {string} dt_id - Transformer (DT) identifier
 * @property {string} feeder_id - Feeder identifier
 * @property {number} [seq_on_line] - Sequence number on the physical line
 * @property {string|null} [parent_pole_id] - Parent pole identifier in radial tree
 * @property {string|null} [device_id] - Optional attached IoT device identifier
 * @property {string} [ward] - Municipal ward designation
 * @property {string|null} [pincode] - Postal index number
 */

/**
 * @typedef {Object} Device
 * @property {string} id - Unique device identifier
 * @property {string|null} [pole_id] - Currently assigned pole ID
 * @property {string} fw_version - Firmware version string (e.g., '1.2.1', '1.3.0')
 * @property {string} first_seen - ISO timestamp when device was registered
 * @property {string} last_seen - ISO timestamp of latest telemetry event
 */

/**
 * @typedef {'AUTHORITATIVE' | 'INFERRED'} TopologySource
 */

/**
 * @typedef {Object} Transformer
 * @property {string} id - Unique DT identifier
 * @property {string} feeder_id - Parent feeder identifier
 * @property {number} lat - Latitude
 * @property {number} lon - Longitude
 * @property {number} capacity_kva - Transformer capacity in kVA
 * @property {number} households_served - Number of downstream households
 * @property {TopologySource} topology_source - Whether topology is authoritative or inferred
 */

/**
 * @typedef {Object} Feeder
 * @property {string} id - Unique feeder identifier
 * @property {string} [name] - Display name of the feeder
 */

/**
 * @typedef {'heartbeat' | 'power_lost' | 'power_restored' | 'boot'} TelemetryEventType
 */

/**
 * @typedef {Object} TelemetryEvent
 * @property {string} device_id - Device identifier
 * @property {string} pole_id - Pole identifier
 * @property {TelemetryEventType} event - Type of telemetry event
 * @property {boolean} energized - Energized status reported by device
 * @property {string} device_ts - ISO timestamp recorded at device
 * @property {number} seq - Intra-device sequence number
 * @property {number} [battery_mv] - Battery voltage in millivolts
 * @property {number} [rssi] - Received signal strength indicator
 * @property {string} fw - Firmware version
 * @property {string} server_received_at - Server arrival timestamp
 */

/**
 * @typedef {'power_lost' | 'power_restored' | 'heartbeat_energized' | 'heartbeat_deenergized' | 'timeout_fw13' | 'timeout_fw12' | 'boot' | 'initial'} EvidenceType
 */

/**
 * @typedef {'LIVE' | 'CONFIRMED_DARK' | 'STALE' | 'OFFLINE_UNKNOWN' | 'SENSOR_SUSPECT'} PoleStatus
 */

/**
 * @typedef {Object} PoleState
 * @property {string} pole_id - Target pole identifier
 * @property {PoleStatus} status - Derived operational status
 * @property {string} last_confirmed_at - ISO timestamp of last confirmed state transition
 * @property {number} last_event_seq - Sequence number of last applied telemetry event
 * @property {string} evidence_summary - Human-readable summary of state evidence
 * @property {EvidenceType} evidence_type - Structured field denoting exact reason for state transition
 */

/**
 * @typedef {Object} TopologyEdge
 * @property {string} parent_pole_id - Parent pole or DT identifier
 * @property {string} child_pole_id - Child pole identifier
 * @property {TopologySource} source - AUTHORITATIVE or INFERRED
 * @property {number} [weight] - Distance or edge weight
 * @property {boolean} ambiguous - Whether edge has alternative candidate paths within tolerance
 */

/**
 * @typedef {'DT' | 'FEEDER' | 'SPAN'} ScheduledOutageScope
 */

/**
 * @typedef {Object} ScheduledOutage
 * @property {string} id - Unique outage schedule identifier
 * @property {ScheduledOutageScope} scope - Targeted asset level
 * @property {string} target_id - Target asset ID (DT ID, Feeder ID, or Pole ID)
 * @property {string} start - ISO timestamp of planned start
 * @property {string} end - ISO timestamp of planned end
 * @property {string} reason - Maintenance or operation reason
 * @property {string} fetched_at - ISO timestamp when schedule was retrieved
 */

/**
 * @typedef {'SPAN' | 'DT' | 'FEEDER' | 'RANGE'} IncidentType
 */

/**
 * @typedef {'HIGH' | 'MEDIUM' | 'LOW'} ConfidenceLevel
 */

/**
 * @typedef {Object} IncidentBoundary
 * @property {string|null} upstream_live_pole_id - Nearest monitored live ancestor pole ID
 * @property {string[]} downstream_dark_pole_ids - First level dark descendant pole IDs
 */

/**
 * @typedef {Object} Incident
 * @property {string} id - Unique incident identifier
 * @property {IncidentType} type - Fault classification
 * @property {IncidentBoundary} boundary - Boundary poles isolating the fault
 * @property {string[]} affected_pole_ids - All dark pole IDs in affected subtree
 * @property {number} affected_count - Number of affected poles
 * @property {TopologySource} topology_source - Dominant topology source for affected area
 * @property {ConfidenceLevel} confidence - Categorical confidence score
 * @property {string[]} confidence_reasons - Triggered rule explanations
 * @property {boolean} scheduled_outage_overlap - True if overlap with scheduled maintenance
 * @property {string} first_detected_at - ISO timestamp when incident was first created
 */

/**
 * @typedef {'DETECTED' | 'ACKNOWLEDGED' | 'CREW_ASSIGNED' | 'RESOLVED' | 'VERIFIED' | 'CLOSED'} TicketState
 */

/**
 * @typedef {Object} Ticket
 * @property {string} id - Unique ticket identifier
 * @property {string} incident_id - Associated Incident identifier (1:1)
 * @property {TicketState} state - Workflow state
 * @property {string} created_at - ISO timestamp of ticket creation
 * @property {string} updated_at - ISO timestamp of last state transition
 * @property {string|null} [resolved_at] - ISO timestamp when operator claimed resolved
 * @property {string|null} [verified_at] - ISO timestamp when telemetry verified restoration
 */

/**
 * @typedef {'SPAN' | 'DT' | 'FEEDER'} SimulatorFaultType
 */

/**
 * @typedef {Object} SimulatorFault
 * @property {string} id - Unique fault injection identifier
 * @property {SimulatorFaultType} type - Target level of injected fault
 * @property {string} target - Target ID (pole/dt/feeder)
 * @property {string} injected_at - ISO timestamp when fault was triggered
 * @property {string|null} [repaired_at] - ISO timestamp when fault was repaired
 */

export {};
