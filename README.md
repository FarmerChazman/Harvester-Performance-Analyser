# Harvester Performance Analyser

A client-side web application for visualising combine harvester telemetry data. Upload one or multiple JSON/JSONL telemetry exports (one per machine), and the dashboard renders GPS tracks on a satellite map, interactive time-series charts, and a comprehensive KPI (Key Performance Indicator) summary — **entirely in your browser** with no data leaving your machine.

Perfect for growers running a fleet of 6–8+ machines who need to review all harvesters from a single session.

**[Launch the Web App →](https://FarmerChazman.github.io/Harvester-Performance-Analyser/)**

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Getting Started](#getting-started)
4. [Data Format](#data-format)
5. [Dashboard Navigation](#dashboard-navigation)
6. [Tab & Sub-Category Reference](#tab--sub-category-reference)
7. [KPI Methodology](#kpi-methodology)
8. [State Timeline Engine](#state-timeline-engine)
9. [Counter vs State — Explained](#counter-vs-state--explained)
10. [Badge Meanings](#badge-meanings)
11. [Technology Stack](#technology-stack)
12. [Deployment](#deployment)
13. [Contributing](#contributing)
14. [License](#license)

---

## Overview

Combine harvesters produce thousands of telemetry records per session — engine speed, GPS position, grain flow, moisture, fuel consumption, rotor hours and more. This tool takes that raw data and transforms it into:

- **An interactive satellite map** showing GPS tracks, speed, heading and telemetry at each point
- **Time-series charts** for every sensor parameter, grouped by functional category
- **A KPI summary report** with calculated hours, area, yield, fuel efficiency and data-quality badges
- **Multi-machine support** — upload files for your entire fleet and switch between machines instantly

Processing happens entirely in JavaScript in the browser. No server, no uploads, no accounts — just open the page and drag your files in.

---

## Features

| Feature | Description |
|---------|-------------|
| **Multi-File Upload** | Select or drag-drop multiple files at once — one per machine, up to 8+ |
| **Fleet Machine Selector** | Purple machine bar lets you switch between harvesters instantly |
| **Drag & Drop Upload** | JSON or JSONL files up to several hundred MB |
| **Google Hybrid Satellite Map** | Leaflet map with Google satellite imagery, ESRI fallback, and OpenStreetMap option |
| **Default Australia View** | Background map centred on Australia (–25.27, 133.78) at zoom 4 |
| **GPS Track Visualisation** | Polyline path + interactive point markers with telemetry pop-up |
| **5 Dashboard Tabs** | Machine Status & GPS, Engine & Driveline, Harvest Performance, Settings & Automation, Reports & KPIs |
| **20+ Sub-Categories** | Each tab has multiple sub-groups for focused analysis |
| **150+ Parameters** | Every known telemetry parameter mapped to its correct group |
| **Plotly.js Charts** | Line charts for time-series, bar charts for harvest performance binned data |
| **KPI Summary** | 15 calculated KPIs with quality badges, notes, and detail table |
| **State Timeline Engine** | Second-by-second machine-state reconstruction from live sensors |
| **Counter Intelligence** | Replay-aware, reset-handling counter delta calculations |
| **Unit Conversion** | Automatic kg/s → tonne/hour, kg/m² → tonne/hectare |
| **Custom Chart Builder** | Select any combination of parameters and overlay them in a modal chart |
| **Date Range Filtering** | Zoom to any time window within the data |
| **Print / PDF** | Built-in print button for the KPI report |
| **Fully Client-Side** | Zero server dependencies — works offline after initial load |
| **Single-File App** | One `index.html` — no build step, no dependencies to install |

---

## Getting Started

### Option A: Use the hosted version

1. Navigate to **[https://FarmerChazman.github.io/Harvester-Performance-Analyser/](https://FarmerChazman.github.io/Harvester-Performance-Analyser/)**
2. Drag your telemetry file(s) onto the drop zone — or click **Select Files**
   - Upload a **single file** for one machine, or **multiple files** for your whole fleet
3. Wait for the processing spinner to finish (each file is parsed and grouped by machine)
4. If multiple machines are detected, use the **machine selector bar** to switch between them
5. Explore the dashboard!

### Option B: Run locally

```bash
git clone https://github.com/FarmerChazman/Harvester-Performance-Analyser.git
cd Harvester-Performance-Analyser

# Open in your default browser
start index.html          # Windows
open index.html           # macOS
xdg-open index.html       # Linux
```

No web server is required for local use (CDN links for Plotly and Leaflet will load if you have internet, but the core logic is inline).

### Option C: Download just the HTML file

Download `index.html` from this repo and double-click it. That's it.

---

## Data Format

The app accepts **three input formats**:

### 1. JSON Array
A single JSON array of record objects:
```json
[
  {
    "id": "abc123",
    "nickname": "Header 40",
    "vin": "YJR000001",
    "name": "Engine Speed",
    "numericValue": 1850.0,
    "stringValue": null,
    "uom": "rpm",
    "eventTimestamp": "2024-11-15T14:23:01.000+10:30",
    "lat": -34.1234,
    "lon": 138.5678
  },
  ...
]
```

### 2. JSON Lines (JSONL)
One JSON object per line (`.jsonl` or `.json` extension):
```
{"id":"abc123","nickname":"Header 40","vin":"YJR000001","name":"Engine Speed","numericValue":1850.0,"stringValue":null,"uom":"rpm","eventTimestamp":"2024-11-15T14:23:01.000+10:30","lat":-34.1234,"lon":138.5678}
{"id":"abc123","nickname":"Header 40","vin":"YJR000001","name":"Ground Speed","numericValue":6.2,"stringValue":null,"uom":"km/h","eventTimestamp":"2024-11-15T14:23:01.000+10:30","lat":-34.1234,"lon":138.5678}
```

### 3. Tab-Delimited
10+ tab-separated columns in order: `id`, `nickname`, `vin`, `name`, `numericValue`, `stringValue`, `uom`, `eventTimestamp`, `lat`, `lon`

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Parameter name (e.g. "Engine Speed", "Dry Flow - Average") |
| `numericValue` | number | Sensor reading value |
| `eventTimestamp` | string | ISO 8601 datetime with timezone offset |
| `lat` | number | Latitude (for GPS mapping) |
| `lon` | number | Longitude (for GPS mapping) |

Optional but recommended: `nickname` (machine name — **used to identify each machine when uploading multiple files**), `vin` (Vehicle Identification Number — used as fallback machine identifier), `uom` (unit of measurement), `stringValue` (text fallback when numericValue is null).

### Multi-File Upload — How Machine Grouping Works

When you upload multiple files:

1. Each file is parsed independently
2. The app reads the `nickname` field (or `vin` as fallback) from the first 50 records to identify which machine the file belongs to
3. If two files share the same `nickname`, their records are **merged** into one machine
4. Each machine gets its own independent data store — switching machines is instant with no re-parsing
5. If no `nickname` or `vin` is found, the **filename** is used as the machine identifier

---

## Dashboard Navigation

### Machine Selector (Multi-Machine Mode)

When you upload files for **multiple machines**, a purple machine selector bar appears between the header and the group tabs:

- Each machine is shown as a **chip** with the machine name (from the `nickname` field) and record count
- **Click a chip** to switch the entire dashboard — charts, map, KPIs and date range all update to that machine's data
- The currently active machine is highlighted
- Machines are identified automatically by the `nickname` or `vin` field in the telemetry records
- If all files belong to the same machine, the selector bar is hidden

### Header

The header shows:
- **Machine name** (from the `nickname` field) and VIN
- **Date range** of the loaded data
- **Date filter** — set custom Start/End times and click **Apply** to zoom in
- **Custom parameters dropdown** — select parameters to combine in a custom chart
- **Create custom chart** — opens a modal with overlaid time-series for selected parameters
- **Load New File** — return to the upload screen (clears all machines)

### Group Tabs

Five top-level tabs organise all parameters:

| Tab | Focus |
|-----|-------|
| Machine Status & GPS | GPS position, connectivity, work mode |
| Engine & Driveline | Engine RPM, fuel, temperatures, pressures, transmission |
| Harvest Performance | Yield, flow, mechanisms, loss, coverage |
| Settings & Automation | Header, sieve, spreader, unloading settings |
| Reports & KPIs | Calculated KPI summary report |

### Subgroup Chips

Each tab has chips (pills) for sub-categories. Click a chip to render charts for that sub-category.

### Chart Interaction

- **Hover** over any chart to see exact values
- **Click the ⛶ expand icon** on a chart card to open it in a full-screen modal
- **Zoom** using Plotly's built-in drag-to-zoom (hold and drag on the chart area)
- **Pan** by clicking the pan icon in Plotly's toolbar
- **Double-click** a chart to reset the zoom

### Map Interaction

In the **GPS / Position** sub-tab:
- Red circle markers show GPS points
- Blue polyline shows the travel path
- **Hover** over a point to see a preview panel
- **Click** a point to pin the info panel with full GPS details and telemetry data
- **Layer control** (top-left) lets you switch between Google Satellite, ESRI Satellite, and OpenStreetMap
- **Scale bar** shows distance at the current zoom level

---

## Tab & Sub-Category Reference

### Machine Status & GPS
| Sub-Category | Key Parameters |
|-------------|---------------|
| GPS / Position | Latitude, Longitude, Speed, Altitude, Heading, Fix, Satellites, PDOP, Correction Type |
| Connectivity / Network | Network status, RSSI, connection type, operator name, BYOC status |
| Work Mode / Duty Cycle | Duty status, work state, driving direction, gear, harvest mode, fuel by mode |

### Engine & Driveline
| Sub-Category | Key Parameters |
|-------------|---------------|
| Engine Core | Engine Speed, Load, Hours, Fuel Rate, Battery Voltage, Fuel Tank Level |
| Temperatures | Coolant, Oil, Hydraulic, Hydro Motor, Intake Manifold, Cooling, Traction Gearbox |
| Pressures | Engine Oil, Hydraulic Pump, Ground Drive FWD/REV |
| Driveline & Transmission | Ground Speed, Drive Mode, Gear, Slip Angle, Traction Balance, Auto Steering |

### Harvest Performance
| Sub-Category | Key Parameters |
|-------------|---------------|
| Yield & Flow | Dry Flow Average, Flow Wet, Dry/Wet Yield, Dry Weight, Harvest Mode, Broken Grain, MOG |
| Harvest Mechanisms | Fan, Rotor/Drum, Elevator, Feeder, Straw Chopper speeds; Vane Position; Multi-Thresh |
| Loss & Quality | Rotor Loss, Sieve Loss, Tailings Volume, Moisture Average/Instant |
| Coverage & Area | Coverage Area, Area, Area Remaining, Work Rate, Working Width |

### Settings & Automation
| Sub-Category | Key Parameters |
|-------------|---------------|
| Header / Feeder | Height Control, Concave Opening, Reel Speed, Auto Crop Settings, Guidance |
| Sieve Settings | Front/Rear Upper/Lower Sieve Positions |
| Spreader & Chopper | Spreader speeds L/R, Distribution Position, Straw Chopper Speed, Swath Door |
| Unloading & Misc | Auger Status, Grain Tank Level, Operator, Field info, Receiver details |

### Reports & KPIs
| Sub-Category | Description |
|-------------|-------------|
| KPI Summary | Full calculated report — see [KPI Methodology](#kpi-methodology) below |

---

## KPI Methodology

The KPI engine computes 15+ metrics from raw telemetry. Each KPI uses one or both of two measurement approaches (see [Counter vs State](#counter-vs-state--explained)).

### Computed KPIs

| KPI | Unit | Calculation Method |
|-----|------|-------------------|
| **Machine Power-On Hours** | hrs | Time when fresh telemetry is being received (not Unknown/stale) |
| **Engine Running Hours** | hrs | Time when Engine Speed > 500 RPM (state-derived) |
| **Key-On (Engine Off)** | hrs | Power-on minus Engine Running |
| **Rotor/Drum Operating Hours** | hrs | Time when Rotor Speed > 500 RPM |
| **Harvesting Hours** | hrs | Time when ALL conditions met simultaneously: Engine > 1500 RPM, Rotor > 500 RPM, Dry Flow above threshold, Fan Speed > 500 RPM, Ground Speed > 0.5 km/h |
| **Area Harvested** | ha | Primary: Area counter delta (replay-aware). Fallback: Ground Speed × Working Width integration during harvest state |
| **Area per Hour** | ha/hr | Area Harvested ÷ Harvesting Hours |
| **Dry Flow Avg (Harvest)** | t/hr | Zero-order-hold weighted average of Dry Flow during harvest state only |
| **Wet Yield Avg** | t/ha | Time-weighted average of Wet Yield signal during harvest |
| **Dry Yield Avg** | t/ha | Primary: Dry Yield Average signal. Fallback: Dry Weight counter ÷ Area |
| **Moisture Avg** | % | Time-weighted average of Moisture during harvest |
| **Fuel Used (Field Mode)** | L | Fuel counter delta (field mode). Fallback: Fuel Rate integration |
| **Fuel Used (Road Mode)** | L | Fuel counter delta (road mode). Fallback: Fuel Rate integration |
| **Fuel per Area (Field)** | L/ha | Fuel (field) ÷ Area Harvested |
| **Road Distance** | km | Ground Speed × time during road state (diagnostic) |

### Thresholds Used

| Parameter | Threshold | Purpose |
|-----------|-----------|---------|
| Engine Speed | > 500 RPM | Engine considered "on" |
| Engine Speed | > 1500 RPM | Engine at harvest operating speed |
| Rotor/Drum Speed | > 500 RPM | Rotor/drum considered "on" |
| Feeder Speed | > 200 RPM | Feeder actively running |
| Fan Speed | > 500 RPM | Cleaning fan active |
| Ground Speed | > 0.5 km/h | Machine is moving (harvest) |
| Ground Speed | > 2.0 km/h | Machine at road travel speed |
| Working Width | > 1.0 m | Header is deployed (harvest mode) |
| Working Width | ≤ 0.3 m | Header folded (road mode) |
| Dry Flow | > 0.36 t/hr | Grain actively flowing (harvest) |
| Dry Flow | ≤ 0.20 t/hr | No grain flow (road mode) |
| Staleness | 10 minutes | Data older than this → "Unknown" state |

---

## State Timeline Engine

The most powerful part of the KPI system is the **state timeline** — a second-by-second reconstruction of what the machine was doing.

### How It Works

1. **Collect all timestamps** from key series: Battery Voltage, Engine Speed, Rotor Speed, Dry Flow, Feeder Speed, Fan Speed, Ground Speed, Working Width
2. **Add staleness boundaries** — 10 minutes after each sample, the data is considered "stale"
3. **Add day boundaries** — helps identify overnight gaps
4. **For each time segment**, sample the most recent value of each key series using Zero-Order Hold (ZOH)
5. **Classify each segment** into one or more states:

| State | Condition |
|-------|-----------|
| **Unknown** | No fresh telemetry data within 10-minute staleness window |
| **Power On** | At least one key series has fresh data |
| **Engine On** | Power On + Engine Speed > 500 RPM |
| **Engine Idle** | Power On + Engine Speed ≤ 500 RPM |
| **Rotor On** | Power On + Rotor Speed > 500 RPM |
| **Harvest On** | Engine On + all harvest conditions met simultaneously |
| **Road On** | Engine On + road conditions met (speed > 2 km/h, no grain flow, narrow width) |

### Zero-Order Hold (ZOH)

Between sensor readings, the last known value is "held" constant. If the last reading is older than the staleness window (10 min), the value is considered stale and the segment is marked **Unknown**.

This approach accurately reflects how combine sensors actually work — they report periodically but the physical value persists between reports.

---

## Counter vs State — Explained

The dashboard calculates many values in **two independent ways**, then compares them as a data-quality check.

### State-Derived Values

The dashboard analyses live sensor readings (engine RPM, rotor speed, grain flow, etc.) and reconstructs when the machine was actually running, harvesting, or on the road — second by second.

**Example:** "Engine RPM was above 500 for 8.300 hours total, so **Engine Running Hours (State) = 8.300 hrs**."

### Counter-Derived Values

The combine keeps running totals (like an odometer). The dashboard reads the counter at the start and end of the data window and takes the difference.

**Example:** "Engine hours counter went from 1,204.5 to 1,212.7, so **Counter = 8.200 hrs**."

### Why Both?

- If they **agree closely** (within ~15 minutes), confidence is high → **Good** badge
- If they **disagree** significantly, something needs checking → **Check** badge
- Common causes of disagreement: telemetry gaps, counter resets, data replay artifacts

### Counter Handling — Advanced Details

The counter delta engine handles:
- **Resets**: If a counter goes backward, the reset is detected and the new value is used going forward
- **Replay detection**: If data is replayed (same records re-sent), the High Water Mark (HWM) algorithm prevents double-counting
- **Tick quantization**: Counters that increment in discrete steps (e.g. 0.1 hour ticks) are snapped to tick multiples when near rate limits
- **State-aware attribution**: Counter increments are apportioned only to time segments that match the expected machine state (e.g. engine-on hours only count during engine-on segments)

---

## Badge Meanings

| Badge | Meaning |
|-------|---------|
| <span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:12px;border:1px solid #bbf7d0">Good</span> | Data looks complete and reliable. You can trust this number. |
| <span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:12px;border:1px solid #fde68a">Check</span> | Calculated but there may be telemetry gaps, counter resets, or state-vs-counter disagreement. Worth cross-referencing. |
| <span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:12px;border:1px solid #fecaca">Missing</span> | Not enough data to compute this value. Shows a dash (—) instead. Normal — not every model exports every signal. |

---

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Charts | [Plotly.js](https://plotly.com/javascript/) | 2.35.2 |
| Maps | [Leaflet](https://leafletjs.com/) | 1.9.4 |
| Satellite Tiles | Google Maps (Hybrid), ESRI World Imagery (fallback), OpenStreetMap |
| Styling | Custom CSS (inline) | — |
| Architecture | Single-file HTML application | — |
| Hosting | GitHub Pages | — |
| Server | None (100% client-side) | — |

---

## Deployment

### GitHub Pages (recommended)

1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Set Source to **Deploy from a branch**
4. Select **main** branch, **/ (root)** folder
5. Click **Save**
6. Your app will be live at `https://FarmerChazman.github.io/Harvester-Performance-Analyser/`

### Self-Hosting

Copy `index.html` to any static file server (Nginx, Apache, S3, Cloudflare Pages, Vercel, Netlify, etc.). No server-side processing is required.

### Offline Use

Download `index.html` and open it directly in a browser. The only external dependencies are the Plotly and Leaflet CDN links — if you're offline, cache these files locally or use a bundled version.

---

## Contributing

Contributions are welcome! Areas where help is appreciated:

- Additional combine models / telemetry formats
- Improved responsive design for mobile devices
- Internationalisation (i18n) for non-English users
- Web Worker integration for even larger file handling
- Additional KPI calculations (e.g. fuel efficiency bands, loss trend analysis)

### Development

Since this is a single HTML file, development is straightforward:

1. Clone the repo
2. Open `index.html` in a browser
3. Edit with any text editor / IDE
4. Refresh to see changes

No build step, no package manager, no transpilation. Just HTML, CSS and JavaScript.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <em>Built for the Australian grain harvest season 🌾</em>
</p>
