import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { ProjectModel } from "@/lib/models/Project";

export async function GET(req: NextRequest) {
  try {
    await connectDB();
    const id = req.nextUrl.searchParams.get("id");

    if (id) {
      // Return full project data for a specific project
      const doc = await ProjectModel.findOne({ projectId: id }).lean();
      if (!doc) return NextResponse.json(null);
      return NextResponse.json(doc);
    }

    // No id → return list of all projects (metadata only)
    const docs = await ProjectModel.find(
      {},
      { projectId: 1, name: 1, updatedAt: 1, _id: 0 }
    )
      .sort({ updatedAt: -1 })
      .lean();
    return NextResponse.json(docs);
  } catch (err) {
    console.error("GET /api/project error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const body = await req.json();
    const projectId = body.projectId ?? "default";
    const doc = await ProjectModel.findOneAndUpdate(
      { projectId },
      {
        projectId,
        name: body.name ?? "Untitled",
        templates: body.templates ?? [],
        devices: body.devices ?? [],
        wires: body.wires ?? [],
        labels: body.labels ?? [],
        categories: body.categories ?? [],
        wireColor: body.wireColor ?? "#dc2626",
        wireThickness: body.wireThickness ?? 2,
        wireJumps: body.wireJumps ?? false,
      },
      { upsert: true, new: true }
    );
    return NextResponse.json({ ok: true, updatedAt: doc.updatedAt });
  } catch (err) {
    console.error("POST /api/project error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await connectDB();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    await ProjectModel.deleteOne({ projectId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/project error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
