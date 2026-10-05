import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export type Registration = {
  npub: string;
  /** hex pubkey (lowercase) derived from npub */
  pubkey: string;
  fcmToken: string;
  appId: string;
  platform: "android";
  relays: string[];
  updatedAt: number;
};

type StoreFile = {
  version: 1;
  byNpub: Record<string, Registration>;
};

export class RegistrationStore {
  private data: StoreFile = { version: 1, byNpub: {} };

  constructor(private readonly path: string) {
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.path)) return;
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as StoreFile;
      if (parsed?.version === 1 && parsed.byNpub && typeof parsed.byNpub === "object") {
        this.data = parsed;
      }
    } catch (e) {
      console.warn("[notifier] store load failed; starting empty", e);
      this.data = { version: 1, byNpub: {} };
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    renameSync(tmp, this.path);
  }

  list(): Registration[] {
    return Object.values(this.data.byNpub);
  }

  get(npub: string): Registration | undefined {
    return this.data.byNpub[npub];
  }

  upsert(reg: Registration): void {
    this.data.byNpub[reg.npub] = reg;
    this.persist();
  }

  /** Delete by npub and/or fcmToken. Returns number removed. */
  remove(opts: { npub?: string; fcmToken?: string }): number {
    let n = 0;
    for (const [key, reg] of Object.entries(this.data.byNpub)) {
      if (opts.npub && reg.npub === opts.npub) {
        delete this.data.byNpub[key];
        n += 1;
        continue;
      }
      if (opts.fcmToken && reg.fcmToken === opts.fcmToken) {
        delete this.data.byNpub[key];
        n += 1;
      }
    }
    if (n) this.persist();
    return n;
  }
}
