const HEADING_PARAMS = ["GPS_DIR", "Heading", "Direction"];
const SPEED_PARAMS = ["GPS_SPEED", "Ground Speed"];
const ALTITUDE_PARAMS = ["GPS_ALT", "Altitude", "GPS_ALTITUDE"];
const FIX_PARAMS = ["GPS_FIX", "Fix"];
const SATELLITE_PARAMS = ["GPS_SAT", "Satellites"];

const CORE_ALIASES = {
  "area": ["coverage area"],
  "coverage area": ["area"],
  "fuel used in field mode": ["fuel used in work", "fuel used in field"],
  "fuel used in work": ["fuel used in field mode", "fuel used in field"],
  "fuel used in road mode": ["fuel used on road", "fuel used in road"],
  "fuel used on road": ["fuel used in road mode", "fuel used in road"],
  "fuel tank level": ["fuel level"],
  "fuel level": ["fuel tank level"],
  "harvesting hours": ["threshing hours"],
  "threshing hours": ["harvesting hours"],
  "rotor drum hours": ["threshing hours", "rotor drum hrs"],
  "engine hours": ["engine hour", "enginehours"],
  "engine hours total": ["engine hours"],
  "rotor drum hours total": ["rotor drum hours"],
  "rotor drum speed": ["rotor speed"],
  "rotor speed": ["rotor drum speed"],
  "engine speed": ["engine rpm"],
  "ground speed": ["gps speed", "groundspeed", "vehicle speed"],
  "feeder speed": ["feederhouse speed", "feeder rpm"],
  "fan speed": ["cleaning fan speed", "fan rpm"],
  "chopper speed": ["straw chopper speed"],
  "straw chopper speed": ["chopper speed"],
  "dry flow average": ["dry flow", "grain flow", "dry flow instant"],
  "flow wet": ["wet yield instant"],
  "wet yield instant": ["flow wet"],
  "working width": ["cut width", "header width", "swath width"],
  "grain tank level": ["grainbin level"],
  "grainbin level": ["grain tank level"],
  "network active connection": ["network active connection status"],
  "network active connection status": ["network active connection"],
  "concave opening": ["concave opening clearance"],
  "concave opening clearance": ["concave opening"],
  "ground drive fwd pressure": ["gnd drive fwd press"],
  "gnd drive fwd press": ["ground drive fwd pressure"],
  "ground drive rev pressure": ["gnd drive rev press"],
  "gnd drive rev press": ["ground drive rev pressure"],
  "hydraulic oil temperature": ["hydraulic reservoir temp"],
  "hydraulic reservoir temp": ["hydraulic oil temperature"],
  "threshing status": ["thresher status"],
  "thresher status": ["threshing status"],
  "vane position": ["left rotor vane position", "right rotor vane position"],
  "tailings returns volume average": ["returns volume"],
  "returns volume": ["tailings returns volume average"],
  "sieve loss average": ["sieve loss"],
  "sieve loss": ["sieve loss average"],
  "cradle status": ["unload cradle status"],
  "unload cradle status": ["cradle status"]
};

const CHUNK_SIZE = 32 * 1024 * 1024;
const SMALL_FILE_LIMIT = 200 * 1024 * 1024;

self.addEventListener("message", async (event) => {
  const message = event.data || {};
  if (message.type !== "process-files") return;

  try {
    const machines = await processFiles(message.files || [], message.jobId);
    self.postMessage({ type: "complete", jobId: message.jobId, machines });
  } catch (error) {
    self.postMessage({
      type: "error",
      jobId: message.jobId,
      error: error && error.message ? error.message : String(error)
    });
  }
});

function postProgress(jobId, title, detail) {
  self.postMessage({ type: "progress", jobId, title, detail });
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function processFiles(files, jobId) {
  if (!files.length) return [];

  const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
  postProgress(
    jobId,
    `Reading ${files.length} file${files.length > 1 ? "s" : ""}...`,
    `${(totalBytes / 1048576).toFixed(1)} MB total`
  );

  const parseDetails = [];
  const machineRecords = new Map();

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const ext = String(file.name || "").split(".").pop().toLowerCase();
    const isStreamable = ["jsonl", "json", "txt", "tsv"].includes(ext);
    const useStreaming = isStreamable && file.size > SMALL_FILE_LIMIT;

    let records;
    let firstChars = "";
    let textLen = file.size || 0;

    if (useStreaming) {
      postProgress(jobId, `Streaming file ${index + 1} of ${files.length}...`, file.name);
      const probe = await file.slice(0, Math.min(200, file.size)).text();
      firstChars = probe.replace(/^\uFEFF/, "").trim().slice(0, 60);
      records = await parseRecordsStreaming(file, jobId, index, files.length);
    } else {
      postProgress(jobId, `Reading file ${index + 1} of ${files.length}...`, file.name);
      const text = await file.text();
      firstChars = text.trim().slice(0, 60);
      textLen = text.length;
      postProgress(jobId, `Parsing file ${index + 1} of ${files.length}...`, file.name);
      records = await parseRecords(text, (detail) => postProgress(jobId, `Parsing file ${index + 1} of ${files.length}...`, detail));
    }

    parseDetails.push({
      name: file.name,
      size: file.size,
      textLen,
      recordCount: records.length,
      firstChars,
      streaming: useStreaming,
      hasName: records.length > 0 && records[0].name !== undefined,
      hasTimestamp: records.length > 0 && records[0].eventTimestamp !== undefined
    });

    if (!records.length) continue;

    const machineKey = detectMachineKey(records, file.name);
    if (!machineRecords.has(machineKey)) {
      machineRecords.set(machineKey, { records: [], fileNames: [] });
    }

    const entry = machineRecords.get(machineKey);
    entry.records.push(...records);
    if (!entry.fileNames.includes(file.name)) {
      entry.fileNames.push(file.name);
    }
  }

  if (!machineRecords.size) {
    const diag = parseDetails.map((detail) =>
      `- ${detail.name} (${(detail.size / 1048576).toFixed(1)}MB${detail.streaming ? ", streamed" : ""}): ${detail.recordCount} records parsed. Starts with: "${detail.firstChars}..."`
    ).join("\n");
    throw new Error(
      `No valid records found in any file.\n\nDiagnostics:\n${diag}\n\nSupported formats: JSONL, JSON array, tab-delimited (8+ cols), CSV with headers, concatenated JSON, HTML dashboards.`
    );
  }

  const machines = [];
  let machineIndex = 0;
  for (const [machineKey, entry] of machineRecords) {
    machineIndex += 1;
    postProgress(jobId, `Processing machine ${machineIndex} of ${machineRecords.size}...`, machineKey);
    const processed = processMachineRecords(machineKey, entry.records, entry.fileNames);
    machines.push(processed);
    await tick();
  }

  return machines;
}

function detectMachineKey(records, fallbackName) {
  for (const record of records.slice(0, 50)) {
    const nickname = String(record.nickname || "").trim();
    const vin = String(record.vin || "").trim();
    if (nickname || vin) return nickname || vin;
  }
  return fallbackName || "Unknown Machine";
}

function normaliseRec(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  if (obj.textValue !== undefined && obj.stringValue === undefined) obj.stringValue = obj.textValue;
  if (obj.ceqid !== undefined && obj.id === undefined) obj.id = obj.ceqid;
  return obj;
}

function parseLine(line) {
  line = String(line || "").trim();
  if (!line) return null;

  if (line.startsWith("{")) {
    try {
      return normaliseRec(JSON.parse(line));
    } catch (error) {
      return null;
    }
  }

  const parts = line.split("\t");
  if (parts.length < 8) return null;

  const numericValue = parts[4] ? parseFloat(parts[4]) : null;
  const lat = parts.length > 8 && parts[8] ? parseFloat(parts[8]) : null;
  const lon = parts.length > 9 && parts[9] ? parseFloat(parts[9]) : null;

  return {
    id: parts[0],
    nickname: parts[1],
    vin: parts[2],
    name: parts[3],
    numericValue: Number.isFinite(numericValue) ? numericValue : null,
    stringValue: parts[5] || null,
    uom: parts[6] || "",
    eventTimestamp: parts[7],
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null
  };
}

function unwrapIfNeeded(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    for (const key of ["data", "records", "items", "rows", "results", "values"]) {
      if (Array.isArray(parsed[key]) && parsed[key].length) return parsed[key];
    }
    for (const key of Object.keys(parsed)) {
      if (Array.isArray(parsed[key]) && parsed[key].length) return parsed[key];
    }
    if (parsed.name || parsed.eventTimestamp || parsed.numericValue !== undefined) return [parsed];
  }
  return null;
}

async function parseRecordsStreaming(file, jobId, fileIndex, totalFiles) {
  const records = [];
  let leftover = "";
  let offset = 0;
  let chunkNum = 0;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    chunkNum += 1;

    postProgress(
      jobId,
      `Reading chunk ${chunkNum} of ${totalChunks}...`,
      `${file.name} | ${records.length.toLocaleString()} records | ${((end / file.size) * 100).toFixed(0)}%`
    );

    let chunk = await file.slice(offset, end).text();
    if (offset === 0 && chunk.charCodeAt(0) === 0xFEFF) chunk = chunk.slice(1);

    const combined = leftover + chunk;
    const lines = combined.split("\n");
    leftover = end < file.size ? lines.pop() || "" : "";

    for (const line of lines) {
      const record = parseLine(line);
      if (record) records.push(record);
    }

    offset = end;
    if (chunkNum % 3 === 0) await tick();
  }

  if (leftover.trim()) {
    const record = parseLine(leftover);
    if (record) records.push(record);
  }

  postProgress(jobId, `Parsing file ${fileIndex + 1} of ${totalFiles}...`, `${file.name} | ${records.length.toLocaleString()} records`);
  return records;
}

async function parseRecords(text, progressCb) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("<") || trimmed.startsWith("<!DOCTYPE") || trimmed.includes("const RAW_DATA")) {
    const extracted = extractFromHTML(trimmed);
    if (extracted.length) return extracted;
  }

  const batchSize = 20000;

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = unwrapIfNeeded(parsed);
      if (arr && arr.length) return arr.map(normaliseRec);
    } catch (error) {
      // Fall through to line-based parsing.
    }
  }

  const lines = text.split("\n");
  const records = [];

  for (let i = 0; i < lines.length; i++) {
    const record = parseLine(lines[i]);
    if (record) records.push(record);
    if (i > 0 && i % batchSize === 0) {
      progressCb(`${records.length.toLocaleString()} records parsed`);
      await tick();
    }
  }
  if (records.length) return records;

  if (/\}\s*\{/.test(trimmed)) {
    const chunks = trimmed.split(/(?<=\})\s*(?=\{)/);
    for (let i = 0; i < chunks.length; i++) {
      try {
        records.push(normaliseRec(JSON.parse(chunks[i].trim())));
      } catch (error) {
        // Skip malformed chunks.
      }
      if (i > 0 && i % batchSize === 0) {
        progressCb(`${records.length.toLocaleString()} concatenated JSON records`);
        await tick();
      }
    }
    if (records.length) return records;
  }

  if (lines.length >= 2 && lines[0].includes(",")) {
    const headerLine = lines[0].trim();
    const headerLower = headerLine.toLowerCase();
    if (headerLower.includes("name") && (headerLower.includes("timestamp") || headerLower.includes("time"))) {
      const headers = parseCSVRow(headerLine);
      const headerMap = {};
      headers.forEach((header, idx) => {
        headerMap[header.trim()] = idx;
      });
      const findCol = (...names) => {
        for (const name of names) {
          for (const header of Object.keys(headerMap)) {
            if (header.toLowerCase() === name.toLowerCase()) return headerMap[header];
          }
        }
        return -1;
      };

      const cols = {
        id: findCol("id", "ceqid"),
        nick: findCol("nickname"),
        vin: findCol("vin"),
        name: findCol("name", "parameter", "param"),
        numVal: findCol("numericValue", "numericvalue", "value", "numeric_value"),
        strVal: findCol("stringValue", "stringvalue", "textValue", "textvalue", "text_value", "string_value"),
        uom: findCol("uom", "unit"),
        ts: findCol("eventTimestamp", "eventtimestamp", "timestamp", "time", "event_timestamp"),
        lat: findCol("lat", "latitude"),
        lon: findCol("lon", "lng", "longitude")
      };

      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].trim();
        if (!row) continue;
        const parts = parseCSVRow(row);
        const get = (idx) => idx >= 0 && idx < parts.length ? parts[idx].trim() : null;
        const numericValueRaw = get(cols.numVal);
        const numericValue = numericValueRaw ? parseFloat(numericValueRaw) : null;
        const latRaw = get(cols.lat);
        const lonRaw = get(cols.lon);
        const lat = latRaw ? parseFloat(latRaw) : null;
        const lon = lonRaw ? parseFloat(lonRaw) : null;

        records.push({
          id: get(cols.id),
          nickname: get(cols.nick),
          vin: get(cols.vin),
          name: get(cols.name),
          numericValue: Number.isFinite(numericValue) ? numericValue : null,
          stringValue: get(cols.strVal),
          uom: get(cols.uom) || "",
          eventTimestamp: get(cols.ts),
          lat: Number.isFinite(lat) ? lat : null,
          lon: Number.isFinite(lon) ? lon : null
        });

        if (i > 0 && i % batchSize === 0) {
          progressCb(`${records.length.toLocaleString()} CSV records`);
          await tick();
        }
      }
      if (records.length) return records;
    }
  }

  return records;
}

function extractFromHTML(html) {
  const records = [];
  const rawMatch = html.match(/const\s+RAW_DATA\s*=\s*(\[)/);
  if (rawMatch) {
    const startIdx = rawMatch.index + rawMatch[0].length - 1;
    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < html.length && i < startIdx + 200_000_000; i++) {
      if (html[i] === "[") depth += 1;
      else if (html[i] === "]") {
        depth -= 1;
        if (depth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    if (endIdx > startIdx) {
      try {
        const rawArr = JSON.parse(html.slice(startIdx, endIdx));
        if (Array.isArray(rawArr)) {
          let nickname = "";
          let vin = "";
          const machineInfoMatch = html.match(/const\s+MACHINE_INFO\s*=\s*(\{[^;]{1,2000}\})/);
          if (machineInfoMatch) {
            try {
              const machineInfo = JSON.parse(machineInfoMatch[1]);
              nickname = machineInfo.nickname || "";
              vin = machineInfo.vin || "";
            } catch (error) {
              // Ignore malformed machine info.
            }
          }
          for (const row of rawArr) {
            if (!Array.isArray(row) || row.length < 2) continue;
            records.push({
              eventTimestamp: row[0],
              name: row[1],
              numericValue: row.length > 2 && row[2] != null && Number.isFinite(Number(row[2])) ? Number(row[2]) : null,
              stringValue: row.length > 2 && row[2] != null && !Number.isFinite(Number(row[2])) ? String(row[2]) : null,
              uom: row.length > 3 ? row[3] || "" : "",
              nickname,
              vin,
              lat: null,
              lon: null
            });
          }
        }
      } catch (error) {
        // Ignore malformed RAW_DATA payloads.
      }
    }
  }

  if (!records.length) return records;

  const gpsMatch = html.match(/const\s+GPS_EVENTS\s*=\s*(\[)/);
  if (!gpsMatch) return records;

  const gStart = gpsMatch.index + gpsMatch[0].length - 1;
  let depth = 0;
  let gEnd = gStart;
  for (let i = gStart; i < html.length && i < gStart + 200_000_000; i++) {
    if (html[i] === "[") depth += 1;
    else if (html[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        gEnd = i + 1;
        break;
      }
    }
  }

  if (!(gEnd > gStart)) return records;

  try {
    const gpsArr = JSON.parse(html.slice(gStart, gEnd));
    if (!Array.isArray(gpsArr)) return records;
    const gpsLookup = new Map();
    for (const gps of gpsArr) {
      if (gps.time && gps.lat != null && gps.lon != null) {
        gpsLookup.set(gps.time, { lat: gps.lat, lon: gps.lon });
      }
    }
    for (const record of records) {
      const gps = gpsLookup.get(record.eventTimestamp);
      if (gps) {
        record.lat = gps.lat;
        record.lon = gps.lon;
      }
    }
  } catch (error) {
    // Ignore malformed GPS payloads.
  }

  return records;
}

function parseCSVRow(row) {
  const result = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuote) {
      if (ch === '"' && row[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ",") {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result;
}

function processMachineRecords(machineKey, records, fileNames) {
  const seriesByParam = Object.create(null);
  const gpsMap = new Map();
  const allTimestamps = [];
  const previewParams = new Set([
    ...HEADING_PARAMS,
    ...SPEED_PARAMS,
    ...ALTITUDE_PARAMS,
    ...FIX_PARAMS,
    ...SATELLITE_PARAMS,
    "Engine Speed",
    "Ground Speed",
    "Dry Flow - Average",
    "Wet Yield - Average",
    "Dry Yield - Average",
    "Moisture - Average"
  ]);

  const first = records[0] || {};

  for (const rec of records) {
    const ts = rec.eventTimestamp;
    if (!ts) continue;

    const timeMs = Date.parse(ts);
    if (!Number.isFinite(timeMs)) continue;

    const paramName = rec.name;
    let value = rec.numericValue;
    const stringValue = rec.stringValue || rec.textValue;
    const uom = rec.uom || "";

    if ((value == null || value === "" || (typeof value === "number" && !Number.isFinite(value))) && stringValue != null && stringValue !== "") {
      const parsed = parseFloat(stringValue);
      if (Number.isFinite(parsed)) value = parsed;
    }

    const converted = convertUnitAndValue(value, uom);
    const timeIso = new Date(timeMs).toISOString();
    allTimestamps.push(timeMs);

    if (paramName && value != null) {
      if (!seriesByParam[paramName]) seriesByParam[paramName] = [];
      seriesByParam[paramName].push({ time: timeIso, timeMs, value: converted.value, uom: converted.uom });
    }

    const lat = rec.lat != null ? Number(rec.lat) : null;
    const lon = rec.lon != null ? Number(rec.lon) : null;
    if (!gpsMap.has(timeMs)) {
      gpsMap.set(timeMs, { time: timeIso, timeMs, lat: null, lon: null, params: [] });
    }
    const gpsEntry = gpsMap.get(timeMs);
    if (Number.isFinite(lat)) gpsEntry.lat = lat;
    if (Number.isFinite(lon)) gpsEntry.lon = lon;
    if (paramName && value != null) {
      gpsEntry.params.push({ param: paramName, value, uom });
    }
  }

  for (const arr of Object.values(seriesByParam)) {
    arr.sort((a, b) => a.timeMs - b.timeMs);
  }

  const gpsEvents = [];
  for (const entry of gpsMap.values()) {
    if (entry.lat == null || entry.lon == null) continue;
    if (Math.abs(entry.lat) > 90 || Math.abs(entry.lon) > 180) continue;
    if (entry.lat === 0 && entry.lon === 0) continue;

    const gpsData = {};
    const eventData = [];

    for (const param of entry.params) {
      const paramName = param.param;
      const value = Number(param.value);
      if (!Number.isFinite(value)) continue;

      if (gpsData.heading == null && HEADING_PARAMS.includes(paramName)) gpsData.heading = value;
      if (gpsData.speed == null && SPEED_PARAMS.includes(paramName)) gpsData.speed = value;
      if (gpsData.altitude == null && ALTITUDE_PARAMS.includes(paramName)) gpsData.altitude = value;
      if (gpsData.fix == null && FIX_PARAMS.includes(paramName)) gpsData.fix = value;
      if (gpsData.sats == null && SATELLITE_PARAMS.includes(paramName)) gpsData.sats = Math.round(value);

      if (previewParams.has(paramName)) {
        eventData.push({ param: paramName, value, uom: param.uom || "" });
      }
    }

    gpsEvents.push({
      time: entry.time,
      timeMs: entry.timeMs,
      lat: entry.lat,
      lon: entry.lon,
      gps: gpsData,
      data: eventData
    });
  }
  gpsEvents.sort((a, b) => a.timeMs - b.timeMs);

  allTimestamps.sort((a, b) => a - b);
  const startMs = allTimestamps.length ? allTimestamps[0] : Date.now();
  const endMs = allTimestamps.length ? allTimestamps[allTimestamps.length - 1] : startMs;

  const info = {
    nickname: first.nickname || machineKey || "",
    vin: first.vin || "",
    tz_offset_min: inferTzOffset(records),
    start_ts: formatUtcStamp(startMs),
    end_ts: formatUtcStamp(endMs)
  };

  const paramKeyIndex = buildParamKeyIndex(seriesByParam);
  const cfg = defaultKpiCfg();
  const rotorSpeedName = pickFirstSeriesName(seriesByParam, paramKeyIndex, ["Rotor/Drum Speed", "Rotor / Drum Speed", "Rotor Speed", "Rotor"]);
  const names = {
    engineSpeed: "Engine Speed",
    rotorSpeed: rotorSpeedName,
    dryFlow: "Dry Flow - Average",
    feederSpeed: "Feeder Speed",
    fanSpeed: "Fan Speed",
    groundSpeed: "Ground Speed",
    workingWidth: "Working Width"
  };
  const baseTimeline = buildStateTimelineFull(seriesByParam, paramKeyIndex, info, startMs, endMs, cfg, names);

  return {
    key: machineKey,
    info,
    seriesByParam,
    gpsEvents,
    allParams: Object.keys(seriesByParam).sort(),
    startMs,
    endMs,
    fileNames,
    recordCount: records.length,
    kpiContext: {
      cfg,
      names,
      baseTimeline
    }
  };
}

function convertUnitAndValue(value, uom) {
  if (value == null) return { value, uom: uom || "" };
  const unit = String(uom || "").trim().toUpperCase();
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return { value, uom: uom || "" };
  if (unit === "KG/S" || unit === "KG/SEC" || unit === "KGS") return { value: numeric * 3.6, uom: "tonne/hour" };
  if (unit === "KG/M2" || unit === "KG/M^2" || unit === "KG/M²") return { value: numeric * 10, uom: "tonne/hectare" };
  return { value: numeric, uom: uom || "" };
}

function formatUtcStamp(timeMs) {
  return new Date(timeMs).toISOString().replace("T", " ").substring(0, 19) + " UTC";
}

function inferTzOffset(records) {
  for (let i = 0; i < Math.min(records.length, 250); i++) {
    const ts = records[i].eventTimestamp || "";
    const match = ts.match(/([+-])(\d{2}):(\d{2})/);
    if (match) {
      const sign = match[1] === "+" ? 1 : -1;
      return sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10));
    }
  }
  return 0;
}

function normParamName(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildParamKeyIndex(seriesByParam) {
  const index = new Map();
  for (const key of Object.keys(seriesByParam)) {
    const normalized = normParamName(key);
    if (!index.has(normalized)) index.set(normalized, key);
  }
  return index;
}

function candidateParamKeys(seriesByParam, index, paramName) {
  const out = [];
  const seen = new Set();
  const push = (key) => {
    if (!key || seen.has(key) || !seriesByParam[key]) return;
    out.push(key);
    seen.add(key);
  };

  push(paramName);
  const normalized = normParamName(paramName);
  push(index.get(normalized));
  for (const alias of CORE_ALIASES[normalized] || []) {
    push(index.get(alias));
  }
  for (const canonical of Object.keys(CORE_ALIASES)) {
    if (canonical === normalized) continue;
    const aliases = CORE_ALIASES[canonical] || [];
    if (aliases.includes(normalized)) {
      push(index.get(canonical));
    }
  }
  return out;
}

function getSeriesAny(seriesByParam, index, paramName) {
  const keys = candidateParamKeys(seriesByParam, index, paramName);
  return keys.length ? seriesByParam[keys[0]] || [] : [];
}

function pickFirstSeriesName(seriesByParam, index, candidates) {
  for (const name of candidates) {
    const series = getSeriesAny(seriesByParam, index, name);
    if (series && series.length) return name;
  }
  return candidates[0];
}

function upperBoundMs(series, targetMs) {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].timeMs <= targetMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function zohSampleAtMs(series, timeMs, staleMs) {
  if (!series || !series.length) return { value: null, sampleMs: null, ageMs: Infinity };
  const idx = upperBoundMs(series, timeMs) - 1;
  for (let j = idx; j >= 0; j--) {
    const value = Number(series[j].value);
    const sampleMs = series[j].timeMs;
    if (!Number.isFinite(value) || !Number.isFinite(sampleMs)) continue;
    const ageMs = timeMs - sampleMs;
    return {
      value: ageMs < staleMs ? value : null,
      sampleMs,
      ageMs
    };
  }
  return { value: null, sampleMs: null, ageMs: Infinity };
}

function uniqueSortedTimesMs(values) {
  values.sort((a, b) => a - b);
  const out = [];
  let prev = null;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (prev == null || value !== prev) out.push(value);
    prev = value;
  }
  return out;
}

function addDayBoundaries(timesMs, startMs, endMs, tzOffsetMin) {
  const dayMs = 24 * 60 * 60 * 1000;
  const offsetMs = (Number(tzOffsetMin) || 0) * 60 * 1000;
  const startLocal = startMs + offsetMs;
  const endLocal = endMs + offsetMs;
  const startDay = Math.floor(startLocal / dayMs) * dayMs;
  for (let t = startDay + dayMs; t < endLocal; t += dayMs) {
    const utc = t - offsetMs;
    if (utc > startMs && utc < endMs) timesMs.push(utc);
  }
}

function guessDryFlowMin(flowSeries, cfg) {
  const uom = flowSeries && flowSeries.length ? String(flowSeries[0].uom || "").toLowerCase() : "";
  if (uom.includes("kg/s") || uom.includes("kgs")) return cfg.harvest.dryFlowMinKgS;
  return cfg.harvest.dryFlowMinTh;
}

function defaultKpiCfg() {
  return {
    staleMs: 10 * 60 * 1000,
    engineOnRpm: 500,
    rotorOnRpm: 500,
    harvest: {
      engineSpeedMinRpm: 1500,
      rotorDrumSpeedMinRpm: 500,
      dryFlowMinKgS: 0.1,
      dryFlowMinTh: 0.36,
      feederSpeedMinRpm: 200,
      fanSpeedMinRpm: 500,
      groundSpeedMinKmh: 0.5,
      workingWidthMinM: 1.0
    },
    road: {
      speedMinKmh: 2.0,
      widthMaxM: 0.3,
      dryFlowMaxTh: 0.20,
      dryFlowMaxKgS: 0.06
    },
    disagreeTolH: 0.25,
    disagreeWarnH: 0.17
  };
}

function buildStateTimelineFull(seriesByParam, paramKeyIndex, info, startMs, endMs, cfg, names) {
  const staleMs = cfg.staleMs;
  const battSeries = getSeriesAny(seriesByParam, paramKeyIndex, "Battery Voltage");
  const engSeries = getSeriesAny(seriesByParam, paramKeyIndex, names.engineSpeed);
  const rotSeries = getSeriesAny(seriesByParam, paramKeyIndex, names.rotorSpeed);
  const flowSeries = getSeriesAny(seriesByParam, paramKeyIndex, names.dryFlow);
  const feedSeries = getSeriesAny(seriesByParam, paramKeyIndex, names.feederSpeed);
  const fanSeries = getSeriesAny(seriesByParam, paramKeyIndex, names.fanSpeed);
  const spdSeries = getSeriesAny(seriesByParam, paramKeyIndex, names.groundSpeed);
  const widSeries = getSeriesAny(seriesByParam, paramKeyIndex, names.workingWidth);

  const keySeries = [
    { key: "batteryV", series: battSeries },
    { key: "engineSpeed", series: engSeries },
    { key: "rotorSpeed", series: rotSeries },
    { key: "dryFlow", series: flowSeries },
    { key: "feederSpeed", series: feedSeries },
    { key: "fanSpeed", series: fanSeries },
    { key: "groundSpeed", series: spdSeries },
    { key: "workingWidth", series: widSeries }
  ];

  const timesMs = [startMs, endMs];
  for (const keySeriesEntry of keySeries) {
    for (const point of keySeriesEntry.series || []) {
      const timeMs = point.timeMs;
      if (!(timeMs >= startMs && timeMs <= endMs)) continue;
      timesMs.push(timeMs);
      timesMs.push(Math.min(endMs, timeMs + staleMs));
    }
  }
  addDayBoundaries(timesMs, startMs, endMs, info.tz_offset_min);

  const uniq = uniqueSortedTimesMs(timesMs);
  const keyCounts = {};
  for (const keySeriesEntry of keySeries) keyCounts[keySeriesEntry.key] = (keySeriesEntry.series || []).length;
  const hasAnyKey = Object.values(keyCounts).some((count) => count > 0);

  if (uniq.length < 2) {
    return {
      segments: [],
      summary: {
        powerOnH: 0,
        engineOnH: 0,
        engineIdleH: 0,
        rotorOnH: 0,
        harvestOnH: 0,
        roadOnH: 0,
        unknownH: (endMs - startMs) / 3600000,
        roadDistanceKm: 0,
        maxUnknownRunMs: endMs - startMs
      },
      meta: { hasAnyKey, keyCounts },
      startMs,
      endMs
    };
  }

  const flowMin = guessDryFlowMin(flowSeries, cfg);
  const roadFlowMax = flowMin <= 0.2 ? cfg.road.dryFlowMaxKgS : cfg.road.dryFlowMaxTh;

  const segments = [];
  let powerOnMs = 0;
  let engineOnMs = 0;
  let engineIdleMs = 0;
  let rotorOnMs = 0;
  let harvestOnMs = 0;
  let roadOnMs = 0;
  let unknownMs = 0;
  let maxUnknownRunMs = 0;
  let currentUnknownRunMs = 0;
  let roadDistanceKm = 0;

  for (let i = 0; i < uniq.length - 1; i++) {
    const t0ms = uniq[i];
    const t1ms = uniq[i + 1];
    if (t1ms <= startMs || t0ms >= endMs) continue;
    const a0 = Math.max(t0ms, startMs);
    const a1 = Math.min(t1ms, endMs);
    const segMs = a1 - a0;
    if (!(segMs > 0)) continue;

    const vals = {};
    let lastKeySampleMs = null;
    for (const keySeriesEntry of keySeries) {
      const sample = zohSampleAtMs(keySeriesEntry.series, a0, staleMs);
      vals[keySeriesEntry.key] = sample.value;
      if (sample.sampleMs != null) {
        lastKeySampleMs = lastKeySampleMs == null ? sample.sampleMs : Math.max(lastKeySampleMs, sample.sampleMs);
      }
    }

    const unknown = lastKeySampleMs == null ? true : (a0 - lastKeySampleMs) >= staleMs;
    const powerOn = !unknown;
    const engineOn = powerOn && vals.engineSpeed != null && vals.engineSpeed > cfg.engineOnRpm;
    const engineIdle = powerOn && !engineOn;
    const rotorOn = powerOn && vals.rotorSpeed != null && vals.rotorSpeed > cfg.rotorOnRpm;
    const harvestKnown = vals.engineSpeed != null && vals.rotorSpeed != null && vals.dryFlow != null && vals.fanSpeed != null && vals.groundSpeed != null;
    const harvestOn = powerOn &&
      engineOn &&
      harvestKnown &&
      vals.engineSpeed > cfg.harvest.engineSpeedMinRpm &&
      vals.rotorSpeed > cfg.harvest.rotorDrumSpeedMinRpm &&
      vals.dryFlow > flowMin &&
      (vals.feederSpeed == null || vals.feederSpeed > cfg.harvest.feederSpeedMinRpm) &&
      vals.fanSpeed > cfg.harvest.fanSpeedMinRpm &&
      vals.groundSpeed > cfg.harvest.groundSpeedMinKmh &&
      (vals.workingWidth == null || vals.workingWidth > cfg.harvest.workingWidthMinM);
    const roadKnown = vals.groundSpeed != null && vals.dryFlow != null;
    const roadOn = powerOn &&
      engineOn &&
      roadKnown &&
      vals.groundSpeed > cfg.road.speedMinKmh &&
      (vals.workingWidth == null || vals.workingWidth <= cfg.road.widthMaxM) &&
      vals.dryFlow <= roadFlowMax &&
      !harvestOn;

    let segRoadDistanceKm = 0;
    if (roadOn && Number.isFinite(vals.groundSpeed)) {
      segRoadDistanceKm = vals.groundSpeed * (segMs / 3600000);
      roadDistanceKm += segRoadDistanceKm;
    }

    segments.push({
      t0ms: a0,
      t1ms: a1,
      ms: segMs,
      unknown,
      powerOn,
      engineOn,
      engineIdle,
      rotorOn,
      harvestOn,
      harvestKnown,
      roadOn,
      roadDistanceKm: segRoadDistanceKm,
      vals: {
        groundSpeed: vals.groundSpeed,
        workingWidth: vals.workingWidth
      }
    });

    if (unknown) {
      unknownMs += segMs;
      currentUnknownRunMs += segMs;
      if (currentUnknownRunMs > maxUnknownRunMs) maxUnknownRunMs = currentUnknownRunMs;
    } else {
      currentUnknownRunMs = 0;
    }
    if (powerOn) powerOnMs += segMs;
    if (engineOn) engineOnMs += segMs;
    if (engineIdle) engineIdleMs += segMs;
    if (rotorOn) rotorOnMs += segMs;
    if (harvestOn) harvestOnMs += segMs;
    if (roadOn) roadOnMs += segMs;
  }

  return {
    segments,
    summary: {
      powerOnH: powerOnMs / 3600000,
      engineOnH: engineOnMs / 3600000,
      engineIdleH: engineIdleMs / 3600000,
      rotorOnH: rotorOnMs / 3600000,
      harvestOnH: harvestOnMs / 3600000,
      roadOnH: roadOnMs / 3600000,
      unknownH: unknownMs / 3600000,
      roadDistanceKm,
      maxUnknownRunMs
    },
    meta: { hasAnyKey, keyCounts },
    startMs,
    endMs
  };
}
