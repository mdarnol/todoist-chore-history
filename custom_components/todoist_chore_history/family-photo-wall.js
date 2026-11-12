class FamilyPhotoWall extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.queue = [];
    this.current = null;
  }

  setConfig(config) {
    if (!config.immich_url) throw new Error("Set immich_url.");
    if (!config.immich_api_key) throw new Error("Set immich_api_key.");
    if (!config.album_name) throw new Error("Set album_name.");
    this.config = config;
    this.render();
  }

  connectedCallback() {
    void this.advance();
    const seconds = (this.config?.display_time || 60) * 1000;
    this.timer = setInterval(() => void this.advance(), seconds);
  }

  disconnectedCallback() {
    clearInterval(this.timer);
    (this.current || []).forEach(item => URL.revokeObjectURL(item.url));
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

  orientation(asset) {
    const height = asset.exifInfo?.exifImageHeight ?? asset.height;
    const width = asset.exifInfo?.exifImageWidth ?? asset.width;
    return height > width ? "portrait" : "landscape";
  }

  async fillQueue() {
    const albumId = await this.albumId();
    for (let attempt = 0; attempt < 4 && this.queue.length < 2; attempt++) {
      const assets = await (await this.request("/search/random", {
        method: "POST",
        body: JSON.stringify({ albumIds: [albumId], withExif: true, type: "IMAGE", size: 30 }),
      })).json();
      this.queue.push(...assets);
    }
  }

  async nextSlide() {
    if (this.queue.length === 0) await this.fillQueue();
    const first = this.queue.shift();
    if (!first) return null;
    if (this.orientation(first) === "landscape") return [first];

    let partnerIndex = this.queue.findIndex(asset => this.orientation(asset) === "portrait");
    if (partnerIndex === -1) {
      await this.fillQueue();
      partnerIndex = this.queue.findIndex(asset => this.orientation(asset) === "portrait");
    }
    if (partnerIndex === -1) return [first];
    const [partner] = this.queue.splice(partnerIndex, 1);
    return [first, partner];
  }

  async advance() {
    if (!this.config || this.advancing) return;
    this.advancing = true;
    try {
      const slide = await this.nextSlide();
      if (!slide) return;
      const loaded = await Promise.all(slide.map(async asset => {
        const blob = await (await this.request(`/assets/${asset.id}/thumbnail?size=preview`)).blob();
        return { asset, url: URL.createObjectURL(blob) };
      }));
      const previous = this.current;
      this.current = loaded;
      this.renderSlide();
      (previous || []).forEach(item => URL.revokeObjectURL(item.url));
    } catch {
      // Keep showing the current slide; the next interval will retry.
    } finally {
      this.advancing = false;
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

  renderSlide() {
    const wall = this.shadowRoot?.querySelector(".wall");
    if (!wall || !this.current) return;
    wall.innerHTML = this.current.map(item => {
      const lines = [this.location(item.asset.exifInfo), this.date(item.asset.exifInfo)].filter(Boolean);
      return `
        <div class="panel">
          <img src="${item.url}" alt="">
          <div class="caption">${lines.map(line => `<div>${line}</div>`).join("")}</div>
        </div>
      `;
    }).join("");
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
          color: #ffffff; font-size: 1.15rem; font-weight: 600; line-height: 1.4;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
        }
        .caption div:first-child { font-weight: 700; }
      </style>
      <div class="wall"></div>
    `;
    this.renderSlide();
  }
}

customElements.define("family-photo-wall", FamilyPhotoWall);
