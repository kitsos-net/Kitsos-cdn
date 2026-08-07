class DoorPeriodLogCard extends HTMLElement {
  constructor() {
    super();

    this._hass = null;
    this._config = null;
    this._collection = null;
    this._unsubscribe = null;
    this._retryTimer = null;
    this._request = 0;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("entity fehlt");
    }

    this._config = {
      collection_key: "energy_villa_stats",
      ...config,
    };

    this._connect();
  }

  set hass(hass) {
    this._hass = hass;
    this._connect();
  }

  connectedCallback() {
    this._connect();
  }

  disconnectedCallback() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }

    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  getCardSize() {
    return 6;
  }

  _connect() {
    if (!this.isConnected || !this._hass || !this._config) {
      return;
    }

    const connectionKey = `_${this._config.collection_key}`;
    const collection = this._hass.connection[connectionKey];

    if (!collection) {
      if (!this._retryTimer) {
        this._retryTimer = setTimeout(() => {
          this._retryTimer = null;
          this._connect();
        }, 250);
      }

      return;
    }

    if (this._collection === collection && this._unsubscribe) {
      return;
    }

    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }

    this._collection = collection;

    this._unsubscribe = collection.subscribe((data) => {
      const start = data.start;
      const end = data.end || new Date();

      this._load(start, end);
    });
  }

  async _load(start, end) {
    const request = ++this._request;

    this.innerHTML = `
      <ha-card>
        <div style="padding:16px;">
          Lade Türverlauf …
        </div>
      </ha-card>
    `;

    const startIso = encodeURIComponent(start.toISOString());
    const endIso = encodeURIComponent(end.toISOString());
    const entity = encodeURIComponent(this._config.entity);

    const path =
      `history/period/${startIso}` +
      `?filter_entity_id=${entity}` +
      `&end_time=${endIso}`;

    try {
      const response = await this._hass.callApi("GET", path);

      if (request !== this._request) {
        return;
      }

      const history = response?.[0] || [];
      const events = [];

      for (const item of history) {
        if (
          item.state !== "on" &&
          item.state !== "off"
        ) {
          continue;
        }

        if (!item.last_changed) {
          continue;
        }

        const time = new Date(item.last_changed);

        // Alte Zustände, die HA nur als Ausgangszustand
        // vor dem gewählten Zeitraum mitsendet, ignorieren.
        if (time < start || time > end) {
          continue;
        }

        events.push({
          state: item.state,
          time,
        });
      }

      events.sort(
        (a, b) => b.time.getTime() - a.time.getTime()
      );

      const dateFormatter = new Intl.DateTimeFormat("de-DE", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const rangeFormatter = new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      const range =
        `${rangeFormatter.format(start)} – ` +
        `${rangeFormatter.format(end)}`;

      if (events.length === 0) {
        this.innerHTML = `
          <ha-card>
            <style>
              .content {
                padding: 16px;
              }

              .range {
                color: var(--secondary-text-color);
                margin-bottom: 12px;
              }
            </style>

            <div class="content">
              <div class="range">${range}</div>
              Keine Auf-/Zu-Ereignisse in diesem Zeitraum gefunden.
            </div>
          </ha-card>
        `;

        return;
      }

      const rows = events
        .map((event) => {
          const opened = event.state === "on";

          return `
            <div class="event">
              <ha-icon
                icon="${opened ? "mdi:door-open" : "mdi:door-closed"}"
              ></ha-icon>

              <div class="state">
                ${opened ? "Geöffnet" : "Geschlossen"}
              </div>

              <div class="time">
                ${dateFormatter.format(event.time)}
              </div>
            </div>
          `;
        })
        .join("");

      this.innerHTML = `
        <ha-card>
          <style>
            .range {
              padding: 16px;
              color: var(--secondary-text-color);
            }

            .event {
              display: grid;
              grid-template-columns: 32px 1fr auto;
              align-items: center;
              gap: 10px;
              padding: 12px 16px;
              border-top: 1px solid var(--divider-color);
            }

            .state {
              font-weight: 500;
            }

            .time {
              color: var(--secondary-text-color);
              text-align: right;
            }

            .notice {
              padding: 12px 16px 16px;
              border-top: 1px solid var(--divider-color);
              color: var(--secondary-text-color);
              font-size: 0.9em;
            }

            @media (max-width: 500px) {
              .event {
                grid-template-columns: 32px 1fr;
              }

              .time {
                grid-column: 2;
                text-align: left;
              }
            }
          </style>

          <div class="range">
            ${range}
          </div>

          ${rows}

          <div class="notice">
            Die Detail-Liste kann nur Ereignisse anzeigen,
            die noch im Home-Assistant-Recorder vorhanden sind.
          </div>
        </ha-card>
      `;
    } catch (error) {
      console.error("DoorPeriodLogCard", error);

      this.innerHTML = `
        <ha-card>
          <div style="padding:16px;">
            Türverlauf konnte nicht geladen werden.
          </div>
        </ha-card>
      `;
    }
  }
}

if (!customElements.get("door-period-log-card")) {
  customElements.define(
    "door-period-log-card",
    DoorPeriodLogCard
  );
}
