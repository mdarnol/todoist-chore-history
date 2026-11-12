class FamilyPhotoWall extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.panels = [null, null];
    this.queues = [[], []];
    this.cycling = [false, false];
  }

  setConfig(config) {
    if (!config.immich_url) throw new Error("Set immich_url.");
    if (!config.immich_api_key) throw new Error("Set immich_api_key.");
    if (!config.album_name) throw new Error("Set album_name.");
    this.config = config;
    this.render();
  }

  connectedCallback() {
    void this.cycle(0);
    void this.cycle(1);
    const seconds = (this.config?.display_time || 60) * 1000;
    this.timers = [
      setInterval(() => void this.cycle(0), seconds),
      setInterval(() => void this.cycle(1), seconds),
    ];
  }

  disconnectedCallback() {
    (this.timers || []).forEach(clearInterval);
    this.panels.forEach(panel => panel?.url && URL.revokeObjectURL(panel.url));
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.config.immich_url}${path}`, {
      ...options,
      headers: {
        "x-api-key": this.config.immich_api_key,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`Immich returned HTTP ${response.status}`);
    return response;
  }

  async albumId() {
    if (this.resolvedAlbumId) return this.resolvedAlbumId;
    const albums = await (await this.request("/albums")).json();
    const match = albums.find(album =>
      album.albumName?.toLowerCase() === this.config.album_name.toLowerCase());
    if (!match) throw new Error(`No Immich album named "${this.config.album_name}"`);
    this.resolvedAlbumId = match.id;
    return match.id;
  }

  async fill(index) {
    const albumId = await this.albumId();
    const other = this.panels[1 - index]?.asset.id;
    for (let attempt = 0; attempt < 4 && this.queues[index].length === 0; attempt++) {
      const assets = await (await this.request("/search/random", {
        method: "POST",
        body: JSON.stringify({ albumIds: [albumId], withExif: true, type: "IMAGE", size: 30 }),
      })).json();
      this.queues[index] = assets.filter(asset => {
        const height = asset.exifInfo?.exifImageHeight ?? asset.height;
        const width = asset.exifInfo?.exifImageWidth ?? asset.width;
        return height > width && asset.id !== other;
      });
    }
  }

  async cycle(index) {
    if (!this.config || this.cycling[index]) return;
    this.cycling[index] = true;
    try {
      if (this.queues[index].length === 0) await this.fill(index);
      const asset = this.queues[index].shift();
      if (!asset) return;
      const blob = await (await this.request(`/assets/${asset.id}/thumbnail?size=preview`)).blob();
      const url = URL.createObjectURL(blob);
      const previous = this.panels[index]?.url;
      this.panels[index] = { asset, url };
      this.renderPanel(index);
      if (previous) URL.revokeObjectURL(previous);
    } catch {
      // Keep showing the current photo; the next interval will retry.
    } finally {
      this.cycling[index] = false;
    }
  }

  location(exif) {
    const parts = [];
    if (exif?.city) parts.push(exif.city);
    if (exif?.state) parts.push(exif.state);
    else if (exif?.country) parts.push(exif.country);
    return parts.join(", ");
  }

  date(exif) {
    if (!exif?.dateTimeOriginal) return "";
    return new Date(exif.dateTimeOriginal).toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric",
    });
  }

  renderPanel(index) {
    const panel = this.panels[index];
    const img = this.shadowRoot.querySelector(`[data-panel="${index}"] img`);
    const caption = this.shadowRoot.querySelector(`[data-panel="${index}"] .caption`);
    if (!panel || !img || !caption) return;
    img.src = panel.url;
    const lines = [this.location(panel.asset.exifInfo), this.date(panel.asset.exifInfo)].filter(Boolean);
    caption.innerHTML = lines.map(line => `<div>${line}</div>`).join("");
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { position: fixed; inset: 0; display: block; }
        .wall { display: flex; width: 100vw; height: 100vh; background: #000; }
        .panel { flex: 1; position: relative; overflow: hidden; background: #000; }
        .panel img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .caption {
          position: absolute; bottom: 28px; left: 0; right: 0; text-align: center;
          color: #ffffff; font-size: 1.15rem; font-weight: 300; line-height: 1.4;
          text-shadow: 0 2px 10px rgba(0, 0, 0, 0.65);
        }
        .caption div:first-child { font-weight: 400; }
      </style>
      <div class="wall">
        <div class="panel" data-panel="0"><img alt=""><div class="caption"></div></div>
        <div class="panel" data-panel="1"><img alt=""><div class="caption"></div></div>
      </div>
    `;
    this.renderPanel(0);
    this.renderPanel(1);
  }
}

customElements.define("family-photo-wall", FamilyPhotoWall);
