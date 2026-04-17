module RogerioPenna
  module RoadCreator
    class RoadTool
      SUBDIV_SEGMENTS = 24
      
      def initialize
        @nodes = [] 
        @selected_idx = nil
        @picked_idx = nil
        @picked_part = nil
        @dialog = nil
      end

      def activate
        view = Sketchup.active_model.active_view
        @dialog = EditorDialog.new(self)
        @dialog.show
        view.invalidate
      end

      def getBounds
        bounds = Geom::BoundingBox.new
        if @nodes.empty?
          bounds.add([0,0,0])
        else
          @nodes.each { |n| bounds.add(n.pos); bounds.add(n.left_h); bounds.add(n.right_h) }
          # Infla o box para garantir que o SketchUp renderize o preview em qualquer angulo
          pmin = bounds.min; pmax = bounds.max
          bounds.add(pmin.offset([-50.m, -50.m, -50.m]))
          bounds.add(pmax.offset([50.m, 50.m, 50.m]))
        end
        bounds
      end

      def deactivate(view)
        @dialog.close if @dialog
      end

      def update_selected_node(d)
        return if @selected_idx.nil? || @nodes[@selected_idx].nil?
        n = @nodes[@selected_idx]
        n.lane_l, n.lane_r = d['ll'].to_f.m, d['lr'].to_f.m
        n.sw_l, n.sw_r = d['sl'].to_f.m, d['sr'].to_f.m
        n.follow_terrain, n.max_dev = d['ft'], d['md'].to_f
        new_p = Geom::Point3d.new(d['x'].to_f.m, d['y'].to_f.m, d['z'].to_f.m)
        delta = new_p - n.pos
        if delta.length > 0.001
          n.pos = new_p
          n.left_h = n.left_h.offset(delta); n.right_h = n.right_h.offset(delta)
        end
        Sketchup.active_model.active_view.invalidate
      end

      def create_real_geometry
        return if @nodes.size < 2
        model = Sketchup.active_model
        model.start_operation('Generate Road', true)
        
        group = model.active_entities.add_group
        entities = group.entities
        
        all_data = []
        @nodes.each_cons(2) { |n1, n2| all_data.concat(Geometry.generate_bezier_path(n1, n2, SUBDIV_SEGMENTS)[0...-1]) }
        last = @nodes.last; all_data << {pos: last.pos, ll: last.lane_l, lr: last.lane_r, sl: last.sw_l, sr: last.sw_r}
        edges = Geometry.calculate_all_edges(all_data)

        edges.each_cons(2) do |e1, e2|
          begin
            # ORDEM INVERTIDA para garantir faces para cima (Counter-Clockwise)
            # Lane Esquerda
            entities.add_face(e1[:center], e1[:l_lane], e2[:l_lane], e2[:center])
            # Lane Direita
            entities.add_face(e1[:center], e2[:center], e2[:r_lane], e1[:r_lane])
            # SW Esquerda
            entities.add_face(e1[:l_lane], e1[:l_sw], e2[:l_sw], e2[:l_lane])
            # SW Direita
            entities.add_face(e1[:r_lane], e2[:r_lane], e2[:r_sw], e1[:r_sw])
          rescue
            next
          end
        end

        model.commit_operation
      end

      def onLButtonDown(flags, x, y, view)
        found = false
        @nodes.each_with_index do |n, i|
          [:pos, :left_h, :right_h].each do |part|
            sp = view.screen_coords(n[part])
            if Math.sqrt((sp.x-x)**2 + (sp.y-y)**2) < 20
              @picked_idx, @picked_part = i, part
              if part == :pos; @selected_idx = i; @dialog.update_node(n); end
              found = true; break
            end
          end
          break if found
        end
        unless found
          ip = view.inputpoint(x, y); pos = ip.position
          dir = @nodes.empty? ? Geom::Vector3d.new(5.m, 0, 0) : (pos - @nodes.last.pos)
          dir = Geom::Vector3d.new(5.m, 0, 0) unless dir.valid?; dir.length = 5.m
          new_node = NodeData.new(pos, pos.offset(dir.reverse), pos.offset(dir), 8.m, 3.5.m, 3.5.m, 1.5.m, 1.5.m, true, 5.0, false)
          @nodes << new_node; @selected_idx = @nodes.size - 1; @dialog.update_node(new_node)
        end
        view.invalidate
      end

      def onMouseMove(flags, x, y, view)
        if @picked_idx && @picked_part
          pos = view.inputpoint(x, y).position
          node = @nodes[@picked_idx]; old_pos = node[@picked_part].clone; node[@picked_part] = pos
          if @picked_part == :pos
            delta = pos - old_pos
            node.left_h = node.left_h.offset(delta); node.right_h = node.right_h.offset(delta)
            @dialog.sync_coords(node.pos) if @picked_idx == @selected_idx
          else
            node[(@picked_part == :left_h ? :right_h : :left_h)] = node.pos.offset(node.pos - pos)
          end
          view.invalidate
        end
      end

      def onLButtonUp(flags, x, y, view); @picked_idx = nil; view.invalidate; end

      def draw(view)
        begin
          return if @nodes.empty?
          all_data = []
          @nodes.each_cons(2) { |n1, n2| all_data.concat(Geometry.generate_bezier_path(n1, n2, SUBDIV_SEGMENTS)[0...-1]) }
          last = @nodes.last; all_data << {pos: last.pos, ll: last.lane_l, lr: last.lane_r, sl: last.sw_l, sr: last.sw_r}

          if all_data.size >= 2
            edges = Geometry.calculate_all_edges(all_data)
            z_f = Geom::Vector3d.new(0, 0, 2.mm)
            z_l = Geom::Vector3d.new(0, 0, 3.mm)
            
            # Coleta todos os pontos para desenhar em blocos (mais estavel)
            pts_lane = []; pts_sw = []; pts_wires = []
            
            edges.each_cons(2) do |e1, e2|
              # Faces
              pts_lane.concat([e1[:l_lane].offset(z_f), e2[:l_lane].offset(z_f), e2[:r_lane].offset(z_f), e1[:r_lane].offset(z_f)])
              pts_sw.concat([e1[:l_sw].offset(z_f), e2[:l_sw].offset(z_f), e2[:l_lane].offset(z_f), e1[:l_lane].offset(z_f)])
              pts_sw.concat([e1[:r_lane].offset(z_f), e2[:r_lane].offset(z_f), e2[:r_sw].offset(z_f), e1[:r_sw].offset(z_f)])
              
              # Wires
              l1, l2 = e1[:l_sw].offset(z_l), e2[:l_sw].offset(z_l)
              r1, r2 = e1[:r_sw].offset(z_l), e2[:r_sw].offset(z_l)
              pts_wires.concat([l1, l2, r1, r2, l1, r1])
            end
            pts_wires.concat([edges.last[:l_sw].offset(z_l), edges.last[:r_sw].offset(z_l)])

            # Desenha Blocos
            view.drawing_color = [160, 160, 160]; view.draw(GL_QUADS, pts_lane)
            view.drawing_color = [210, 210, 210]; view.draw(GL_QUADS, pts_sw)
            view.drawing_color = "black"; view.line_width = 1; view.draw(GL_LINES, pts_wires)
          end

          # UI Controls
          @nodes.each_with_index do |n, i|
            view.drawing_color = "gray"; view.draw(GL_LINES, [n.left_h, n.pos, n.pos, n.right_h])
            view.draw_points([n.pos], 14, 4, (i == @selected_idx ? "yellow" : "blue"))
            view.draw_points([n.left_h, n.right_h], 10, 2, "cyan")
          end
        rescue => e; puts ">>> DRAW ERROR: #{e.message}"; end
      end
    end
  end
end
