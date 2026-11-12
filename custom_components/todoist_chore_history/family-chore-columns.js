class FamilyChoreColumns extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.items = [];
    this.completed = [];
    this.pending = new Set();
  }

  setConfig(config) {
    if (!config.entity?.startsWith("todo.")) throw new Error("Set a todo entity.");
    this.config = config;
    this.items = [];
    this.completed = [];
    this.render();
  }

  set hass(hass) {
    this.home = hass;
    const state = hass.states[this.config?.entity]?.last_updated;
    if (state && state !== this.lastUpdated) {
      this.lastUpdated = state;
      void this.refresh();
    }
  }

  connectedCallback() {
    this.timer = setInterval(() => void this.refresh(), 30000);
    void this.refresh();
  }

  disconnectedCallback() {
    clearInterval(this.timer);
  }

  async refresh() {
    if (!this.home || !this.config || this.loading) return;
    const entity = this.config.entity;
    this.loading = true;
    try {
      const [result, history] = await Promise.all([this.home.callWS({
        type: "call_service", domain: "todo", service: "get_items",
        target: { entity_id: entity }, return_response: true,
      }), this.home.callWS({
        type: "call_service", domain: "todoist_chore_history", service: "get_recent",
        service_data: { entity_id: entity }, return_response: true,
      }).catch(() => null)]);
      this.completed = (history?.response?.items ?? []).map(item => ({
        ...item, completedAt: Date.parse(item.completedAt),
      }));
      const items = result.response?.[entity]?.items;
      if (!Array.isArray(items)) throw new Error("Missing list response");
      if (entity === this.config.entity) this.items = items;
      this.error = history ? "" : "Todoist completion history is unavailable.";
    } catch {
      this.error = "Could not load chores. Retrying automatically.";
    } finally {
      this.loading = false;
      this.render();
    }
  }

  async reopen(item) {
    if (this.pending.has(item.uid)) return;
    this.pending.add(item.uid);
    this.render();
    try {
      await this.home.callService("todoist_chore_history", "reopen", {
        entity_id: this.config.entity, item: item.uid,
      });
      this.completed = this.completed.filter(row => row.uid !== item.uid);
      await this.refresh();
    } catch {
      this.error = "Could not reopen this chore in Todoist.";
    } finally {
      this.pending.delete(item.uid);
      this.render();
    }
  }

  async complete(item) {
    if (this.pending.has(item.uid)) return;
    this.pending.add(item.uid);
    this.render();
    try {
      await this.home.callService("todo", "update_item", {
        item: item.uid, status: "completed",
      }, { entity_id: this.config.entity });
      this.items = this.items.filter(row => row.uid !== item.uid);
      this.error = "";
      await this.refresh();
    } catch {
      this.error = "Could not complete this chore. Try again.";
    } finally {
      this.pending.delete(item.uid);
      this.render();
    }
  }

  groups() {
    const zone = this.home?.config?.time_zone;
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const dateKey = date => {
      const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    };
    const today = dateKey(new Date());
    const day = offset => new Date(Date.parse(today) + offset * 86400000).toISOString().slice(0, 10);
    const tomorrow = day(1);
    const end = day(7);
    const buckets = [[], [], [], []];
    const completed = [...this.completed]
      .filter(item => item.completedAt >= Date.now() - 86400000)
      .sort((a, b) => b.completedAt - a.completedAt);
    for (const item of this.items) {
      if (item.status === "completed" || !item.due) continue;
      const due = item.due.length === 10 ? item.due : dateKey(new Date(item.due));
      const index = due < today ? 0 : due === today ? 1 : due === tomorrow ? 2 : due <= end ? 3 : -1;
      if (index >= 0) buckets[index].push({ ...item, date: due });
    }
    for (const bucket of buckets) bucket.sort((a, b) => a.date.localeCompare(b.date));
    return [completed, ...buckets];
  }

  render() {
    if (!this.config) return;
    this.shadowRoot.innerHTML = `<style>
      :host { display:block; color:var(--primary-text-color); }
      .columns { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); }
      section { min-width:0; padding:12px; border-inline-start:1px solid var(--divider-color); }
      section:first-child { border-inline-start:0; }
      h2 { margin:0 0 12px; font-size:1rem; }
      ul { margin:0; padding:0; list-style:none; }
      li { padding:8px 0; overflow-wrap:anywhere; }
      small { display:block; color:var(--secondary-text-color); }
      button { color:inherit; font:inherit; text-align:start; cursor:pointer; background:none;
        border:0; padding:4px; width:100%; }
      @media(max-width:850px) {
        .columns { grid-template-columns:1fr; }
        section { border-inline-start:0; border-block-end:1px solid var(--divider-color); }
      }
    </style><p role="status" hidden></p><div class="columns"></div>`;
    const error = this.shadowRoot.querySelector("p");
    error.hidden = !this.error;
    error.textContent = this.error ?? "";
    const columns = this.shadowRoot.querySelector(".columns");
    const titles = ["Recently Completed", "Overdue", "Today", "Tomorrow", "Next 7 Days"];
    this.groups().forEach((items, index) => {
      const section = document.createElement("section");
      const heading = document.createElement("h2");
      heading.textContent = titles[index];
      section.append(heading);
      const list = document.createElement("ul");
      if (!items.length) {
        const empty = document.createElement("li");
        empty.textContent = index === 0 ? "No chores completed in the last 24 hours." : "No chores";
        list.append(empty);
      }
      for (const item of items) {
        const row = document.createElement("li");
        const label = document.createElement(index === 0 && item.recurring ? "span" : "button");
        label.textContent = `${index === 0 ? "✓" : "☐"} ${item.summary}`;
        if (index !== 0) {
          label.disabled = this.pending.has(item.uid);
          label.setAttribute("aria-label", `Complete ${item.summary}`);
          label.addEventListener("click", () => void this.complete(item));
        }
        if (index === 0 && !item.recurring) {
          label.disabled = this.pending.has(item.uid);
          label.setAttribute("aria-label", `Reopen ${item.summary}`);
          label.addEventListener("click", () => void this.reopen(item));
        }
        row.append(label);
        const date = document.createElement("small");
        date.textContent = index === 0 ? new Date(item.completedAt).toLocaleDateString() : item.date;
        row.append(date);
        list.append(row);
      }
      section.append(list);
      columns.append(section);
    });
  }
}
customElements.define("family-chore-columns", FamilyChoreColumns);
