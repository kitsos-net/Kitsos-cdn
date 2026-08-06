const DEFAULT_CLOUDFLARE_LOCATIONS_URL =
  "https://speed.cloudflare.com/locations";

const LOCATION_CACHE_PREFIX =
  "ha-access-info-card:cloudflare-locations:v1:";

const LOCATION_CACHE_MAX_AGE_MS =
  7 * 24 * 60 * 60 * 1000;

const locationRequests = new Map();

function cacheKeyFor(url) {
  let hash = 2166136261;

  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${LOCATION_CACHE_PREFIX}${(hash >>> 0).toString(16)}`;
}

function readLocationCache(url, allowExpired = false) {
  try {
    const raw = localStorage.getItem(cacheKeyFor(url));

    if (!raw) {
      return null;
    }

    const cached = JSON.parse(raw);

    if (
      !cached ||
      !Array.isArray(cached.locations) ||
      typeof cached.savedAt !== "number"
    ) {
      return null;
    }

    const expired =
      Date.now() - cached.savedAt > LOCATION_CACHE_MAX_AGE_MS;

    if (expired && !allowExpired) {
      return null;
    }

    return cached.locations;
  } catch {
    return null;
  }
}

function writeLocationCache(url, locations) {
  try {
    localStorage.setItem(
      cacheKeyFor(url),
      JSON.stringify({
        savedAt: Date.now(),
        locations,
      }),
    );
  } catch {
    // Die Karte funktioniert auch ohne Local-Storage-Cache.
  }
}

function createLocationMap(locations) {
  const map = new Map();

  for (const location of locations) {
    const iata =
      typeof location?.iata === "string"
        ? location.iata.toUpperCase()
        : "";

    if (!/^[A-Z0-9]{3}$/.test(iata)) {
      continue;
    }

    map.set(iata, {
      city:
        typeof location.city === "string"
          ? location.city
          : null,

      countryCode:
        typeof location.cca2 === "string"
          ? location.cca2.toUpperCase()
          : null,

      region:
        typeof location.region === "string"
          ? location.region
          : null,
    });
  }

  return map;
}

async function loadCloudflareLocations(url) {
  const freshCache = readLocationCache(url);

  if (freshCache) {
    return createLocationMap(freshCache);
  }

  if (locationRequests.has(url)) {
    return locationRequests.get(url);
  }

  const request = (async () => {
    try {
      const response = await fetch(url, {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        credentials: "omit",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const locations = await response.json();

      if (!Array.isArray(locations)) {
        throw new Error(
          "Ungültige Cloudflare-Standortliste",
        );
      }

      writeLocationCache(url, locations);

      return createLocationMap(locations);
    } catch (error) {
      /*
       * Falls Cloudflare vorübergehend nicht erreichbar ist,
       * wird auch ein abgelaufener Cache weiterverwendet.
       */
      const staleCache = readLocationCache(url, true);

      if (staleCache) {
        return createLocationMap(staleCache);
      }

      console.warn(
        "HA-Zugriffsweg: Cloudflare-Standortliste konnte nicht geladen werden.",
        error,
      );

      return new Map();
    } finally {
      locationRequests.delete(url);
    }
  })();

  locationRequests.set(url, request);

  return request;
}

class HAAccessInfoCard extends HTMLElement {
  constructor() {
    super();

    this._config = {};
    this._hass = null;
    this._timer = undefined;
    this._requestNumber = 0;
  }

  static getStubConfig() {
    return {
      title: "Home Assistant Zugriff",
      local_host: "local.ha-mtk.kitsos.net",
      remote_host: "ha-mtk.kitsos.net",
      refresh_seconds: 300,
      locations_url:
        DEFAULT_CLOUDFLARE_LOCATIONS_URL,
    };
  }

  set hass(hass) {
    this._hass = hass;
  }

  setConfig(config) {
    if (!config) {
      throw new Error("Konfiguration fehlt");
    }

    this._config = {
      title:
        config.title ||
        "Home Assistant Zugriff",

      local_host: (
        config.local_host ||
        "local.ha-mtk.kitsos.net"
      ).toLowerCase(),

      remote_host: (
        config.remote_host ||
        "ha-mtk.kitsos.net"
      ).toLowerCase(),

      refresh_seconds: Math.max(
        30,
        Number(config.refresh_seconds) || 300,
      ),

      locations_url:
        config.locations_url ||
        DEFAULT_CLOUDFLARE_LOCATIONS_URL,
    };

    this._restartTimer();
    this._update();
  }

  connectedCallback() {
    this._restartTimer();
    this._update();
  }

  disconnectedCallback() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    return {
      rows: 2,
      columns: full,
      min_rows: 2,
    };
  }

  _restartTimer() {
    if (
      !this.isConnected ||
      !this._config.refresh_seconds
    ) {
      return;
    }

    if (this._timer) {
      clearInterval(this._timer);
    }

    this._timer = setInterval(
      () => this._update(),
      this._config.refresh_seconds * 1000,
    );
  }

  async _update() {
    if (
      !this._config.local_host ||
      !this._config.remote_host
    ) {
      return;
    }

    const requestNumber = ++this._requestNumber;

    const currentHost =
      window.location.hostname.toLowerCase();

    /*
     * Lokaler Zugriff
     */
    if (currentHost === this._config.local_host) {
      this._render({
        mode: "Lokal",
        detail: currentHost,
        badge: "LAN",
        icon: "mdi:home-lan",
        tone: "local",
      });

      return;
    }

    /*
     * Unbekannte Domain
     */
    if (currentHost !== this._config.remote_host) {
      this._render({
        mode: "Unbekannter Zugriffsweg",
        detail:
          currentHost ||
          "Kein Hostname erkannt",
        badge: "?",
        icon: "mdi:help-network-outline",
        tone: "unknown",
      });

      return;
    }

    /*
     * Remote-Zugriff
     */
    this._render({
      mode: "Remote über Cloudflare",
      detail:
        `${currentHost} · ` +
        "Rechenzentrum wird ermittelt …",
      badge: "…",
      icon: "mdi:cloud-lock-outline",
      tone: "remote",
    });

    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      5000,
    );

    try {
      /*
       * Same-Origin-Aufruf:
       * Der Trace wird wirklich vom aktuellen Browser
       * über ha-mtk.kitsos.net abgerufen.
       */
      const response = await fetch(
        `/cdn-cgi/trace?_=${Date.now()}`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: {
            Accept: "text/plain",
          },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`,
        );
      }

      const trace = this._parseTrace(
        await response.text(),
      );

      const colo = String(
        trace.colo || "",
      ).toUpperCase();

      if (!/^[A-Z0-9]{3}$/.test(colo)) {
        throw new Error(
          "In der Trace-Antwort fehlt ein gültiges colo",
        );
      }

      if (
        requestNumber !== this._requestNumber
      ) {
        return;
      }

      /*
       * Code sofort anzeigen, damit die zusätzliche
       * Standortabfrage die Karte nicht verzögert.
       */
      this._renderRemote(
        currentHost,
        colo,
        null,
      );

      const locations =
        await loadCloudflareLocations(
          this._config.locations_url,
        );

      if (
        requestNumber !== this._requestNumber
      ) {
        return;
      }

      this._renderRemote(
        currentHost,
        colo,
        locations.get(colo) || null,
      );
    } catch (error) {
      if (
        requestNumber !== this._requestNumber
      ) {
        return;
      }

      const reason =
        error instanceof DOMException &&
        error.name === "AbortError"
          ? "Zeitüberschreitung"
          : "Abruf fehlgeschlagen";

      this._render({
        mode: "Remote über Cloudflare",
        detail:
          `${currentHost} · ` +
          `Colo nicht verfügbar (${reason})`,
        badge: "CF ?",
        icon: "mdi:cloud-alert-outline",
        tone: "error",
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  _renderRemote(host, colo, location) {
    const locationName = location
      ? this._formatLocation(location)
      : null;

    this._render({
      mode: "Remote über Cloudflare",

      detail: locationName
        ? `${host} · ${locationName} (${colo})`
        : `${host} · Cloudflare-Colo ${colo}`,

      badge: colo,
      icon: "mdi:cloud-lock-outline",
      tone: "remote",
    });
  }

  _formatLocation(location) {
    const parts = [];

    if (location.city) {
      parts.push(location.city);
    }

    if (location.countryCode) {
      let country = location.countryCode;

      try {
        const language =
          this._hass?.locale?.language ||
          document.documentElement.lang ||
          navigator.language ||
          "de";

        country =
          new Intl.DisplayNames(
            [language],
            {
              type: "region",
            },
          ).of(location.countryCode) ||
          location.countryCode;
      } catch {
        /*
         * Auf alten Browsern bleibt der
         * ISO-Ländercode stehen.
         */
      }

      parts.push(country);
    }

    return parts.join(", ");
  }

  _parseTrace(text) {
    const result = {};

    for (
      const line of text.split(/\r?\n/)
    ) {
      const separator =
        line.indexOf("=");

      if (separator <= 0) {
        continue;
      }

      const key = line
        .slice(0, separator)
        .trim();

      const value = line
        .slice(separator + 1)
        .trim();

      result[key] = value;
    }

    return result;
  }

  _escape(value) {
    return String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[character],
    );
  }

  _render({
    mode,
    detail,
    badge,
    icon,
    tone,
  }) {
    const title = this._escape(
      this._config.title ||
      "Home Assistant Zugriff",
    );

    this.innerHTML = `
      <style>
        ha-card {
          height: 100%;
          box-sizing: border-box;
          padding: 16px;
        }

        .content {
          display: flex;
          align-items: center;
          gap: 14px;
          min-height: 72px;
        }

        .icon-container {
          display: grid;
          place-items: center;
          flex: 0 0 48px;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background:
            var(--secondary-background-color);
        }

        ha-icon {
          --mdc-icon-size: 26px;
          color: var(--primary-color);
        }

        .local ha-icon {
          color:
            var(--success-color, #43a047);
        }

        .error ha-icon {
          color:
            var(--error-color, #db4437);
        }

        .text {
          min-width: 0;
          flex: 1 1 auto;
        }

        .title {
          margin-bottom: 3px;
          overflow: hidden;
          color:
            var(--secondary-text-color);
          font-size: 13px;
          line-height: 18px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .mode {
          overflow: hidden;
          color:
            var(--primary-text-color);
          font-size: 17px;
          font-weight: 600;
          line-height: 22px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .detail {
          margin-top: 3px;
          overflow: hidden;
          color:
            var(--secondary-text-color);
          font-size: 12px;
          line-height: 17px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .badge {
          flex: 0 0 auto;
          padding: 6px 9px;
          border-radius: 999px;
          background:
            var(--secondary-background-color);
          color:
            var(--primary-text-color);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
        }
      </style>

      <ha-card>
        <div
          class="content ${this._escape(tone)}"
        >
          <div class="icon-container">
            <ha-icon
              icon="${this._escape(icon)}"
            ></ha-icon>
          </div>

          <div class="text">
            <div class="title">
              ${title}
            </div>

            <div class="mode">
              ${this._escape(mode)}
            </div>

            <div class="detail">
              ${this._escape(detail)}
            </div>
          </div>

          <div class="badge">
            ${this._escape(badge)}
          </div>
        </div>
      </ha-card>
    `;
  }
}

if (
  !customElements.get(
    "ha-access-info-card",
  )
) {
  customElements.define(
    "ha-access-info-card",
    HAAccessInfoCard,
  );
}

window.customCards =
  window.customCards || [];

if (
  !window.customCards.some(
    (card) =>
      card.type ===
      "ha-access-info-card",
  )
) {
  window.customCards.push({
    type: "ha-access-info-card",
    name: "HA-Zugriffsweg",
    description:
      "Zeigt lokalen oder entfernten Zugriff und das Cloudflare-Colo.",
    preview: true,
  });
}
