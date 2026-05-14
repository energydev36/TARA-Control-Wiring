import { Schema, model, models } from "mongoose";

export interface ILibrary {
  libraryId: string;
  templates: object[];
  categories: string[];
  updatedAt: Date;
}

const LibrarySchema = new Schema<ILibrary>(
  {
    libraryId: { type: String, required: true, unique: true },
    templates: { type: [Schema.Types.Mixed], default: [] },
    categories: { type: [String], default: [] },
  },
  { timestamps: true }
);

export const LibraryModel =
  models["Library"] ?? model<ILibrary>("Library", LibrarySchema);
