import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { LibraryModel } from "@/lib/models/Library";

const LIBRARY_ID = "global";

export async function GET() {
  try {
    await connectDB();
    const doc = await LibraryModel.findOne({ libraryId: LIBRARY_ID }).lean();
    if (!doc) return NextResponse.json(null);
    return NextResponse.json(doc);
  } catch (err) {
    console.error("GET /api/library error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const body = await req.json();
    await LibraryModel.findOneAndUpdate(
      { libraryId: LIBRARY_ID },
      {
        libraryId: LIBRARY_ID,
        templates: body.templates ?? [],
        categories: body.categories ?? [],
      },
      { upsert: true, new: true }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/library error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
