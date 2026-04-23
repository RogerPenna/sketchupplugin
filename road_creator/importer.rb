require 'json'

module RogerioPenna
  module RoadCreator
    module Importer
      def self.import_road_json
        path = UI.openpanel("Select Road JSON", "", "*.json")
        return unless path && File.exist?(path)

        begin
          data = JSON.parse(File.read(path))
          model = Sketchup.active_model
          model.start_operation('Import Road from Editor', true)

          group = model.active_entities.add_group
          group.name = "Imported Road"
          
          # Import Road Mesh
          if data['meshes'] && data['meshes']['road']
            self.build_mesh(group, data['meshes']['road'], "Road Surface", [80, 80, 80])
          end

          # Import Sidewalk Mesh
          if data['meshes'] && data['meshes']['sidewalk']
            self.build_mesh(group, data['meshes']['sidewalk'], "Sidewalks", [180, 180, 180])
          end

          model.commit_operation
          UI.messagebox("Import Complete!")
        rescue => e
          UI.messagebox("Error importing JSON: #{e.message}")
          puts e.backtrace
        end
      end

      def self.build_mesh(parent_group, mesh_data, name, color)
        vertices = mesh_data['vertices']
        indices = mesh_data['indices']
        
        return if vertices.empty? || indices.empty?

        sub_group = parent_group.entities.add_group
        sub_group.name = name
        
        # PolygonMesh é a forma mais rápida de criar geometria complexa
        mesh = Geom::PolygonMesh.new
        
        # Adiciona todos os vértices (converte de metros do editor para polegadas do SketchUp)
        # O JSON vem como [x, y, z, x, y, z...]
        (0...vertices.length).step(3) do |i|
          mesh.add_point(Geom::Point3d.new(vertices[i].m, vertices[i+1].m, vertices[i+2].m))
        end

        # Adiciona as faces (indices vêm em triângulos: [0,1,2, 0,2,3...])
        (0...indices.length).step(3) do |i|
          # Indices do PolygonMesh são 1-based no Ruby API
          begin
            mesh.add_polygon(indices[i] + 1, indices[i+1] + 1, indices[i+2] + 1)
          rescue
            next
          end
        end

        sub_group.entities.fill_from_mesh(mesh, true, 0)
        
        # Aplica uma cor básica
        material = Sketchup.active_model.materials.add(name)
        material.color = color
        sub_group.material = material
      end
    end
  end
end
