import { Schema, model, models } from "mongoose";

export interface IProject {
  projectId: string;
  name: string;
  templates: object[];
  devices: object[];
  wires: object[];
  categories: string[];
  wireColor: string;
  wireThickness: number;
  wireJumps: boolean;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    projectId: { type: String, required: true, unique: true },
    name: { type: String, default: "Untitled" },
    templates: { type: [Schema.Types.Mixed], default: [] },
    devices: { type: [Schema.Types.Mixed], default: [] },
    wires: { type: [Schema.Types.Mixed], default: [] },
    categories: { type: [String], default: [] },
    wireColor: { type: String, default: "#dc2626" },
    wireThickness: { type: Number, default: 2 },
    wireJumps: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Prevent model recompilation in dev hot-reload
export const ProjectModel =
  models["Project"] ?? model<IProject>("Project", ProjectSchema);
