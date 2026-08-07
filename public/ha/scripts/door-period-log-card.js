class DoorPeriodLogCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity || !config.period_entity) {
      throw new Error("entity und period_entity werden benötigt");
    }

    this.config = config;
    this._lastKey = null;
  }

  set hass(hass) {
    this._hass = hass;

    const period =
      hass.states[this.config.period_entity]?.state ?? "Heute";

    const sourceChanged =
      hass.states[this.config.entity]?.last_changed ?? "";

    const key = `${period}|${sourceChanged}`;

    if (key !== this._lastKey) {
      this._lastKey = key;
      this._load(period);
    }
  }

  getCardSize() {
    return 5;
  }

  _getRange(period) {
    const now = new Date();

    const startOfDay = (date) => {
      const result = new Date(date);
      result.setHours(0, 0, 0, 0);
      return result;
    };

    let start;
    let end = new Date(now);

    switch (period) {
      case "Gestern":
        end = startOfDay(now);
        start = new Date(end);
        start.setDate(start.getDate() - 1);
        break;

      case "Diese Woche":
        start = startOfDay(now);
        start.setDate(
          start.getDate() - ((start.getDay() + 6) % 7)
        );
        break;

      case "Dieser Monat":
        start = new Date(
          now.getFullYear(),
          now.getMonth(),
          1
        );
        break;

      case "Dieses Jahr":
        start = new Date(
          now.getFullYear(),
          0,
          1
        );
        break;

      case "Heute":
      default:
        start = startOfDay(now);
        break;
    }

    return { start, end };
  }

  async _load(period) {
    if (!this._hass) return;

    this.innerHTML = `
      <ha-card>
        <div style="padding:16px">
          Lade Aktivitäten …
        </div>
      </ha-card>
    `;

    const { start, end } = this._getRange(period);

    const startTime = encodeURIComponent(start.toISOString());
    const endTime = encodeURIComponent(end.toISOString());
    const entity = encodeURIComponent(this.config.entity);

    const path =
      `history/period/${startTime}` +
      `?filter_entity_id=${entity}` +
      `&end_time=${endTime}` +
      `&minimal_response&no_attributes`;

    try {
      const response = await this._hass.callApi("GET", path);
      const history = response?.[0] ?? [];

      const entries = history
        .filter((item) => {
          if (!item.last_changed) return false;

          const time = new Date(item.last_changed);

          return (
            time >= start &&
            time <= end &&
            (item.state === "on" || item.state === "off")
          );
        })
        .reverse();

      if (entries.length === 0) {
        this.innerHTML = `
          <ha-card>
            <div style="padding:16px">
              Keine Türaktivität in diesem Zeitraum.
            </div>
          </ha-card>
        `;
        return;
      }

      const rows = entries
        .map((item) => {
          const time = new Date(item.last_changed);

          const formatted = new Intl.DateTimeFormat(
            "de-DE",
            {
              weekday: "short",
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit"
            }
          ).format(time);

          const state =
            item.state === "on"
              ? "Geöffnet"
              : "Geschlossen";

          const icon =
            item.state === "on"
              ? "mdi:door-open"
              : "mdi:door-closed";

          return `
            <div class="event">
              <ha-icon icon="${icon}"></ha-icon>
              <span class="state">${state}</span>
              <span class="time">${formatted}</span>
            </div>
          `;
        })
        .join("");

      this.innerHTML = `
        <ha-card>
          <style>
            .period {
              padding: 16px 16px 8px;
              color: var(--secondary-text-color);
            }

            .event {
              display: grid;
              grid-template-columns: 32px 1fr auto;
              align-items: center;
              gap: 8px;
              padding: 12px 16px;
              border-top: 1px solid var(--divider-color);
            }

            .state {
              font-weight: 500;
            }

            .time {
              color: var(--secondary-text-color);
            }
          </style>

          <div class="period">${period}</div>
          ${rows}
        </ha-card>
      `;
    } catch (error) {
      this.innerHTML = `
        <ha-card>
          <div style="padding:16px">
            Verlauf konnte nicht geladen werden.
          </div>
        </ha-card>
      `;

      console.error(error);
    }
  }
}

customElements.define(
  "door-period-log-card",
  DoorPeriodLogCard
);
