# Road Terrain Creator - Project Roadmap

## 🚀 1. Integration & Commercialization
- [ ] **Embedded UI**: Replace `npm run dev` with built-in SketchUp `HtmlDialog`.
- [ ] **Real-time Sync**: Instant geometry updates to SketchUp via Ruby callbacks.
- [ ] **Project Persistence**: Save road data inside the `.skp` file using AttributeDictionaries.
- [ ] **Auto-Installer**: Create an `.rbz` packager script for easy distribution.

## 🛣️ 2. Advanced Road & Avenue Geometry
- [ ] **Offset Road Tool**: Ability to offset entire road segments sideways.
- [ ] **Avenue Medians ("Internal Yard")**: 
  - Styles: Curb/Grass, Curb/Pavement, Curb/Sidewalk/Grass, Recessed Ditch.
  - **Median Breaks**: Tool to delete specific median segments/divisions for U-turns.
- [ ] **Variable Widths & Profiles**: Camber (banking), custom curb heights, tapering widths, and gutters.
- [ ] **Junction Logic**: Handle "T" and "X" intersections and Roundabout generation.
- [ ] **Vertical Alignment**: Independent Z-axis profile editing and parabolic vertical curves.

## ⛰️ 3. Terrain & Mesh Engine
- [ ] **Inter-Road Meshing**: Generate mesh terrain automatically between road/sidewalk edges.
- [ ] **Locked-Edge Terrain Editing**: Modify Z-elevation of terrain while edges stay "glued" to the road profile (no gaps).
- [ ] **Terrain from Curves**: Create mesh surfaces from arbitrary curves drawn in the editor.
- [ ] **Cut & Fill**: Calculate earthwork volumes (soil movement logic).

## 💡 4. Elements & Assets
- [ ] **Asset Placement**: Position markers for street poles, lights, and trees along specific offset lines.
- [ ] **SketchUp Bridge**: Ensure markers export as proper Component Instances.
- [ ] **Materials**: Map web editor materials directly to SketchUp materials/textures.

## 🛠️ 5. UX & Workflow
- [ ] **Reverse Import**: Convert existing SketchUp curves back into editable roads.
- [ ] **Multi-Select**: Move or edit multiple nodes/handles simultaneously.
- [ ] **Background Map**: Support for reference images, topography maps, or DXF backgrounds.
- [ ] **Unit System**: Toggle between Metric and Imperial.
