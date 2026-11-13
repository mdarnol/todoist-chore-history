class FamilyChoreColumns extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.items = [];
    this.completed = [];
    this.pending = new Set();
    this.awaitingHistory = new Map();
    this.reopened = new Map();
  }

  setConfig(config) {
    if (!config.entity?.startsWith("todo.")) throw new Error("Set a todo entity.");
    if (this.config?.entity !== config.entity) {
      this.awaitingHistory.clear();
      this.reopened.clear();
    }
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
      if (entity !== this.config.entity) return;
      const historyItems = history?.response?.items;
      if (Array.isArray(historyItems)) {
        this.completed = historyItems.map(item => ({
          ...item, completedAt: Date.parse(item.completedAt), completedAtRaw: item.completedAt,
        }));
        for (const item of this.completed) {
          const waiting = this.awaitingHistory.get(item.uid);
          if (waiting && item.completedAt >= waiting.completedAt - 10000) {
            this.awaitingHistory.delete(item.uid);
          }
        }
      }
      for (const [uid, item] of this.awaitingHistory) {
        if (item.completedAt < Date.now() - 86400000) this.awaitingHistory.delete(uid);
      }
      for (const [uid, completedAt] of this.reopened) {
        const stillSuppressed = this.completed.some(row => row.uid === uid && row.completedAt === completedAt);
        if (!stillSuppressed) this.reopened.delete(uid);
      }
      const items = result.response?.[entity]?.items;
      if (!Array.isArray(items)) throw new Error("Missing list response");
      if (entity === this.config.entity) this.items = items;
      this.error = Array.isArray(historyItems) ? "" : "Todoist completion history is unavailable.";
    } catch {
      this.error = "Could not load chores. Retrying automatically.";
    } finally {
      this.loading = false;
      this.render();
    }
  }

  formatDateOnly(dateStr, options) {
    if (!dateStr) return "";
    const [year, month, day] = dateStr.slice(0, 10).split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, options);
  }

  withAlpha(hex, alpha) {
    if (!hex) return "transparent";
    const value = hex.replace("#", "");
    const bigint = parseInt(value, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  animateMove(uid, fromRect) {
    if (!fromRect) return;
    const toRow = this.shadowRoot.querySelector(`[data-uid="${uid}"]`);
    if (!toRow) return;
    const toRect = toRow.getBoundingClientRect();
    const dx = fromRect.left - toRect.left;
    const dy = fromRect.top - toRect.top;
    if (!dx && !dy) return;
    toRow.style.position = "relative";
    toRow.style.zIndex = "1";
    toRow.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      toRow.style.transition = "transform 280ms ease";
      toRow.style.transform = "translate(0, 0)";
    });
    toRow.addEventListener("transitionend", () => {
      toRow.style.transition = "";
      toRow.style.transform = "";
      toRow.style.position = "";
      toRow.style.zIndex = "";
    }, { once: true });
  }

  async reopen(item) {
    if (this.pending.has(item.uid)) return;
    this.pending.add(item.uid);
    const uid = String(item.uid);
    const fromRow = this.shadowRoot.querySelector(`[data-uid="${uid}"]`);
    const fromRect = fromRow?.getBoundingClientRect();
    const previousCompleted = this.completed;
    const previousItems = this.items;
    const previousAwaiting = new Map(this.awaitingHistory);

    this.reopened.set(uid, item.completedAt);
    this.completed = this.completed.filter(row => row.uid !== uid);
    this.awaitingHistory.delete(uid);
    this.items = [...this.items.filter(row => row.uid !== item.uid), {
      ...item, uid, status: "needs_action", due: item.dueDate || null,
    }];
    this.error = "";
    this.render();
    this.animateMove(uid, fromRect);

    try {
      if (item.recurring) {
        // Todoist advances a recurring task to its next due date the instant it's
        // completed — the live task was never "completed" to begin with, and per
        // Todoist's own docs a completed occurrence can't be reopened through any
        // interface. Sending a status/reopen call on it is what used to fight
        // Todoist's recurrence engine and produce a second, wrong-looking completion.
        // A plain due-date edit (no status touch) is the safe, supported way to pull
        // the live task back onto today's list.
        if (item.dueDate) {
          await this.home.callService("todo", "update_item", {
            item: item.uid, due_date: item.dueDate,
          }, { entity_id: this.config.entity });
        }
        // Todoist keeps the completion record permanently — there's no way to
        // delete it — so tell the backend to hide this specific occurrence from
        // get_recent going forward. Without this it reappears in Recently
        // Completed on the next refresh or page reload.
        if (item.completedAtRaw) {
          try {
            await this.home.callService("todoist_chore_history", "dismiss", {
              item: item.uid, completed_at: item.completedAtRaw,
            });
          } catch { /* best-effort: client-side suppression still hides it this session */ }
        }
      } else {
        await this.home.callService("todo", "update_item", {
          item: item.uid, status: "needs_action",
        }, { entity_id: this.config.entity });
        if (item.dueDate) {
          await this.home.callService("todo", "update_item", {
            item: item.uid, due_date: item.dueDate,
          }, { entity_id: this.config.entity });
        }
      }
      // Todoist's read path can briefly lag the write, so give it a moment
      // before trusting a refresh over the optimistic state above.
      setTimeout(() => void this.refresh(), 4000);
    } catch {
      this.reopened.delete(uid);
      this.completed = previousCompleted;
      this.items = previousItems;
      this.awaitingHistory = previousAwaiting;
      this.error = "Could not reopen this chore. Try again.";
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
      const uid = String(item.uid);
      if (!this.completed.some(row => row.uid === uid && row.completedAt >= Date.now() - 10000)) {
        const dueDate = item.due ? (item.due.length === 10 ? item.due : item.due.slice(0, 10)) : null;
        this.awaitingHistory.set(uid, {
          ...item, uid, completedAt: Date.now(), awaitingHistory: true, dueDate,
        });
      }
      this.items = this.items.filter(row => row.uid !== item.uid);
      this.render();
      this.error = "";
      await this.refresh();
    } catch {
      this.error = "Could not complete this chore. Try again.";
    } finally {
      this.pending.delete(item.uid);
      this.render();
    }
  }

  edit(item) {
    const dialog = document.createElement("dialog");
    dialog.className = "chore-editor";
    dialog.innerHTML = `<form>
      <h2>Edit chore</h2>
      <label>Name<input name="summary" required></label>
      <label>Description<textarea name="description" rows="5"></textarea></label>
      <label>Due date<input name="due" type="date"></label>
      <p role="alert" hidden></p>
      <footer><button type="button">Cancel</button><button type="submit">Save</button></footer>
    </form>`;
    const form = dialog.querySelector("form");
    const { summary, description, due } = form.elements;
    summary.value = item.summary;
    description.value = item.description ?? "";
    due.value = item.date ?? "";
    const originalDate = due.value;
    const entity = this.config.entity;
    const cancel = dialog.querySelector('button[type="button"]');
    const save = dialog.querySelector('button[type="submit"]');
    const error = dialog.querySelector('[role="alert"]');
    cancel.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const name = summary.value.trim();
      if (!name || (!due.value && originalDate)) {
        error.textContent = !name ? "Enter a chore name." : "Select a due date.";
        error.hidden = false;
        return;
      }
      const changes = {};
      if (name !== item.summary) changes.rename = name;
      if (description.value !== (item.description ?? "")) changes.description = description.value;
      if (due.value !== originalDate) changes.due_date = due.value;
      if (!Object.keys(changes).length) {
        dialog.close();
        return;
      }
      save.disabled = true;
      try {
        await this.home.callService("todo", "update_item", {
          item: item.uid, ...changes,
        }, { entity_id: entity });
        dialog.close();
        await this.refresh();
      } catch {
        error.textContent = "Could not save this chore. Try again.";
        error.hidden = false;
        save.disabled = false;
      }
    });
    this.shadowRoot.append(dialog);
    dialog.showModal();
  }

  add() {
    const dialog = document.createElement("dialog");
    dialog.className = "chore-editor";
    dialog.innerHTML = `<form>
      <h2>Add chore</h2>
      <label>Name<input name="summary" required></label>
      <label>Description<textarea name="description" rows="5"></textarea></label>
      <label>Due date<input name="due" type="date"></label>
      <p role="alert" hidden></p>
      <footer><button type="button">Cancel</button><button type="submit">Add</button></footer>
    </form>`;
    const form = dialog.querySelector("form");
    const { summary, description, due } = form.elements;
    const entity = this.config.entity;
    const cancel = dialog.querySelector('button[type="button"]');
    const save = dialog.querySelector('button[type="submit"]');
    const error = dialog.querySelector('[role="alert"]');
    cancel.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const name = summary.value.trim();
      if (!name) {
        error.textContent = "Enter a chore name.";
        error.hidden = false;
        return;
      }
      save.disabled = true;
      const data = { item: name };
      if (description.value) data.description = description.value;
      if (due.value) data.due_date = due.value;
      try {
        await this.home.callService("todo", "add_item", data, { entity_id: entity });
        dialog.close();
        await this.refresh();
      } catch {
        error.textContent = "Could not add this chore. Try again.";
        error.hidden = false;
        save.disabled = false;
      }
    });
    this.shadowRoot.append(dialog);
    dialog.showModal();
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
    this.todayKey = today;
    this.tomorrowKey = tomorrow;
    const buckets = [[], [], [], []];
    const completed = [...this.completed, ...this.awaitingHistory.values()]
      .filter(item => item.completedAt >= Date.now() - 86400000)
      .filter(item => this.reopened.get(String(item.uid)) !== item.completedAt)
      .sort((a, b) => b.completedAt - a.completedAt);
    for (const item of this.items) {
      if (item.status === "completed" || !item.due) continue;
      const waiting = this.awaitingHistory.get(String(item.uid));
      if (waiting?.due === item.due) continue;
      const due = item.due.length === 10 ? item.due : dateKey(new Date(item.due));
      const index = due < today ? 0 : due === today ? 1 : due === tomorrow ? 2 : due <= end ? 3 : -1;
      if (index >= 0) buckets[index].push({ ...item, date: due });
    }
    for (const bucket of buckets) bucket.sort((a, b) => a.date.localeCompare(b.date));
    return [completed, ...buckets];
  }

  render() {
    if (!this.config) return;
    if (this.shadowRoot.querySelector("dialog[open]")) return;
    this.shadowRoot.innerHTML = `<style>
      :host { display:block; color:var(--primary-text-color); }
      .columns { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); }
      section { min-width:0; padding:12px; border-inline-start:1px solid var(--divider-color); }
      section:first-child { border-inline-start:0; }
      h2 { margin:0 0 12px; font-size:1rem; }
      ul { margin:0; padding:0; list-style:none; }
      li { padding:12px 0; overflow-wrap:anywhere; }
      li + li { border-block-start:1px solid var(--divider-color); }
      .chore-title { display:block; font-size:1.125rem; font-weight:600; line-height:1.35; }
      .description { display:block; margin:4px 0 0; color:var(--secondary-text-color);
        font-size:0.95rem; line-height:1.45; white-space:pre-wrap; }
      small { display:block; margin-top:5px; color:var(--secondary-text-color); }
      button { color:inherit; font:inherit; text-align:start; cursor:pointer; background:none;
        border:0; padding:0; width:100%; min-height:44px; }
      .chore-row { display:grid; grid-template-columns:64px minmax(0,1fr); align-items:stretch; }
      .chore-check { text-align:center; font-size:2.25rem; display:flex; align-items:center;
        justify-content:center; border-radius:8px; }
      .chore-check:active:not(:disabled) { background:var(--divider-color); }
      .chore-title:is(button):hover { text-decoration:underline; }
      .chore-editor { box-sizing:border-box; width:min(480px, calc(100vw - 32px));
        border:1px solid var(--divider-color); border-radius:12px; padding:20px;
        color:var(--primary-text-color); background:var(--card-background-color, white); }
      .chore-editor::backdrop { background:rgb(0 0 0 / .5); }
      .chore-editor label { display:grid; gap:4px; margin:12px 0; }
      .chore-editor input, .chore-editor textarea { font:inherit; color:inherit;
        background:var(--secondary-background-color); border:1px solid var(--divider-color);
        border-radius:4px; padding:8px; }
      .chore-editor footer { display:flex; justify-content:flex-end; gap:12px; }
      .chore-editor button { width:auto; padding:0 12px; color:var(--primary-color); }
      .toolbar { display:flex; justify-content:flex-start; padding:12px 12px 0; }
      .add-chore { width:auto; min-height:auto; padding:8px 14px; font-weight:600;
        border:1px solid var(--divider-color); border-radius:8px; }
      .add-chore:hover { background:var(--divider-color); }
      @media(max-width:850px) {
        .columns { grid-template-columns:1fr; }
        section { border-inline-start:0; border-block-end:1px solid var(--divider-color); }
      }
    </style><div class="toolbar"><button type="button" class="add-chore">+ Add Chore</button></div><p role="status" hidden></p><div class="columns"></div>`;
    this.shadowRoot.querySelector(".add-chore").addEventListener("click", () => this.add());
    const error = this.shadowRoot.querySelector("p");
    error.hidden = !this.error;
    error.textContent = this.error ?? "";
    const columns = this.shadowRoot.querySelector(".columns");
    const groups = this.groups();
    const titles = [
      "Recently Completed", "Overdue",
      `Today (${this.formatDateOnly(this.todayKey, { month: "short", day: "numeric" })})`,
      `Tomorrow (${this.formatDateOnly(this.tomorrowKey, { month: "short", day: "numeric" })})`,
      "Next 7 Days",
    ];
    groups.forEach((items, index) => {
      const section = document.createElement("section");
      if ((index === 1 || index === 2) && this.config.color) {
        section.style.background = this.withAlpha(this.config.color, 0.2);
      }
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
        row.className = "chore-row";
        row.dataset.uid = String(item.uid);
        const finished = index === 0;
        const note = finished && (item.recurring || item.awaitingHistory);
        const check = document.createElement("button");
        check.className = "chore-check";
        check.type = "button";
        check.setAttribute("role", "checkbox");
        check.setAttribute("aria-checked", String(finished));
        check.setAttribute("aria-label", `${finished ? "Reopen" : "Complete"} ${item.summary}`);
        check.textContent = finished ? "☑" : "☐";
        check.disabled = this.pending.has(item.uid);
        check.addEventListener("click", () => void (finished ? this.reopen(item) : this.complete(item)));
        const details = document.createElement("div");
        const title = document.createElement(finished ? "span" : "button");
        title.className = "chore-title";
        title.textContent = item.summary;
        if (!finished) {
          title.type = "button";
          title.setAttribute("aria-label", `Edit ${item.summary}`);
          title.addEventListener("click", () => this.edit(item));
        }
        details.append(title);
        if (item.description?.trim()) {
          const description = document.createElement("span");
          description.className = "description";
          description.textContent = item.description;
          details.append(description);
        }
        const date = document.createElement("small");
        date.textContent = finished
          ? `Completed ${new Date(item.completedAt).toLocaleDateString()}`
          : item.date;
        details.append(date);
        if (finished && item.dueDate) {
          const due = document.createElement("small");
          due.textContent = `Due ${this.formatDateOnly(item.dueDate)}`;
          details.append(due);
        }
        if (note) {
          const status = document.createElement("small");
          status.textContent = item.awaitingHistory ? "Waiting for Todoist history" : "Recurring completion";
          details.append(status);
        }
        row.append(check, details);
        list.append(row);
      }
      section.append(list);
      columns.append(section);
    });
  }
}
customElements.define("family-chore-columns", FamilyChoreColumns);
