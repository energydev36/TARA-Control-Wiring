import { NextRequest, NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function DELETE(req: NextRequest) {
  try {
    const { publicId } = await req.json();
    if (!publicId) return NextResponse.json({ error: "No publicId" }, { status: 400 });

    const result = await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    return NextResponse.json({ result });
  } catch (err) {
    console.error("Cloudinary delete error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
