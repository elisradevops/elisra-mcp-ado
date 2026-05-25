/**
 * Mock work-item fixtures for the cross-scope traceability simulation.
 *
 * Domain: airborne / ground SIGINT system (publicly-known, unclassified engineering language).
 *
 * IDs:
 *   Customer Requirements: 1000–1099  (operational / mission-level needs)
 *   System Requirements:   2000–2099  (technical system requirements)
 *
 * System Requirement link classes (seeded for branch coverage):
 *   IDs 2000–2059  → COVERED: Elisra.CoveredBy-Forward link → customer ID in 1000–1099
 *   IDs 2060–2079  → UNCOVERED_WRONG_SCOPE: CoveredBy link → third-area ID 3000–3019
 *   IDs 2080–2099  → UNCOVERED_NO_LINK: relations: []
 *
 * Catalogue wrap note:
 *   Each catalogue has 50 entries. Expanding to 100 items via (i % 50) means IDs 2050–2099
 *   reuse titles from IDs 2000–2049. Titles are non-unique by design — the simulation
 *   tests traceability join correctness, not title uniqueness.
 */

import type { AdoWorkItem } from '../../../src/types/ado.js';

export const CUSTOMER_AREA_PATH = 'SomeProject\\Customer Requirement';
export const SYSTEM_AREA_PATH = 'SomeProject\\System Requirement';
export const THIRD_AREA_PATH = 'SomeProject\\Other';

export const ADO_BASE_URL = 'https://tfs.example.com/tfs/DefaultCollection/_apis/wit/workItems';

export const CUSTOMER_IDS = Array.from({ length: 100 }, (_, i) => 1000 + i);
export const SYSTEM_IDS = Array.from({ length: 100 }, (_, i) => 2000 + i);

// Seeded classification counts:
export const COVERED_COUNT = 60;               // IDs 2000–2059
export const UNCOVERED_WRONG_SCOPE_COUNT = 20; // IDs 2060–2079
export const UNCOVERED_NO_LINK_COUNT = 20;     // IDs 2080–2099

// ─── Customer (operational / mission) requirement catalogue ───────────────────
// Reflects what an operator / mission commander needs — not how the system works.

const CUSTOMER_REQ_CATALOGUE: ReadonlyArray<{
  title: string;
  type: 'Epic' | 'Feature' | 'Requirement';
  description: string;
  ac: string;
}> = [
  // ── Coverage & Intercept ───────────────────────────────────────────────────
  { type: 'Epic',        title: 'Wide-Band RF Coverage',
    description: '<p>The system shall provide continuous intercept coverage across the operational frequency range to ensure no signals of interest are missed during a mission.</p>',
    ac: '<p>Demonstrated by executing a frequency sweep across the full operational band with ≥ 98% probability of intercept (POI) for signals of ≥ 1 ms duration at the stated sensitivity threshold.</p>' },
  { type: 'Feature',     title: 'HF Band Intercept Capability',
    description: '<p>The system shall intercept HF communications in the range 2–30 MHz to support monitoring of long-range radio networks.</p>',
    ac: '<p>Verified by test signals injected at 2, 15, and 30 MHz at -100 dBm; system shall detect and classify each within 2 s of appearance.</p>' },
  { type: 'Requirement', title: 'VHF/UHF Tactical Communications Intercept',
    description: '<p>The system shall intercept tactical VHF/UHF voice and data communications in the range 30–512 MHz used by ground forces.</p>',
    ac: '<p>Verified by live-signal injection at 50, 150, 300, and 500 MHz; system classifies as voice or data with ≥ 90% accuracy.</p>' },
  { type: 'Requirement', title: 'Microwave and SHF Band Coverage',
    description: '<p>The system shall cover the microwave and SHF range 500 MHz–18 GHz to intercept radar, data-link, and satellite communication signals.</p>',
    ac: '<p>Coverage verified by swept-tone injection across the band. Sensitivity ≤ -90 dBm across the full range.</p>' },
  { type: 'Feature',     title: 'Simultaneous Multi-Band Operation',
    description: '<p>The operator shall be able to monitor multiple frequency bands simultaneously without hardware reconfiguration.</p>',
    ac: '<p>Demonstrated by simultaneous intercept of three independent test signals in HF, VHF, and SHF bands with no cross-band interference degradation.</p>' },

  // ── Emitter Identification ─────────────────────────────────────────────────
  { type: 'Epic',        title: 'Emitter Identification and Classification',
    description: '<p>The system shall automatically identify and classify intercepted emitters by type (communication, radar, navigation, data-link) to support intelligence production.</p>',
    ac: '<p>Classification accuracy ≥ 85% verified against a test library of ≥ 200 known emitter types under SNR ≥ 10 dB conditions.</p>' },
  { type: 'Feature',     title: 'Radar Emitter Type Recognition',
    description: '<p>The system shall identify pulsed radar emitters by their pulse descriptor word (PDW): frequency, PRI, pulse width, scan type, and modulation.</p>',
    ac: '<p>PDW extraction verified for ≥ 95% of radar pulses at SNR ≥ 6 dB; emitter type assigned with ≥ 80% accuracy against reference library.</p>' },
  { type: 'Requirement', title: 'Communication Signal Modulation Classification',
    description: '<p>The system shall classify AM, FM, SSB, CW, FSK, and PSK modulations automatically using signal-processing algorithms.</p>',
    ac: '<p>Classification accuracy ≥ 88% for each modulation type at SNR ≥ 8 dB, verified using calibrated test signals.</p>' },
  { type: 'Requirement', title: 'Specific Emitter Identification (SEI)',
    description: '<p>The system shall perform specific emitter identification to distinguish individual transmitters of the same type using RF fingerprinting techniques.</p>',
    ac: '<p>SEI demonstrated with ≥ 70% correct identification of individual transmitters within a set of 10 nominally identical emitters at SNR ≥ 12 dB.</p>' },
  { type: 'Feature',     title: 'ELINT Emitter Library Management',
    description: '<p>The operator shall be able to load, update, and query an emitter parameter library containing known radar and communication emitter profiles.</p>',
    ac: '<p>Library supports ≥ 10,000 emitter records; load, update, and query operations each complete within 3 s.</p>' },

  // ── Direction Finding (DF) ─────────────────────────────────────────────────
  { type: 'Epic',        title: 'Emitter Geo-Location and Direction Finding',
    description: '<p>The system shall determine the bearing and, where applicable, the geo-location of intercepted emitters to support targeting and situational awareness.</p>',
    ac: '<p>DF accuracy ≤ 3° RMS for signals at SNR ≥ 10 dB; geo-location CEP ≤ 1 km for emitters within 50 km range using multi-platform TDOA.</p>' },
  { type: 'Feature',     title: 'Single-Platform DF Bearing Measurement',
    description: '<p>The system shall derive an emitter bearing from a single platform using a direction-finding antenna array.</p>',
    ac: '<p>Bearing error ≤ 2° RMS at SNR ≥ 10 dB verified across 360° azimuth coverage in an anechoic chamber.</p>' },
  { type: 'Requirement', title: 'Multi-Platform TDOA Geo-Location',
    description: '<p>The system shall correlate time-difference-of-arrival (TDOA) measurements from two or more platforms to compute emitter geo-location.</p>',
    ac: '<p>CEP ≤ 500 m for emitters at 30 km range, two platforms separated by 20 km, GNSS timing accuracy ≤ 10 ns RMS.</p>' },
  { type: 'Requirement', title: 'Doppler-Assisted Bearing Refinement',
    description: '<p>The system shall use Doppler shift measurements on moving-platform sensors to improve bearing estimate accuracy.</p>',
    ac: '<p>Bearing RMS error improves by ≥ 30% compared to single-snapshot DF when platform velocity ≥ 50 m/s and signal duration ≥ 5 s.</p>' },
  { type: 'Feature',     title: 'DF Coverage — Full Azimuth',
    description: '<p>The airborne DF subsystem shall provide 360° azimuth coverage without mechanical rotation or manual antenna switching.</p>',
    ac: '<p>360° azimuth coverage verified by rotating calibration signal source; bearing error ≤ 3° RMS at all azimuths.</p>' },

  // ── Signal Processing & Latency ────────────────────────────────────────────
  { type: 'Epic',        title: 'Real-Time Signal Processing',
    description: '<p>The system shall process intercepted signals in real time to extract intelligence parameters with latency low enough to support time-sensitive operations.</p>',
    ac: '<p>End-to-end latency from signal intercept to parameter display ≤ 1 s for signals of duration ≥ 10 ms.</p>' },
  { type: 'Feature',     title: 'Fast Fourier Transform Spectrum Analysis',
    description: '<p>The system shall perform continuous FFT-based spectrum analysis with frequency resolution ≤ 1 kHz and update rate ≥ 10 frames/s across the monitored band.</p>',
    ac: '<p>Frequency resolution and update rate verified by injecting two CW tones 1 kHz apart; both resolved and displayed within 100 ms.</p>' },
  { type: 'Requirement', title: 'Pulse Analysis Throughput',
    description: '<p>The pulse processing subsystem shall handle an arrival rate of ≥ 1,000,000 pulses per second (MPPS) without PDW loss in a dense signal environment.</p>',
    ac: '<p>Pulse loss rate ≤ 0.1% at 1 MPPS input, verified by calibrated pulse generator; PDW accuracy maintained across the full load.</p>' },
  { type: 'Requirement', title: 'Signal Detection Latency',
    description: '<p>The system shall detect the presence of a new signal within ≤ 50 ms of its first appearance within the monitored band.</p>',
    ac: '<p>Detection latency measured from signal-on event to operator alert; ≥ 95% of trials within 50 ms at SNR ≥ 6 dB.</p>' },
  { type: 'Feature',     title: 'Narrowband Channel Extraction',
    description: '<p>The system shall extract up to 32 simultaneous narrowband channels (≤ 25 kHz each) from the wideband digitised spectrum for demodulation.</p>',
    ac: '<p>32 simultaneous channels verified; no channel cross-contamination above -60 dBc; demodulated audio SNR ≥ 30 dB.</p>' },

  // ── Sensitivity & Dynamic Range ────────────────────────────────────────────
  { type: 'Epic',        title: 'Receiver Sensitivity and Dynamic Range',
    description: '<p>The system receiver shall provide sufficient sensitivity to detect weak signals of interest and sufficient dynamic range to operate in high-density RF environments without saturation.</p>',
    ac: '<p>MDS ≤ -110 dBm and spurious-free dynamic range ≥ 80 dB verified across the operational band.</p>' },
  { type: 'Feature',     title: 'Minimum Detectable Signal Level',
    description: '<p>The system shall achieve a minimum detectable signal (MDS) of ≤ -110 dBm across the HF–SHF operational band (2 MHz–18 GHz) for CW signals.</p>',
    ac: '<p>MDS measured per ITU-R method at 10 frequency points spanning the operational band; ≤ -110 dBm at all points.</p>' },
  { type: 'Requirement', title: 'Receiver Spurious-Free Dynamic Range',
    description: '<p>The receiver shall maintain a spurious-free dynamic range (SFDR) of ≥ 80 dB across the operational band to prevent intermodulation products from masking signals of interest.</p>',
    ac: '<p>SFDR measured with two-tone IMD3 test; ≥ 80 dB verified at all sub-bands using calibrated signal sources.</p>' },
  { type: 'Requirement', title: 'Anti-Saturation and Automatic Gain Control',
    description: '<p>The system shall employ automatic gain control (AGC) to prevent saturation by strong in-band signals while maintaining sensitivity to co-channel weak signals.</p>',
    ac: '<p>AGC response time ≤ 1 ms; system recovers from 30 dB input step within 5 ms with ≤ 1 dB residual gain error.</p>' },
  { type: 'Feature',     title: 'Noise Figure Across Operational Band',
    description: '<p>The receiver noise figure shall not exceed 10 dB across the HF–UHF range (2–512 MHz) and 12 dB across the SHF range (512 MHz–18 GHz).</p>',
    ac: '<p>Noise figure measured with Y-factor method at 20 frequency points; values within specified limits at all points.</p>' },

  // ── COMINT / ELINT Specialisation ─────────────────────────────────────────
  { type: 'Epic',        title: 'COMINT Collection and Demodulation',
    description: '<p>The system shall collect, demodulate, and record communications signals in AM, FM, SSB, and digital modes to produce COMINT product.</p>',
    ac: '<p>Audio quality MOS ≥ 3.5 for voice demodulation; bit-error rate ≤ 1 × 10⁻⁴ for digital mode demodulation at SNR ≥ 10 dB.</p>' },
  { type: 'Feature',     title: 'Voice Activity Detection and Recording',
    description: '<p>The system shall detect voice activity on intercepted channels and record only active speech segments to conserve storage and focus analyst review.</p>',
    ac: '<p>VAD false-alarm rate ≤ 2%; missed-detection rate ≤ 1% verified with a 60-minute test recording containing known active segments.</p>' },
  { type: 'Requirement', title: 'Digital Protocol Identification',
    description: '<p>The system shall identify common digital communication protocols (GSM, TETRA, DMR, P25) in the intercepted spectrum and tag captures accordingly.</p>',
    ac: '<p>Protocol identification accuracy ≥ 90% for each listed protocol at SNR ≥ 8 dB; verified with calibrated baseband test vectors.</p>' },
  { type: 'Requirement', title: 'ELINT Pulse Descriptor Word Extraction',
    description: '<p>The system shall extract and record the full PDW (RF, time-of-arrival, pulse width, PRI, amplitude) for each intercepted radar pulse.</p>',
    ac: '<p>PDW completeness ≥ 99% at input rates up to 500,000 pulses/s; parameter accuracy within ±1% of injected values.</p>' },
  { type: 'Feature',     title: 'Frequency Hopping Signal Tracking',
    description: '<p>The system shall track frequency-hopping spread-spectrum (FHSS) signals with hop rates up to 1,000 hops/s and capture each hop for analysis.</p>',
    ac: '<p>Hop capture rate ≥ 95% for FHSS signals with hop rate ≤ 1,000 hops/s and hop-dwell duration ≥ 0.5 ms.</p>' },

  // ── Data Management & Recording ────────────────────────────────────────────
  { type: 'Epic',        title: 'Mission Data Recording and Replay',
    description: '<p>The system shall record all intercepted RF data and associated metadata during a mission and provide post-mission replay for analysis.</p>',
    ac: '<p>Continuous recording at full intercept bandwidth for ≥ 8 hours; replay at 1×, 2×, and 0.5× speed with ≤ 1 s seek time to any recorded position.</p>' },
  { type: 'Feature',     title: 'Wideband IQ Recording',
    description: '<p>The system shall record wideband IQ data at a sample rate corresponding to the full instantaneous bandwidth with ≥ 12-bit resolution.</p>',
    ac: '<p>IQ recording verified at full bandwidth; ENOB ≥ 10 bits across operational band; no sample loss during 30-minute stress test.</p>' },
  { type: 'Requirement', title: 'Signal-of-Interest Selective Recording',
    description: '<p>The system shall selectively record only signals matching operator-defined criteria (frequency, modulation, emitter ID) to reduce data volume.</p>',
    ac: '<p>Selective recording reduces data volume by ≥ 70% in a simulated dense-environment test containing 20% signals of interest.</p>' },
  { type: 'Requirement', title: 'Metadata Tagging and Search',
    description: '<p>All recorded intercepts shall be tagged with frequency, time, bearing, modulation type, and emitter ID to enable fast post-mission search.</p>',
    ac: '<p>Search over a 8-hour mission database returns results within ≤ 2 s for any single-field query; compound queries within ≤ 5 s.</p>' },
  { type: 'Feature',     title: 'Secure Data Erasure',
    description: '<p>The system shall provide a rapid, cryptographically secure erase function to destroy all stored mission data within 10 s of operator initiation.</p>',
    ac: '<p>Erasure of full storage volume completed within 10 s; subsequent forensic read of erased media returns no recoverable data per NIST SP 800-88.</p>' },

  // ── Man–Machine Interface & Operator Tools ─────────────────────────────────
  { type: 'Epic',        title: 'Operator Workstation and HMI',
    description: '<p>The system shall provide an operator workstation with an intuitive HMI enabling a single trained operator to manage collection, monitoring, and reporting tasks simultaneously.</p>',
    ac: '<p>Operational effectiveness demonstrated in a 30-minute usability trial with trained operators; task-completion rate ≥ 95%, critical-error rate ≤ 1%.</p>' },
  { type: 'Feature',     title: 'Spectrum Display and Waterfall',
    description: '<p>The HMI shall display a real-time spectrum display and waterfall for the monitored band with user-selectable frequency span, resolution, and scroll speed.</p>',
    ac: '<p>Waterfall update rate ≥ 10 frames/s; frequency accuracy of cursor readout ≤ ±1 kHz; display latency ≤ 200 ms from ADC to screen.</p>' },
  { type: 'Requirement', title: 'Emitter Track Management',
    description: '<p>The operator shall be able to create, edit, annotate, and export emitter tracks from the HMI without interrupting ongoing collection.</p>',
    ac: '<p>Track creation and export to standard formats (CSV, KML) completed within 5 s; no collection gaps during track management operations.</p>' },
  { type: 'Requirement', title: 'Alert and Priority Queuing',
    description: '<p>The system shall automatically raise an alert and place a detected signal of interest in a priority queue for operator review within 1 s of detection.</p>',
    ac: '<p>Alert latency ≤ 1 s in ≥ 98% of trials; priority queue correctly orders simultaneous alerts by threat level.</p>' },
  { type: 'Feature',     title: 'Geo-Plot Integration with Moving Map',
    description: '<p>The HMI shall overlay emitter bearing lines and geo-location fixes on a moving map display updated with own-platform position from the navigation system.</p>',
    ac: '<p>Map overlay position error ≤ 50 m compared to GNSS reference; bearing-line update rate ≥ 1 Hz; own-platform position lag ≤ 500 ms.</p>' },

  // ── Survivability & EMCON ─────────────────────────────────────────────────
  { type: 'Epic',        title: 'Passive Operation and Low Probability of Detection',
    description: '<p>The system shall operate passively (receive-only) during intelligence collection to ensure the platform does not radiate RF energy that could reveal its presence.</p>',
    ac: '<p>RF emissions from the SIGINT sensor subsystem ≤ -60 dBm at the antenna port during normal collection verified by calibrated spectrum analyser.</p>' },
  { type: 'Feature',     title: 'EMCON Compliance Mode',
    description: '<p>The system shall enter an EMCON-compliant mode on operator command that disables all non-essential RF and electrical emissions within 5 s.</p>',
    ac: '<p>EMCON mode activated within 5 s of command; all monitored RF output ports read ≤ -70 dBm; no degradation to passive collection capability.</p>' },
  { type: 'Requirement', title: 'Shielding Against Conducted Emissions',
    description: '<p>The system electronics shall meet MIL-STD-461 CE102 limits for conducted emissions on power lines to prevent detection via supply infrastructure.</p>',
    ac: '<p>Conducted emissions test per MIL-STD-461 CE102; all power-line measurements ≤ limits at all tested frequencies.</p>' },

  // ── System Integration & Interoperability ─────────────────────────────────
  { type: 'Epic',        title: 'C4ISR Integration and Data Dissemination',
    description: '<p>The system shall disseminate SIGINT product to the battalion-level C4ISR network in near real time to support common operating picture (COP) updates.</p>',
    ac: '<p>SIGINT reports transmitted to C4ISR within 10 s of intelligence production; compatible with NATO STANAG 4559 Level 3 image/data standard.</p>' },
  { type: 'Feature',     title: 'STANAG 4607 GMTI Output',
    description: '<p>The system shall output ground moving target indication (GMTI) reports in STANAG 4607 format for integration with joint intelligence networks.</p>',
    ac: '<p>STANAG 4607 output verified by conformance-test tool; all mandatory fields populated; ingested without error by a reference STANAG 4607 consumer.</p>' },
  { type: 'Requirement', title: 'GPS/GNSS Time Synchronisation',
    description: '<p>The system shall synchronise its internal time reference to GPS/GNSS with accuracy ≤ 100 ns RMS to support multi-platform TDOA geo-location.</p>',
    ac: '<p>Time synchronisation error ≤ 100 ns RMS measured against GPS reference over a 1-hour observation period.</p>' },
  { type: 'Requirement', title: 'MIL-STD-1553B Databus Interface',
    description: '<p>The system shall provide a MIL-STD-1553B interface for integration with the host platform avionics and mission management system.</p>',
    ac: '<p>1553B interface verified by conformance test; bus controller and remote terminal modes validated; no transmission errors in a 1000-message stress test.</p>' },
  { type: 'Feature',     title: 'Crypto-Ready Architecture',
    description: '<p>The system architecture shall accommodate NSA-approved Type 1 encryption modules for mission data and voice communication links without hardware redesign.</p>',
    ac: '<p>Encryption module slots meet USEKP form-factor standard; KIV-7 module installed and passes BIT; encrypted data link operates at full system bandwidth.</p>' },

  // ── Environmental & Reliability ────────────────────────────────────────────
  { type: 'Epic',        title: 'Environmental Qualification and Reliability',
    description: '<p>The system shall operate reliably across the full military environmental envelope and achieve the required availability for mission-critical operations.</p>',
    ac: '<p>Full environmental qualification per MIL-STD-810H; system MTBF ≥ 2000 hours demonstrated by accelerated life test or field data.</p>' },
  { type: 'Feature',     title: 'Temperature Range Compliance',
    description: '<p>The system shall operate within specification over the temperature range -40 °C to +70 °C (operational) and survive storage at -55 °C to +85 °C.</p>',
    ac: '<p>All performance parameters within limits after 2-hour soak at -40 °C and +70 °C; no physical damage after storage extremes per MIL-STD-810H Method 501/502.</p>' },
  { type: 'Requirement', title: 'Vibration Resistance — Airborne Installation',
    description: '<p>The airborne variant shall withstand vibration levels specified in MIL-STD-810H Method 514.8 Category 7 (aircraft, jet) without degradation to performance.</p>',
    ac: '<p>No failures or out-of-spec parameters after vibration test; post-test BIT passes; sensitivity degradation ≤ 1 dB.</p>' },
  { type: 'Requirement', title: 'Mean Time Between Failure',
    description: '<p>The system MTBF shall be ≥ 2000 hours for the complete mission equipment set, excluding scheduled maintenance actions.</p>',
    ac: '<p>MTBF ≥ 2000 h demonstrated by combination of demonstrated MTBF from field data and MIL-HDBK-217 prediction; confidence level ≥ 80%.</p>' },
  { type: 'Feature',     title: 'Built-In Test and Fault Isolation',
    description: '<p>The system shall perform continuous BIT during operation and detect ≥ 95% of single-fault failures, isolating each to a line-replaceable unit (LRU) within 10 min.</p>',
    ac: '<p>BIT fault-detection coverage ≥ 95% and fault-isolation to LRU ≥ 90% verified by fault-injection testing of all defined fault modes.</p>' },

  // ── Power & Size, Weight, Power (SWaP) ────────────────────────────────────
  { type: 'Epic',        title: 'SWaP Constraints for Airborne Installation',
    description: '<p>The airborne mission equipment shall meet platform-imposed size, weight, and power (SWaP) constraints to ensure installation without structural modification.</p>',
    ac: '<p>Total mission equipment mass ≤ 120 kg, volume ≤ 0.25 m³, prime power consumption ≤ 3 kVA verified by physical measurement and power profile test.</p>' },
  { type: 'Feature',     title: 'Prime Power Consumption',
    description: '<p>The system shall operate from the aircraft 115 V AC 400 Hz primary bus with total consumption ≤ 3 kVA during peak operation.</p>',
    ac: '<p>Power consumption measured during simultaneous operation of all subsystems; ≤ 3 kVA at full load verified by calibrated power meter.</p>' },
  { type: 'Requirement', title: 'Mission Equipment Mass Budget',
    description: '<p>The total mass of rack-mounted mission equipment (excluding antennas) shall not exceed 120 kg to comply with the host aircraft weight-and-balance limit.</p>',
    ac: '<p>Weighed on calibrated scales; total mass ≤ 120 kg including all cables, connectors, and mounting hardware.</p>' },

  // ── Cyber & Information Assurance ─────────────────────────────────────────
  { type: 'Epic',        title: 'Cyber Resilience and Information Assurance',
    description: '<p>The system shall be hardened against cyber threats and comply with applicable national information assurance requirements to protect mission data and system integrity.</p>',
    ac: '<p>Penetration test by accredited red team produces no critical or high findings; system achieves ATO under applicable IA framework.</p>' },
  { type: 'Feature',     title: 'Removable Media Control',
    description: '<p>The system shall enforce strict removable media control, allowing only authorised, scanned, and encrypted media to be connected to the mission computer.</p>',
    ac: '<p>Unauthorised USB device insertion generates an immediate alert and is blocked; policy enforced at OS level; verified by attempting to insert test media.</p>' },
  { type: 'Requirement', title: 'Audit Logging',
    description: '<p>The system shall maintain a tamper-evident audit log of all operator actions, system events, and data access for the duration of the mission.</p>',
    ac: '<p>Audit log completeness ≥ 99.9% verified; log integrity check (HMAC) passes after 8-hour mission cycle; no ability to modify log entries without detection.</p>' },

  // ── Logistics & Maintainability ────────────────────────────────────────────
  { type: 'Epic',        title: 'Maintainability and Logistic Support',
    description: '<p>The system shall be designed for ease of maintenance to minimise mean time to repair (MTTR) and logistic footprint in the field.</p>',
    ac: '<p>MTTR ≤ 45 min for any LRU replacement by a single maintainer using standard tools; spare-parts list covers ≥ 90% of anticipated failures.</p>' },
  { type: 'Feature',     title: 'LRU Replacement Without Calibration',
    description: '<p>All line-replaceable units shall be plug-and-play such that replacement does not require re-calibration of the mission system.</p>',
    ac: '<p>LRU replacement followed by BIT pass in ≤ 10 min; no post-replacement calibration step required; verified for all 12 defined LRUs.</p>' },
  { type: 'Requirement', title: 'Software Field Update',
    description: '<p>The system software and firmware shall be updatable in the field by a trained maintainer using a portable loader without hardware disassembly.</p>',
    ac: '<p>Full software update completed within 30 min using approved portable loader; system passes BIT after update; update process requires no hardware removal.</p>' },

  // ── Training & Documentation ───────────────────────────────────────────────
  { type: 'Feature',     title: 'Operator Training System',
    description: '<p>The system shall include a software-based operator training mode that simulates a realistic mission environment without requiring live RF input.</p>',
    ac: '<p>Training mode provides ≥ 80% of operational HMI functionality; trainee performance scores ≥ 70% on post-training assessment using training mode only.</p>' },
  { type: 'Requirement', title: 'Interactive Electronic Technical Manual',
    description: '<p>All maintenance procedures shall be delivered as an interactive electronic technical manual (IETM) accessible on a ruggedised tablet.</p>',
    ac: '<p>IETM covers 100% of scheduled and corrective maintenance procedures; tablet display readable in direct sunlight (≥ 700 nits).</p>' },
];

// ─── System (technical) requirement catalogue ─────────────────────────────────
// Reflects HOW the system satisfies the operational needs — verifiable, measurable.

const SYSTEM_REQ_CATALOGUE: ReadonlyArray<{
  title: string;
  type: 'Epic' | 'Feature' | 'Requirement';
  description: string;
  ac: string | null;
  verificationMethod: string | null;
}> = [
  // ── RF Front-End ──────────────────────────────────────────────────────────
  { type: 'Epic',        verificationMethod: 'Test',
    title: 'RF Front-End Subsystem',
    description: '<p>The RF front-end shall receive, pre-select, and digitise signals across the operational band 2 MHz–18 GHz with sufficient sensitivity, dynamic range, and selectivity to support downstream signal processing.</p>',
    ac: '<p>RF front-end performance verified per subsystem test plan STP-RFE-001; all parameters within specification at ambient and temperature extremes.</p>' },
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'HF Pre-Selector Filter Bank',
    description: '<p>The HF receive path shall include a switched pre-selector filter bank with ≥ 6 sub-bands covering 2–30 MHz to suppress out-of-band interferers by ≥ 60 dB.</p>',
    ac: '<p>Filter bank rejection ≥ 60 dB outside each sub-band; insertion loss ≤ 2 dB in-band; verified by swept-tone measurement for all 6 sub-bands.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'Wideband LNA Noise Figure ≤ 4 dB (VHF–SHF)',
    description: '<p>The low-noise amplifier (LNA) in the VHF–SHF receive path shall exhibit a noise figure ≤ 4 dB across 30 MHz–18 GHz to achieve the system sensitivity budget.</p>',
    ac: '<p>Noise figure measured by Y-factor method at 10 frequency points; ≤ 4 dB at all points with 95% confidence.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'ADC Sample Rate ≥ 3.2 GSPS with 12-bit Resolution',
    description: '<p>The wideband analogue-to-digital converter shall operate at ≥ 3.2 GSPS with an effective number of bits (ENOB) ≥ 10 bits to digitise the SHF band with sufficient dynamic range.</p>',
    ac: '<p>ENOB ≥ 10 bits verified at full sample rate by sine-wave FFT test; SINAD ≥ 62 dBFS across operating temperature range.</p>' },
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Switched Attenuator for Input Protection',
    description: '<p>A switched step attenuator (0–30 dB in 10 dB steps) shall be inserted before the LNA to protect against saturation by strong in-band signals while the AGC loop establishes control.</p>',
    ac: '<p>Attenuator switching time ≤ 100 µs; attenuation accuracy ±1 dB per step; IP3 ≥ +30 dBm at maximum attenuation setting.</p>' },

  // ── Channelisation & DDC ──────────────────────────────────────────────────
  { type: 'Epic',        verificationMethod: 'Test',
    title: 'Digital Channeliser and Down-Conversion',
    description: '<p>The digital channeliser shall extract up to 32 simultaneous, independently tunable narrowband channels from the wideband digitised spectrum via polyphase filter bank processing.</p>',
    ac: '<p>32 simultaneous channels verified; each tunable to any frequency within the monitored band; channel bandwidth selectable 1–25 kHz; channel isolation ≥ 60 dBc.</p>' },
  { type: 'Feature',     verificationMethod: 'Analysis',
    title: 'Polyphase Filter Bank Implementation',
    description: '<p>The channeliser shall implement a polyphase filter bank (PFB) in FPGA to achieve efficient multi-channel extraction with ≤ 0.5 dB passband ripple and ≥ 80 dB stop-band attenuation.</p>',
    ac: null },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'Channel Frequency Agility — Retune Time ≤ 1 ms',
    description: '<p>Each digital channel shall retune to a new centre frequency within ≤ 1 ms of receiving a retune command from the signal management software.</p>',
    ac: '<p>Retune latency measured from command issuance to settled output frequency; ≤ 1 ms for 99% of retune commands across the full frequency range.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'DDC Output IQ Phase Balance ≤ 1°',
    description: '<p>The digital down-converter output shall maintain I/Q phase balance ≤ 1° and amplitude balance ≤ 0.2 dB to ensure accurate demodulation and direction-finding performance.</p>',
    ac: '<p>I/Q imbalance measured at 5 frequencies per sub-band; phase error ≤ 1° and amplitude error ≤ 0.2 dB at all test points.</p>' },
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Wideband Spectrum Monitoring ≥ 1 GHz Instantaneous BW',
    description: '<p>In addition to the narrowband channels, the system shall perform continuous wideband spectral monitoring of ≥ 1 GHz instantaneous bandwidth to detect transient or frequency-agile signals.</p>',
    ac: '<p>Wideband spectral coverage and FFT update rate ≥ 10 frames/s verified over a 1 GHz span using multi-tone injection test.</p>' },

  // ── Signal Detection & PDW Extraction ─────────────────────────────────────
  { type: 'Epic',        verificationMethod: 'Test',
    title: 'Signal Detection and Characterisation Engine',
    description: '<p>The signal detection engine shall continuously scan the monitored spectrum, detect signals exceeding a dynamic threshold, and extract signal parameters for downstream classification.</p>',
    ac: '<p>Detection probability ≥ 95% at SNR ≥ 6 dB; false alarm rate ≤ 1 event/min in a signal-free environment; verified by Monte-Carlo injection test (1000 trials).</p>' },
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Constant False Alarm Rate (CFAR) Detector',
    description: '<p>Signal detection shall use a CFAR algorithm that adapts the detection threshold to local noise floor variations to maintain constant false-alarm rate across a heterogeneous spectral environment.</p>',
    ac: '<p>CFAR false-alarm rate ≤ 1 × 10⁻⁴ per resolution cell verified with noise-only input; detection probability ≥ 90% at SNR = 6 dB with Swerling-1 target model.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'Minimum Detectable Pulse Width ≤ 100 ns',
    description: '<p>The pulse detection subsystem shall detect radar pulses with duration ≥ 100 ns at the input sensitivity threshold to intercept modern low-probability-of-intercept (LPI) radars.</p>',
    ac: '<p>Detection probability ≥ 90% for 100 ns pulses at SNR ≥ 10 dB; verified by calibrated pulse generator injection test.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'PDW Time-of-Arrival Accuracy ≤ 10 ns RMS',
    description: '<p>The time-of-arrival (TOA) field of each pulse descriptor word shall be accurate to ≤ 10 ns RMS to support multi-platform TDOA geo-location at the required accuracy.</p>',
    ac: '<p>TOA accuracy measured against GPS-synchronised pulse generator reference; ≤ 10 ns RMS over 1000 pulses at 100 MHz pulse repetition frequency.</p>' },
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Intra-Pulse Modulation Analysis',
    description: '<p>The system shall detect and characterise intra-pulse modulation (LFM chirp, Barker code, polyphase coding) of intercepted radar pulses to support LPI radar identification.</p>',
    ac: '<p>LFM and Barker-coded pulses correctly identified in ≥ 90% of trials at SNR ≥ 8 dB; modulation parameters extracted within ±5% of injected values.</p>' },

  // ── Direction Finding (DF) Hardware & Algorithms ──────────────────────────
  { type: 'Epic',        verificationMethod: 'Test',
    title: 'Direction Finding Subsystem',
    description: '<p>The DF subsystem shall measure emitter bearing using a multi-element antenna array and digital processing algorithms to achieve the specified bearing accuracy.</p>',
    ac: '<p>Bearing RMS error ≤ 2° at SNR ≥ 10 dB; 360° azimuth coverage; verified in an anechoic chamber at 10 azimuth angles and 5 frequencies.</p>' },
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Multi-Element Antenna Array (≥ 8 Elements)',
    description: '<p>The DF antenna array shall comprise ≥ 8 elements arranged on a baseline that provides unambiguous bearing over 360° and sufficient aperture for the specified bearing accuracy.</p>',
    ac: '<p>Array manifold measured in anechoic chamber; bearing ambiguity-free operation verified across 360° azimuth and 30 MHz–3 GHz frequency range.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'MUSIC Algorithm DF Processing',
    description: '<p>The DF processor shall implement the MUSIC (MUltiple SIgnal Classification) algorithm to achieve super-resolution bearing estimates when multiple simultaneous emitters are present.</p>',
    ac: '<p>MUSIC algorithm resolves two emitters separated by ≥ 5° at SNR ≥ 12 dB; bearing error ≤ 1° RMS in a single-emitter scenario at SNR ≥ 15 dB.</p>' },
  { type: 'Requirement', verificationMethod: 'Analysis',
    title: 'Phase Interferometry Baseline Length',
    description: '<p>The phase interferometry DF subsystem baseline shall be ≥ λ/2 at the lowest operating frequency to ensure unambiguous phase measurement across the DF frequency range.</p>',
    ac: null },
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'DF Calibration and Channel Equalisation',
    description: '<p>The DF system shall support periodic calibration to correct for inter-channel amplitude and phase imbalances introduced by RF hardware tolerances and thermal drift.</p>',
    ac: '<p>Post-calibration bearing improvement ≥ 0.5° RMS compared to uncalibrated state; calibration procedure completed automatically within 2 min.</p>' },

  // ── Signal Processing and Classification ──────────────────────────────────
  { type: 'Epic',        verificationMethod: 'Test',
    title: 'Modulation Classification and Signal Intelligence Processing',
    description: '<p>The signal intelligence processing module shall automatically classify intercepted signal modulations and extract intelligence parameters for operator display and recording.</p>',
    ac: '<p>Classification accuracy ≥ 88% across AM, FM, SSB, CW, FSK, QPSK, 16QAM at SNR ≥ 8 dB; parameters extracted within 500 ms of signal detection.</p>' },
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Automatic Modulation Classification (AMC) Module',
    description: '<p>The AMC module shall classify analogue and digital modulations using feature-based and likelihood-ratio classification algorithms without operator intervention.</p>',
    ac: '<p>AMC classification accuracy ≥ 88% for all specified modulations at SNR ≥ 8 dB; classification decision available within 200 ms of signal detection.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'Instantaneous Frequency Measurement Accuracy ≤ 100 Hz',
    description: '<p>The instantaneous frequency measurement (IFM) subsystem shall measure the carrier frequency of CW and pulsed signals to accuracy ≤ 100 Hz RMS for signals within the operational band.</p>',
    ac: '<p>IFM accuracy ≤ 100 Hz RMS at SNR ≥ 10 dB, verified against calibrated signal source at 20 frequencies spanning the operational band.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'Bandwidth Measurement Accuracy ≤ 5% of Occupied BW',
    description: '<p>The system shall measure the occupied bandwidth of intercepted signals to ≤ 5% relative error using the 99% power containment criterion.</p>',
    ac: '<p>BW measurement error ≤ 5% for signal bandwidths 1 kHz–10 MHz; verified at 5 bandwidth values using calibrated swept-frequency sources.</p>' },
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Spread-Spectrum Detection and Despreading',
    description: '<p>The processing module shall detect direct-sequence spread-spectrum (DSSS) and frequency-hopping spread-spectrum (FHSS) signals and attempt to despread or reconstruct hop sequences.</p>',
    ac: '<p>DSSS detection probability ≥ 80% at processing gain up to 30 dB; FHSS hop sequence reconstructed with ≥ 90% hop capture rate at hop rate ≤ 500 hops/s.</p>' },

  // ── Data Processing, Storage, and Dissemination ───────────────────────────
  { type: 'Epic',        verificationMethod: 'Test',
    title: 'Mission Computer and Data Management',
    description: '<p>The mission computer shall process, store, manage, and disseminate all intelligence data produced by the SIGINT sensor suite in real time throughout the mission.</p>',
    ac: '<p>Mission computer sustains full-capacity data throughput for ≥ 8 h; no data loss during peak-load stress test; BIT pass at end of test.</p>' },
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Solid-State Storage — ≥ 4 TB Mission Capacity',
    description: '<p>The system shall provide ≥ 4 TB of encrypted solid-state storage for mission data (IQ recordings, PDW logs, intelligence reports) sufficient for ≥ 8 hours at full collection bandwidth.</p>',
    ac: '<p>4 TB capacity verified; write throughput ≥ 2 GB/s sustained; encryption at rest using AES-256; no data errors in a 24-hour write/read endurance test.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'Ethernet 10 GbE Internal Backplane',
    description: '<p>The internal data interconnect between SIGINT processing modules and the mission computer shall use a 10 GbE Ethernet switch fabric to provide sufficient bandwidth for IQ and metadata streaming.</p>',
    ac: '<p>10 GbE backplane throughput ≥ 9 Gbps sustained under full-load test; latency ≤ 100 µs port-to-port; zero packet loss at rated throughput.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'Intelligence Report Generation ≤ 5 s Latency',
    description: '<p>The system shall automatically generate a formatted intelligence report (SIGINT activity report) within ≤ 5 s of emitter identification and deliver it to the C4ISR dissemination interface.</p>',
    ac: '<p>Report generation latency ≤ 5 s in ≥ 98% of trials; report format compliant with applicable SIGINT reporting standard; verified by automated timing test.</p>' },
  { type: 'Feature',     verificationMethod: 'Inspection',
    title: 'KG-175D TACLANE Encryption Integration',
    description: '<p>The dissemination subsystem shall integrate a KG-175D TACLANE in-line network encryptor for transmission of intelligence reports over classified networks.</p>',
    ac: null },

  // ── Navigation and Time Reference ─────────────────────────────────────────
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Embedded GPS/GNSS Receiver',
    description: '<p>The system shall incorporate an embedded GPS/GNSS receiver providing platform position (≤ 3 m CEP) and time reference (≤ 100 ns RMS) for DF and TDOA processing.</p>',
    ac: '<p>Position CEP ≤ 3 m verified over 1-hour static observation; time error ≤ 100 ns RMS verified against GPS time reference.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'GPS Anti-Jam Capability (≥ 40 dB)',
    description: '<p>The GPS receiver shall incorporate controlled reception pattern antenna (CRPA) technology providing ≥ 40 dB of anti-jam gain to maintain operation in a contested electromagnetic environment.</p>',
    ac: '<p>Anti-jam gain ≥ 40 dB verified with a GPS signal simulator and calibrated jammer; position maintained within CEP ≤ 5 m under maximum specified jamming level.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'INS/GPS Integration for GPS-Denied Operation',
    description: '<p>The navigation system shall integrate an inertial navigation system (INS) with GPS to maintain position accuracy ≤ 10 m CEP for ≥ 60 s following GPS signal loss.</p>',
    ac: '<p>Position error ≤ 10 m CEP at t = 60 s post-GPS-loss; verified by simulation with GPS denial at t = 0 and INS only thereafter.</p>' },

  // ── Power Subsystem ────────────────────────────────────────────────────────
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Power Supply Unit — 115 V AC 400 Hz Input',
    description: '<p>The power supply unit (PSU) shall accept 115 V AC ±10%, 400 Hz ±5% single-phase input and deliver regulated DC outputs for all mission equipment subsystems.</p>',
    ac: '<p>PSU output regulation ≤ ±2% under 10–100% load step; efficiency ≥ 85% at full load; input power factor ≥ 0.95.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'Power Hold-Up Time ≥ 50 ms',
    description: '<p>The PSU shall maintain all output rails within specification for ≥ 50 ms following a complete loss of AC input to prevent mission data loss during transient power interruptions.</p>',
    ac: '<p>Hold-up time ≥ 50 ms verified by AC power interruption test; all subsystems remain operational and no data loss for 50 ms post-interruption.</p>' },

  // ── Software Architecture ─────────────────────────────────────────────────
  { type: 'Epic',        verificationMethod: 'Inspection',
    title: 'Software Architecture — Modular Real-Time Processing',
    description: '<p>The mission software shall be structured as a modular, real-time processing architecture with well-defined inter-module interfaces to enable independent development, test, and upgrade of individual processing modules.</p>',
    ac: null },
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Real-Time Operating System (RTOS) Scheduling',
    description: '<p>Signal processing tasks shall execute under a deterministic RTOS (VxWorks 7 or equivalent) with worst-case interrupt latency ≤ 10 µs to meet the system timing budget.</p>',
    ac: '<p>Worst-case interrupt latency ≤ 10 µs verified by RTOS latency measurement tool under full task-load conditions over a 1-hour test period.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'Software Health Monitor with Watchdog',
    description: '<p>The mission software shall include a hardware watchdog timer that resets any hung processing task within ≤ 5 s and automatically re-initialises the affected module without operator intervention.</p>',
    ac: '<p>Watchdog-induced recovery ≤ 5 s from task hang injection; system resumes correct operation within 10 s; verified by fault injection for all critical tasks.</p>' },
  { type: 'Requirement', verificationMethod: 'Analysis',
    title: 'Software Lines of Code Static Analysis — Cyclomatic Complexity ≤ 15',
    description: '<p>All safety- and mission-critical software modules shall have a McCabe cyclomatic complexity ≤ 15 per function to meet maintainability and testability requirements.</p>',
    ac: null },
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'OTA Software Update via Encrypted Channel',
    description: '<p>Mission software shall be updatable over an encrypted IP link using a push-download mechanism without requiring physical media insertion or system shutdown.</p>',
    ac: '<p>OTA update of full mission software package completed within 15 min; system passes full BIT after update; update authenticated by code-signing certificate.</p>' },

  // ── Antenna Subsystem ─────────────────────────────────────────────────────
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Broadband Blade Antenna (HF–VHF)',
    description: '<p>The HF/VHF intercept antenna shall be an omni-directional blade antenna covering 2–512 MHz with VSWR ≤ 3:1 and gain ≥ -5 dBi across the band.</p>',
    ac: '<p>VSWR ≤ 3:1 and gain ≥ -5 dBi verified by antenna range measurement at 10 frequencies from 2 to 512 MHz in the installed configuration.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'UHF–SHF Log-Periodic Antenna VSWR ≤ 2:1',
    description: '<p>The UHF–SHF intercept antenna shall be a log-periodic or spiral element array covering 300 MHz–18 GHz with VSWR ≤ 2:1 and gain ≥ 2 dBi across the band.</p>',
    ac: '<p>VSWR ≤ 2:1 and gain ≥ 2 dBi verified by antenna range measurement at 15 frequencies from 300 MHz to 18 GHz.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'Antenna Connector RF Leakage ≤ -80 dBm',
    description: '<p>All antenna connectors and cable assemblies shall exhibit RF leakage ≤ -80 dBm to prevent unintended radiation that could compromise platform EMCON.</p>',
    ac: '<p>Leakage measured at all connector points during normal operation; ≤ -80 dBm at all points verified by calibrated near-field probe.</p>' },

  // ── EMC / EW Hardening ────────────────────────────────────────────────────
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'MIL-STD-461 EMC Compliance',
    description: '<p>The mission equipment shall comply with MIL-STD-461H emission and susceptibility requirements for the applicable platform installation class.</p>',
    ac: '<p>Full MIL-STD-461H test campaign completed; all applicable CE, CS, RE, RS requirements met; test report reviewed and accepted by certifying authority.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'EMP Hardening — MIL-STD-461 RS105',
    description: '<p>The system electronics shall survive an EMP/HIRF pulse per MIL-STD-461H RS105 without permanent damage or data loss.</p>',
    ac: '<p>Post-RS105 test: system passes full BIT; no component failures; recorded data integrity confirmed; tested per MIL-STD-461H method.</p>' },

  // ── Thermal Management ────────────────────────────────────────────────────
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Forced-Air Cooling Subsystem',
    description: '<p>The rack-mounted mission equipment shall be cooled by a forced-air subsystem maintaining all component junction temperatures within datasheet limits at the maximum operating ambient temperature of +70 °C.</p>',
    ac: '<p>Component temperatures verified by thermocouple measurement during full-load operation at +70 °C ambient; all junction temps ≤ datasheet maximum.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'Thermal Shutdown and Recovery',
    description: '<p>The system shall automatically reduce processing load and alert the operator if any monitored component temperature exceeds 85 °C, and shall recover full capability when temperature returns below 75 °C.</p>',
    ac: '<p>Thermal shutdown triggered within 2 s of threshold exceedance; operator alert generated; full recovery within 30 s of temperature drop; verified by thermal chamber test.</p>' },

  // ── Built-In Test ─────────────────────────────────────────────────────────
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'Power-On BIT Completion ≤ 90 s',
    description: '<p>The system power-on BIT sequence shall complete within ≤ 90 s of power application and indicate GO/NO-GO status to the operator before the system is declared operationally ready.</p>',
    ac: '<p>BIT completion time ≤ 90 s in ≥ 99% of power cycles; GO status correctly reported when no faults injected; NO-GO correctly reported for each injected fault class.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'Continuous BIT False-Alarm Rate ≤ 0.1/hour',
    description: '<p>The continuous BIT shall produce no more than 0.1 false-alarm reports per hour during fault-free operation to avoid nuisance alerts distracting the operator.</p>',
    ac: '<p>CBIT false-alarm rate measured over 100-hour fault-free test; ≤ 0.1 false alarms/hour with 90% confidence.</p>' },

  // ── Interfaces ────────────────────────────────────────────────────────────
  { type: 'Feature',     verificationMethod: 'Test',
    title: 'MIL-STD-1553B Remote Terminal Interface',
    description: '<p>The system shall provide a MIL-STD-1553B remote terminal (RT) interface at address configurable in the range 1–30 to integrate with the host platform mission management system.</p>',
    ac: '<p>1553B RT interface passes MIL-STD-1553B conformance test; all defined message types processed correctly; RT address configurable without hardware change.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'RS-422 Serial Interface — Navigation Data Input',
    description: '<p>The system shall accept navigation data (position, attitude, velocity) from the platform navigation system via RS-422 serial interface at 115200 baud.</p>',
    ac: '<p>Navigation data received at 115200 baud without framing errors; position and attitude data correctly parsed and used by DF and geo-location algorithms.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'GbE Ethernet — External Dissemination Port',
    description: '<p>The system shall provide a 1 GbE Ethernet port for dissemination of intelligence reports and streaming data to external C4ISR systems via TCP/IP.</p>',
    ac: '<p>1 GbE port sustains ≥ 900 Mbps throughput; intelligence reports delivered with latency ≤ 10 ms LAN; interface survives 1000-hour MTBF estimation per MIL-HDBK-217.</p>' },

  // ── Security ──────────────────────────────────────────────────────────────
  { type: 'Feature',     verificationMethod: 'Inspection',
    title: 'Data-at-Rest AES-256 Encryption',
    description: '<p>All mission data stored on internal solid-state drives shall be encrypted using AES-256-GCM with FIPS 140-2 validated cryptographic modules.</p>',
    ac: null },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'Zeroisation in ≤ 10 s',
    description: '<p>The system shall cryptographically zeroize all key material and mission data within ≤ 10 s of operator-initiated or automated emergency erase command.</p>',
    ac: '<p>Zeroisation of all storage media completed within 10 s; post-erase forensic analysis confirms no recoverable data per NSA EPL-approved erase procedure.</p>' },
  { type: 'Requirement', verificationMethod: 'Test',
    title: 'USB Port Lockdown — Whitelist Only',
    description: '<p>The system software shall permit connection only of pre-authorised USB devices (by vendor ID and product ID whitelist) and shall block and log any attempt to connect an unauthorised device.</p>',
    ac: '<p>Unauthorised USB device insertion blocked and logged within 1 s; authorised device accepted without restriction; policy enforced at kernel level.</p>' },
];

// ─── Factory helpers ──────────────────────────────────────────────────────────

function adoUrl(id: number): string {
  return `${ADO_BASE_URL}/${id}`;
}

export function customerRequirements(): AdoWorkItem[] {
  return CUSTOMER_IDS.map((id, i) => {
    const spec = CUSTOMER_REQ_CATALOGUE[i % CUSTOMER_REQ_CATALOGUE.length];
    return {
      id,
      rev: 1,
      url: adoUrl(id),
      fields: {
        'System.Id': id,
        'System.Title': spec.title,
        'System.WorkItemType': spec.type,
        'System.State': 'Active',
        'System.AreaPath': CUSTOMER_AREA_PATH,
        'System.IterationPath': 'SomeProject\\Sprint 1',
        'System.Description': spec.description,
        'Microsoft.VSTS.Common.AcceptanceCriteria': spec.ac,
        'System.ChangedDate': '2025-01-01T00:00:00Z',
      },
      relations: [],
    };
  });
}

export function systemRequirements(): AdoWorkItem[] {
  const items: AdoWorkItem[] = [];

  for (const id of SYSTEM_IDS) {
    const i = id - 2000;
    const spec = SYSTEM_REQ_CATALOGUE[i % SYSTEM_REQ_CATALOGUE.length];

    let relations: AdoWorkItem['relations'];

    if (i < COVERED_COUNT) {
      // Covered: link to a customer requirement
      const customerTargetId = 1000 + (i % 100);
      relations = [
        {
          rel: 'Elisra.CoveredBy-Forward',
          url: adoUrl(customerTargetId),
          attributes: { comment: '' },
        },
      ];
    } else if (i < COVERED_COUNT + UNCOVERED_WRONG_SCOPE_COUNT) {
      // Uncovered (wrong scope): link to a third-area item (ID 3000+)
      const thirdAreaTargetId = 3000 + (i - COVERED_COUNT);
      relations = [
        {
          rel: 'Elisra.CoveredBy-Forward',
          url: adoUrl(thirdAreaTargetId),
          attributes: { comment: '' },
        },
      ];
    } else {
      // Uncovered (no link)
      relations = [];
    }

    items.push({
      id,
      rev: 1,
      url: adoUrl(id),
      fields: {
        'System.Id': id,
        'System.Title': spec.title,
        'System.WorkItemType': spec.type,
        'System.State': i % 8 === 0 ? 'Proposed' : 'Active',
        'System.AreaPath': SYSTEM_AREA_PATH,
        'System.IterationPath': 'SomeProject\\Sprint 1',
        'System.Description': spec.description,
        'Microsoft.VSTS.Common.AcceptanceCriteria': spec.ac,
        'Microsoft.VSTS.Common.VerificationMethod': spec.verificationMethod,
        'System.ChangedDate': '2025-01-01T00:00:00Z',
      },
      relations,
    });
  }

  return items;
}
