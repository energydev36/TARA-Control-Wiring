import Link from "next/link";
import { connectDB } from "@/lib/mongodb";
import { ProjectModel } from "@/lib/models/Project";

type FeaturedProject = {
  projectId?: string;
  title: string;
  tag: string;
  description: string;
  updatedAt?: Date;
  devices: PreviewDevice[];
  wires: PreviewWire[];
};

type PreviewDevice = {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

type PreviewWire = {
  points: number[];
  color: string;
  thickness: number;
};

const fallbackFeaturedProjects: FeaturedProject[] = [
  {
    title: "Smart Pump Controller",
    tag: "Automation",
    description: "ระบบควบคุมปั๊มน้ำพร้อมเซนเซอร์ระดับน้ำและแจ้งเตือน",
    devices: [],
    wires: [],
  },
  {
    title: "Mini Factory Panel",
    tag: "Industrial",
    description: "ตัวอย่างตู้คอนโทรลไลน์การผลิตขนาดเล็กพร้อม interlock",
    devices: [],
    wires: [],
  },
  {
    title: "Solar Transfer Board",
    tag: "Energy",
    description: "แผงสลับไฟระหว่างโซลาร์และไฟบ้านพร้อมอุปกรณ์ป้องกัน",
    devices: [],
    wires: [],
  },
  {
    title: "Cold Room Monitor",
    tag: "IoT",
    description: "วงจรควบคุมห้องเย็นพร้อมเทอร์โมสแตตและบันทึกสถานะ",
    devices: [],
    wires: [],
  },
  {
    title: "Motor Starter Basic",
    tag: "Starter",
    description: "วงจรสตาร์ทมอเตอร์แบบ DOL พร้อมคอนแทคเตอร์และโอเวอร์โหลด",
    devices: [],
    wires: [],
  },
  {
    title: "Building Lighting Zone",
    tag: "Building",
    description: "ชุดควบคุมไฟแยกโซนพร้อม timer และสวิตช์ override",
    devices: [],
    wires: [],
  },
];

function toFiniteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeDevices(input: unknown): PreviewDevice[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item: unknown) => {
      if (!item || typeof item !== "object") return null;
      const d = item as Record<string, unknown>;
      if (typeof d.src !== "string") return null;
      return {
        src: d.src,
        x: toFiniteNumber(d.x, 0),
        y: toFiniteNumber(d.y, 0),
        width: Math.max(20, toFiniteNumber(d.width, 120)),
        height: Math.max(20, toFiniteNumber(d.height, 80)),
        rotation: toFiniteNumber(d.rotation, 0),
      } satisfies PreviewDevice;
    })
    .filter((d): d is PreviewDevice => d !== null)
    .slice(0, 60);
}

function normalizeWires(input: unknown): PreviewWire[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item: unknown) => {
      if (!item || typeof item !== "object") return null;
      const w = item as Record<string, unknown>;
      if (!Array.isArray(w.points)) return null;
      const points = w.points
        .map((n: unknown) => toFiniteNumber(n, Number.NaN))
        .filter((n: number) => Number.isFinite(n));
      const evenPoints = points.length % 2 === 0 ? points : points.slice(0, -1);
      if (evenPoints.length < 4) return null;
      return {
        points: evenPoints,
        color: typeof w.color === "string" ? w.color : "#60a5fa",
        thickness: Math.max(1, toFiniteNumber(w.thickness, 2)),
      } satisfies PreviewWire;
    })
    .filter((w): w is PreviewWire => w !== null)
    .slice(0, 200);
}

function calcBounds(devices: PreviewDevice[], wires: PreviewWire[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const d of devices) {
    minX = Math.min(minX, d.x);
    minY = Math.min(minY, d.y);
    maxX = Math.max(maxX, d.x + d.width);
    maxY = Math.max(maxY, d.y + d.height);
  }

  for (const w of wires) {
    for (let i = 0; i < w.points.length; i += 2) {
      minX = Math.min(minX, w.points[i]);
      minY = Math.min(minY, w.points[i + 1]);
      maxX = Math.max(maxX, w.points[i]);
      maxY = Math.max(maxY, w.points[i + 1]);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, width: 320, height: 180 };
  }

  const pad = 24;
  const width = Math.max(160, maxX - minX + pad * 2);
  const height = Math.max(100, maxY - minY + pad * 2);
  return { minX: minX - pad, minY: minY - pad, width, height };
}

function ProjectDiagramPreview({ devices, wires }: { devices: PreviewDevice[]; wires: PreviewWire[] }) {
  if (devices.length === 0 && wires.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
        ยังไม่มีแปลนวงจร
      </div>
    );
  }

  const bounds = calcBounds(devices, wires);
  return (
    <svg
      className="h-full w-full"
      viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label="project-diagram-preview"
    >
      <rect
        x={bounds.minX}
        y={bounds.minY}
        width={bounds.width}
        height={bounds.height}
        fill="#ffffff"
      />
      {wires.map((wire, idx) => (
        <polyline
          key={`w-${idx}`}
          fill="none"
          points={wire.points.join(" ")}
          stroke={wire.color}
          strokeWidth={wire.thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        />
      ))}
      {devices.map((device, idx) => (
        <image
          key={`d-${idx}`}
          href={device.src}
          x={device.x}
          y={device.y}
          width={device.width}
          height={device.height}
          transform={device.rotation ? `rotate(${device.rotation} ${device.x} ${device.y})` : undefined}
        />
      ))}
    </svg>
  );
}

async function getFeaturedProjects(): Promise<FeaturedProject[]> {
  try {
    await connectDB();
    const docs = await ProjectModel.find(
      {},
      { projectId: 1, name: 1, devices: 1, wires: 1, updatedAt: 1, _id: 0 }
    )
      .sort({ updatedAt: -1 })
      .limit(6)
      .lean();

    if (!docs.length) return fallbackFeaturedProjects;

    return docs.map((doc) => {
      const devices = normalizeDevices(doc.devices);
      const wires = normalizeWires(doc.wires);
      const deviceCount = Array.isArray(doc.devices) ? doc.devices.length : 0;
      const wireCount = Array.isArray(doc.wires) ? doc.wires.length : 0;

      return {
        projectId: typeof doc.projectId === "string" ? doc.projectId : undefined,
        title: doc.name || "Untitled",
        tag: "Project",
        description: `มีอุปกรณ์ ${deviceCount} ชิ้น และสาย ${wireCount} เส้น`,
        updatedAt: doc.updatedAt,
        devices,
        wires,
      } satisfies FeaturedProject;
    });
  } catch {
    return fallbackFeaturedProjects;
  }
}

export default async function Home() {
  const featuredProjects = await getFeaturedProjects();

  return (
    <div className="relative isolate min-h-screen bg-zinc-950 text-zinc-100">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgba(168,85,247,0.25),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(59,130,246,0.20),transparent_30%),linear-gradient(to_bottom,#09090b,#09090b)]" />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <div>
          <p className="text-xs tracking-[0.2em] text-violet-300">TARA CONTROL</p>
          <h1 className="text-xl font-semibold">Welcome</h1>
        </div>
        <Link
          href="/studio"
          className="rounded-full bg-violet-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-400"
        >
          เข้า Studio
        </Link>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16 pt-8">
        <section className="rounded-3xl border border-violet-500/30 bg-zinc-900/70 p-8 shadow-[0_0_120px_rgba(168,85,247,0.18)] backdrop-blur">
          <p className="mb-3 inline-flex rounded-full border border-violet-400/40 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">
            เริ่มต้นออกแบบวงจรได้ทันที
          </p>
          <h2 className="max-w-3xl text-3xl font-semibold leading-tight md:text-4xl">
            ยินดีต้อนรับสู่ Tara Control
          </h2>
          <p className="mt-4 max-w-2xl text-sm text-zinc-300 md:text-base">
            เครื่องมือสำหรับวางอุปกรณ์ เดินสาย และจัดการโปรเจคคอนโทรลในหน้าเดียว
            พร้อมตัวอย่างโปรเจคที่แนะนำให้เริ่มได้เร็วขึ้น
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/studio"
              className="rounded-xl bg-violet-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-400"
            >
              เริ่มออกแบบโปรเจค
            </Link>
            <a
              href="#featured"
              className="rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800"
            >
              ดูโปรเจคแนะนำ
            </a>
          </div>
        </section>

        <section id="featured" className="mt-10">
          <div className="mb-4 flex items-end justify-between">
            <h3 className="text-xl font-semibold">โปรเจคที่แนะนำ</h3>
            <p className="text-xs text-zinc-400">ตัวอย่างสำหรับเริ่มต้นเร็ว</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featuredProjects.map((project, index) => (
              <article
                key={`${project.title}-${index}`}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 transition hover:border-violet-500/60 hover:bg-zinc-900"
              >
                <div className="mb-3 overflow-hidden rounded-xl border border-zinc-300 bg-white aspect-[16/9]">
                  <ProjectDiagramPreview devices={project.devices} wires={project.wires} />
                </div>
                <span className="inline-flex rounded-full bg-violet-500/10 px-2.5 py-1 text-xs text-violet-200">
                  {project.tag}
                </span>
                <h4 className="mt-3 text-base font-semibold">{project.title}</h4>
                <p className="mt-2 text-sm text-zinc-400">{project.description}</p>
                {project.updatedAt ? (
                  <p className="mt-2 text-xs text-zinc-500">
                    อัปเดตล่าสุด {new Date(project.updatedAt).toLocaleString("th-TH")}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
                  {project.projectId ? (
                    <Link
                      href={`/view/${project.projectId}`}
                      className="text-violet-300 hover:text-violet-200"
                    >
                      ดูโปรเจค →
                    </Link>
                  ) : null}
                  <Link
                    href="/studio"
                    className="text-zinc-400 hover:text-zinc-200"
                  >
                    ใช้เป็นต้นแบบ
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
