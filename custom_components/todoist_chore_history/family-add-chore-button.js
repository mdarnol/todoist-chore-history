class FamilyAddChoreButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    if (!config.entity?.startsWith("todo.")) throw new Error("Set a todo entity.");
    this.config = config;
    this.render();
  }

  set hass(hass) {
    this.home = hass;
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
    if (this.config.default_due === "today") {
      due.value = new Date().toLocaleDateString("en-CA");
    }
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
      } catch {
        error.textContent = "Could not add this chore. Try again.";
        error.hidden = false;
        save.disabled = false;
      }
    });
    this.shadowRoot.append(dialog);
    dialog.showModal();
  }

  render() {
    this.shadowRoot.innerHTML = `<style>
      :host { display:block; color:var(--primary-text-color); }
      button { font:inherit; cursor:pointer; width:100%; padding:8px 0; min-height:40px;
        border:1px dashed var(--divider-color); border-radius:8px; background:none;
        color:inherit; font-weight:600; }
      button:hover { background:var(--divider-color); }
      .chore-editor { box-sizing:border-box; width:min(480px, calc(100vw - 32px));
        border:1px solid var(--divider-color); border-radius:12px; padding:20px;
        color:var(--primary-text-color); background:var(--card-background-color, white); }
      .chore-editor::backdrop { background:rgb(0 0 0 / .5); }
      .chore-editor label { display:grid; gap:4px; margin:12px 0; }
      .chore-editor input, .chore-editor textarea { font:inherit; color:inherit;
        background:var(--secondary-background-color); border:1px solid var(--divider-color);
        border-radius:4px; padding:8px; }
      .chore-editor footer { display:flex; justify-content:flex-end; gap:12px; }
      .chore-editor footer button { width:auto; min-height:auto; padding:0 12px; border:0;
        color:var(--primary-color); }
      [role="alert"] { color:var(--error-color, #b00020); margin:8px 0 0; }
    </style><button type="button">+ Add chore</button>`;
    this.shadowRoot.querySelector("button").addEventListener("click", () => this.add());
  }

  getCardSize() {
    return 1;
  }
}
customElements.define("family-add-chore-button", FamilyAddChoreButton);
